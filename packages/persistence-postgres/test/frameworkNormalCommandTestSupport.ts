import { expect, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as restoredValues from "../src/migrationCoordination/storedRestoration";
import * as restoredEvents from "../src/migrationCoordination/storedEventRestoration";
import { getFrameworkMigrationClaimState } from "../src/migrationCoordination/coordinatorClaim";
import { executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect, readFrameworkMigrationClaimProgressEffect,
  runFreshFrameworkMigrationCoordinatorEffect, type RunFreshFrameworkMigrationCoordinatorInput,
} from "../src/migrationCoordination/freshCoordinator";
import { runEffect } from "./effectTestRuntime";

/** Measure actual detached driver rows across the complete normal continuation.
 * Opening and final publication remain explicit full-verification boundaries. */
export async function assertNormalCommandWorkingSet(input: RunFreshFrameworkMigrationCoordinatorInput) {
  const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
  if (pending.kind !== "pending") throw new Error("Expected empty claim");
  const state = getFrameworkMigrationClaimState(pending.claim);
  if (state === undefined) throw new Error("Missing claim definition");
  const steps = state.attempt.plan.plan.frame.steps;
  const edges = steps.reduce((count, step) => count + step.dependencies.length, 0);
  let normalizedReceipts = 0;
  let canonicalReceipts = 0;
  let sidecars = 0;
  let canonicalBytes = 0;
  const detach = driverRows.detachDriverRows;
  const rows = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(value => {
    const detached = detach(value);
    for (const row of detached) {
      if ("canonicalBytes" in row && row.canonicalBytes instanceof Uint8Array) {
        canonicalBytes += row.canonicalBytes.byteLength;
        if ("receiptStorageId" in row) canonicalReceipts++;
      } else if ("receiptStorageId" in row && "observedPostconditionSha256" in row) normalizedReceipts++;
      if ("dependencyOrdinal" in row && "receiptStorageId" in row) sidecars++;
    }
    return detached;
  });
  const receiptRestoration = vi.spyOn(restoredValues, "restoreStoredFrameworkMigrationStepReceipt");
  const attemptRestoration = vi.spyOn(restoredValues, "restoreStoredFrameworkMigrationAttemptStart");
  const eventRestoration = vi.spyOn(restoredEvents, "restoreStoredFrameworkMigrationEvent");
  try {
    for (let completed = 0; completed < steps.length; completed++) {
      expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim)))
        .toEqual({ kind: "step", completedStepCount: completed + 1, requiredStepCount: steps.length });
    }
    expect(canonicalReceipts).toBe(steps.length);
    expect(normalizedReceipts).toBe(edges + steps.length - 1);
    expect(sidecars).toBe(edges);
    // Includes current heads/events/collision metadata, and each new receipt's
    // canonical direct edges; historical plan/attempt/receipt graphs are absent.
    expect(canonicalBytes).toBeLessThan(20_000 * steps.length + 256 * edges);
    expect(receiptRestoration).not.toHaveBeenCalled();
    expect(attemptRestoration).not.toHaveBeenCalled();
    expect(eventRestoration).not.toHaveBeenCalled();
  } finally {
    rows.mockRestore(); receiptRestoration.mockRestore(); attemptRestoration.mockRestore(); eventRestoration.mockRestore();
  }
  expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
}

export const normalCommandAlterations = ["receipt", "sidecar", "event", "head", "casReturn"] as const;

export async function assertNormalCommandRollback(input: RunFreshFrameworkMigrationCoordinatorInput,
  alteration: typeof normalCommandAlterations[number]) {
  const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
  if (pending.kind !== "pending") throw new Error("Expected empty claim");
  const state = getFrameworkMigrationClaimState(pending.claim);
  const step = state?.attempt.plan.plan.frame.steps.find(candidate => candidate.dependencies.length > 0);
  if (step === undefined) throw new Error("Missing dependent step");
  for (let completed = 0; completed < step.ordinal; completed++) {
    expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ kind: "step" });
  }
  const before = await runEffect(readFrameworkMigrationClaimProgressEffect(pending.claim));
  let newReceiptSeen = false;
  let altered = false;
  const detach = driverRows.detachDriverRows;
  const rows = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(value => detach(value).map(row => {
    const receipt = "canonicalBytes" in row && "receiptStorageId" in row;
    if (receipt) newReceiptSeen = true;
    if (!newReceiptSeen || altered) return row;
    if (alteration === "receipt" && receipt) {
      altered = true;
      return { ...row, stepId: "altered-step" };
    }
    if (alteration === "sidecar" && "dependencyOrdinal" in row) {
      altered = true;
      return { ...row, dependencyOrdinal: -1 };
    }
    if (alteration === "event" && "canonicalBytes" in row && "eventStorageId" in row) {
      altered = true;
      return { ...row, eventSequence: -1n };
    }
    if (alteration === "head" && "headRevision" in row) {
      altered = true;
      return { ...row, completedStepCount: 0 };
    }
    if (alteration === "casReturn" && "collisionStorageId" in row && Object.keys(row).length === 1) {
      altered = true;
      return { ...row, collisionStorageId: 0n };
    }
    return row;
  }));
  try {
    await expect(runEffect(executeNextFrameworkMigrationStepEffect(pending.claim)))
      .rejects.toMatchObject({ reason: "storedCorruption" });
    expect(altered).toBe(true);
  } finally { rows.mockRestore(); }
  expect(await runEffect(readFrameworkMigrationClaimProgressEffect(pending.claim))).toEqual(before);
  // A surviving DDL/root/sidecar/event from the rejected transaction would
  // conflict with the exact clean retry or with full final publication proof.
  for (let completed = step.ordinal; completed < before.requiredStepCount; completed++) {
    expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim)))
      .toEqual({ kind: "step", completedStepCount: completed + 1, requiredStepCount: before.requiredStepCount });
  }
  expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
}
