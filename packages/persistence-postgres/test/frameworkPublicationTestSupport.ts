import { expect, vi } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import * as driverRows from "../src/detachDriverRows";
import { fxSystemFrameworkMigrationAttemptTerminals, fxSystemFrameworkMigrationCollisionHeads, fxSystemFrameworkMigrationEvents } from "../src/migrationCoordination/schema";
import { fxSystemFrameworkSchemaInstallations, fxSystemFrameworkSchemaReadiness, fxSystemFrameworkSchemaAvailabilityHistory,
  fxSystemFrameworkSchemaAvailabilityHeads } from "../src/frameworkSchema/installation/schema";
import { runFreshFrameworkMigrationCoordinatorEffect, executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect,
  type RunFreshFrameworkMigrationCoordinatorInput } from "../src/migrationCoordination/freshCoordinator";
import { runEffect } from "./effectTestRuntime";

export const publicationAlterations = ["terminalReturn", "installationReturn", "readinessReturn", "historyReturn", "availabilityReturn",
  "terminalRow", "installationRow", "readinessRow", "historyRow", "availabilityRow", "eventRow", "headRow", "headCasReturn"] as const;

export async function assertPublicationRollback(database: FlarexMetadataDatabase, input: RunFreshFrameworkMigrationCoordinatorInput,
  alteration: typeof publicationAlterations[number]) {
  const opened = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
  if (opened.kind !== "pending") throw new Error("Expected new claim");
  for (let index = 0; index < opened.requiredStepCount; index++) {
    expect(await runEffect(executeNextFrameworkMigrationStepEffect(opened.claim))).toMatchObject({ kind: "step" });
  }
  const beforeHead = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  const beforeEvents = await database.select().from(fxSystemFrameworkMigrationEvents);
  let publishing = false;
  let altered = false;
  let historyWritten = false;
  const detach = driverRows.detachDriverRows;
  const rows = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(value => detach(value).map(row => {
    const single = Object.keys(row).length === 1;
    if (single && "terminalStorageId" in row) publishing = true;
    if (!publishing || altered) return row;
    if (single) {
      const key = alteration === "terminalReturn" ? "terminalStorageId" : alteration === "installationReturn" ? "installationStorageId" :
        alteration === "readinessReturn" ? "readinessStorageId" : alteration === "historyReturn" ? "availabilityHistoryStorageId" :
          alteration === "availabilityReturn" ? "installationStorageId" : alteration === "headCasReturn" ? "collisionStorageId" : undefined;
      if (key !== undefined && key in row) {
        // Installation and availability return the same named identity. Select
        // the latter only after the history writer has returned its root.
        if (alteration === "availabilityReturn" && !historyWritten) return row;
        altered = true;
        return { ...row, [key]: 1_000_000n };
      }
      if ("availabilityHistoryStorageId" in row) historyWritten = true;
    }
    if (!("canonicalBytes" in row)) return row;
    if (alteration === "terminalRow" && "terminalStorageId" in row && "outcomeKind" in row) {
      altered = true; return { ...row, attemptFence: -1n };
    }
    if (alteration === "installationRow" && "installationStorageId" in row && "terminalStorageId" in row) {
      altered = true; return { ...row, terminalStorageId: 0n };
    }
    if (alteration === "readinessRow" && "validationSha256" in row) {
      altered = true; return { ...row, installationStorageId: 0n };
    }
    if (alteration === "historyRow" && "previousHistoryStorageId" in row) {
      altered = true; return { ...row, readinessStorageId: 0n };
    }
    if (alteration === "availabilityRow" && "availabilityHeadSha256" in row) {
      altered = true; return { ...row, readinessStorageId: 0n };
    }
    if (alteration === "eventRow" && "eventStorageId" in row) {
      altered = true; return { ...row, eventSequence: -1n };
    }
    if (alteration === "headRow" && "headRevision" in row) {
      altered = true; return { ...row, completedStepCount: 0 };
    }
    return row;
  }));
  try {
    await expect(runEffect(finalizeFrameworkMigrationClaimEffect(opened.claim))).rejects.toMatchObject({ reason: "storedCorruption" });
    expect(altered).toBe(true);
  } finally { rows.mockRestore(); }
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(beforeHead);
  expect(await database.select().from(fxSystemFrameworkMigrationEvents)).toEqual(beforeEvents);
  expect(await database.select().from(fxSystemFrameworkMigrationAttemptTerminals)).toEqual([]);
  expect(await database.select().from(fxSystemFrameworkSchemaInstallations)).toEqual([]);
  expect(await database.select().from(fxSystemFrameworkSchemaReadiness)).toEqual([]);
  expect(await database.select().from(fxSystemFrameworkSchemaAvailabilityHistory)).toEqual([]);
  expect(await database.select().from(fxSystemFrameworkSchemaAvailabilityHeads)).toEqual([]);
  expect(await runEffect(finalizeFrameworkMigrationClaimEffect(opened.claim))).toMatchObject({ kind: "ready", replayed: false });
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready", replayed: true });
}

export const settledReadinessAlterations = ["headReference", "historyReference", "headBytes", "historyBytes", "missingHead", "missingHistory"] as const;

export async function assertSettledReadinessRefusal(database: FlarexMetadataDatabase, input: RunFreshFrameworkMigrationCoordinatorInput,
  alteration: typeof settledReadinessAlterations[number]) {
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready", replayed: false });
  const beforeHead = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  const beforeEvents = await database.select().from(fxSystemFrameworkMigrationEvents);
  const detach = driverRows.detachDriverRows;
  let altered = false;
  const rows = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(value => detach(value).flatMap(row => {
    if (altered || !("canonicalBytes" in row) || !(row.canonicalBytes instanceof Uint8Array)) return [row];
    const head = "availabilityHeadSha256" in row;
    const history = "previousHistoryStorageId" in row;
    if (!((head && ["headReference", "headBytes", "missingHead"].includes(alteration)) ||
      (history && ["historyReference", "historyBytes", "missingHistory"].includes(alteration)))) return [row];
    altered = true;
    if (alteration === "missingHead" || alteration === "missingHistory") return [];
    if (alteration === "headReference" || alteration === "historyReference") return [{ ...row, readinessStorageId: 1_000_000n }];
    const canonicalBytes = Uint8Array.from(row.canonicalBytes);
    canonicalBytes[0] = 91;
    return [{ ...row, canonicalBytes }];
  }));
  try {
    await expect(runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).rejects.toMatchObject({ reason: "storedCorruption" });
    expect(altered).toBe(true);
  } finally { rows.mockRestore(); }
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(beforeHead);
  expect(await database.select().from(fxSystemFrameworkMigrationEvents)).toEqual(beforeEvents);
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready", replayed: true });
}
