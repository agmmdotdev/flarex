import { Effect, Option } from "effect";
import { expect, vi } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import * as storedEvents from "../src/migrationCoordination/storedEventRestoration";
import { getFrameworkMigrationClaimState } from "../src/migrationCoordination/coordinatorClaim";
import { runFreshFrameworkMigrationCoordinatorEffect, executeNextFrameworkMigrationStepEffect,
  finalizeFrameworkMigrationClaimEffect, type RunFreshFrameworkMigrationCoordinatorInput } from "../src/migrationCoordination/freshCoordinator";
import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect } from "../src/migrationCoordination/migrationCollisionHeadRepository";
import { runFrameworkMigrationTargetTransactionEffect, withFrameworkMigrationRawTransactionEffect } from "../src/migrationCoordination/targetSession";
import { verifyFrameworkMigrationEffect } from "../src/migrationCoordination/verify";
import { prepareInstallationRuntime } from "../src/frameworkSchema/installation/runtime";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "./effectTestRuntime";

/** Counts concrete detached metadata rows, transported canonical payload bytes,
 * and issuer invocations. Queries that do not use detachDriverRows are outside
 * the row total; elapsed time is diagnostic and not the frozen acceptance timer. */
async function measure<Value>(phase: string, action: () => Promise<Value>) {
  let detachedRows = 0;
  let canonicalBytes = 0;
  const rootRows: Record<string, number> = {};
  const detach = driverRows.detachDriverRows;
  const rows = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(value => {
    const detached = detach(value);
    detachedRows += detached.length;
    for (const row of detached) {
      if (!("canonicalBytes" in row) || !(row.canonicalBytes instanceof Uint8Array)) continue;
      canonicalBytes += row.canonicalBytes.byteLength;
      const kind = "receiptStorageId" in row ? "receipt" : "eventStorageId" in row ? "event" :
        "readinessStorageId" in row ? "readiness" : "installationStorageId" in row ? "installation" :
          "terminalStorageId" in row ? "terminal" : "attemptStorageId" in row ? "attempt" :
            "admissionStorageId" in row ? "admission" : "planStorageId" in row ? "plan" : "other";
      rootRows[kind] = (rootRows[kind] ?? 0) + 1;
    }
    return detached;
  });
  const plans = vi.spyOn(storedValues, "restoreStoredFreshRelationalMigrationPlan");
  const admissions = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationPlanAdmission");
  const attempts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
  const receipts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationStepReceipt");
  const terminals = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptTerminal");
  const events = vi.spyOn(storedEvents, "restoreStoredFrameworkMigrationEvent");
  const started = performance.now();
  try {
    const value = await action();
    const work = { phase, detachedRows, canonicalBytes, rootRows,
      issued: { plans: plans.mock.calls.length, admissions: admissions.mock.calls.length,
        attempts: attempts.mock.calls.length, receipts: receipts.mock.calls.length,
        terminals: terminals.mock.calls.length, events: events.mock.calls.length },
      diagnosticMilliseconds: Math.round(performance.now() - started) };
    return { value, work };
  } finally {
    rows.mockRestore(); plans.mockRestore(); admissions.mockRestore(); attempts.mockRestore();
    receipts.mockRestore(); terminals.mockRestore(); events.mockRestore();
  }
}

export async function assertInstallationWorkPhases(database: FlarexMetadataDatabase,
  input: RunFreshFrameworkMigrationCoordinatorInput, driver: "pglite" | "postgres") {
  const opening = await measure("open", () => runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 })));
  if (opening.value.kind !== "pending") throw new Error("Expected new claim");
  const claim = opening.value.claim;
  const state = getFrameworkMigrationClaimState(claim);
  if (state === undefined) throw new Error("Missing definition");
  const count = state.definition.steps.length;
  const edges = state.definition.steps.reduce((sum, value) => sum + value.step.dependencies.length, 0);
  const normal = await measure("normalPrefix", async () => {
    for (let ordinal = 0; ordinal < count - 1; ordinal++) {
      expect(await runEffect(executeNextFrameworkMigrationStepEffect(claim)))
        .toMatchObject({ kind: "step", completedStepCount: ordinal + 1 });
    }
  });
  expect(normal.work.issued).toEqual({ plans: 0, admissions: 0, attempts: 0, receipts: 0, terminals: 0, events: 0 });
  expect(normal.work.rootRows.receipt).toBe(count - 1);
  const restart = await measure("liveRestart", () => runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 })));
  expect(restart.value).toMatchObject({ kind: "pending", completedStepCount: count - 1 });
  expect(restart.work.issued.receipts).toBe(0);
  expect(restart.work.issued.events).toBe(0);
  const lastStep = await measure("lastNormalStep", () => runEffect(executeNextFrameworkMigrationStepEffect(claim)));
  expect(lastStep.value).toMatchObject({ kind: "step", completedStepCount: count });
  const publication = await measure("publication", () => runEffect(finalizeFrameworkMigrationClaimEffect(claim)));
  if (publication.value.kind !== "ready") throw new Error("Expected readiness");
  expect(publication.work.issued.receipts).toBe(count);
  expect(publication.work.issued.attempts).toBe(1);
  expect(publication.work.issued.terminals).toBe(1);
  expect(publication.work.rootRows.receipt).toBe(count);
  const availability = publication.value.availability;
  const replay = await measure("settledReplay", () => runEffect(runFreshFrameworkMigrationCoordinatorEffect(input)));
  expect(replay.value).toMatchObject({ kind: "ready", replayed: true });
  const audit = await measure("audit", () => runEffect(verifyFrameworkMigrationEffect(input.target, state.definition.plan, input)));
  expect(audit.value).toMatchObject({ kind: "verified", complete: true, completedStepCount: count });
  expect(audit.work.issued.receipts).toBe(count);
  expect(audit.work.issued.attempts).toBe(1);
  const withoutMemo = await measure("fullHeadWithoutMemo", () => runEffect(runFrameworkMigrationTargetTransactionEffect(input.target,
    { kind: "ordinary", lockTimeoutMilliseconds: input.lockTimeoutMilliseconds, statementTimeoutMilliseconds: input.statementTimeoutMilliseconds },
    transaction => withFrameworkMigrationRawTransactionEffect(transaction, input.target, raw => withFrameworkGraphReadPass(Effect.gen(function* () {
      const fill = makeFrameworkGraphReferenceRead<number>();
      for (let index = 0; index < 512; index++) yield* fill(Effect.succeed(index), raw, index);
      return yield* readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect(raw, state.collision);
    }), raw)))));
  expect(Option.isSome(withoutMemo.value)).toBe(true);
  expect(withoutMemo.work.issued.receipts).toBe(count);
  expect(withoutMemo.work.issued.attempts).toBe(1);
  expect(withoutMemo.work.issued.events).toBe(count + 5);
  const cold = await measure("runtimeColdOpen", () => runEffect(prepareInstallationRuntime(database, input.target.schema,
    installationBindingReference(availability))));
  expect(cold.work.issued.receipts).toBe(count);
  expect(cold.work.issued.events).toBe(0);
  process.stdout.write(JSON.stringify({ driver, steps: count, edges,
    phases: [opening, normal, restart, lastStep, publication, replay, audit, withoutMemo, cold].map(result => result.work) }) + "\n");
}
