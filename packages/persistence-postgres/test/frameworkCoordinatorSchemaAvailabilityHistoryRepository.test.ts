import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { asc, eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  captureFrameworkSchemaAvailabilityHistory,
} from "../src/frameworkSchema/installation/canonical";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
  corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect,
  readFrameworkSchemaAvailabilityHistoryInTransactionEffect,
  resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect,
  restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect,
} from
  "../src/frameworkSchema/installation/availabilityHistoryRepository";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
  type CapturedFrameworkSchemaInstallationValue,
  type FrameworkSchemaAvailabilityHistoryFrame,
  type FrameworkSchemaAvailabilityStatus,
} from "../src/frameworkSchema/installation/model";
import { fxSystemFrameworkSchemaAvailabilityHistory } from
  "../src/frameworkSchema/installation/schema";
import {
  restoredFrameworkSchemaAvailabilityHistoryAuthority,
  type RestoredFrameworkSchemaAvailabilityHistory,
  type RestoredFrameworkSchemaReadiness,
} from
  "../src/frameworkSchema/installation/storedMetadataRestoration";
import type { FrameworkSchemaAvailabilityHistorySha256 } from
  "../src/migrationCoordination/identity";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulReadinessGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 180_000;

type FrameworkSchemaAvailabilityHistory =
  CapturedFrameworkSchemaInstallationValue<
    FrameworkSchemaAvailabilityHistoryFrame,
    FrameworkSchemaAvailabilityHistorySha256
  >;

type AvailabilitySpec = Readonly<{
  status: FrameworkSchemaAvailabilityStatus;
  reasonSha256: string | null;
  recordedAt: string;
}>;

type AvailabilityEntry = Readonly<{
  history: FrameworkSchemaAvailabilityHistory;
  restored: RestoredFrameworkSchemaAvailabilityHistory;
}>;

const availabilitySpecs = Object.freeze([
  Object.freeze({
    status: "ready",
    reasonSha256: null,
    recordedAt: "2026-08-27T08:36:00.000Z",
  }),
  Object.freeze({
    status: "withdrawn",
    reasonSha256: "44".repeat(32),
    recordedAt: "2026-08-27T08:37:00.000Z",
  }),
  Object.freeze({
    status: "ready",
    reasonSha256: null,
    recordedAt: "2026-08-27T08:38:00.000Z",
  }),
] satisfies readonly AvailabilitySpec[]);

describe("framework coordinator schema-availability-history repository", () => {
  it("keeps the history transaction kernel and authority source-private", async () => {
    expect(
      "appendFrameworkSchemaAvailabilityHistoryInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkSchemaAvailabilityHistoryInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoredFrameworkSchemaAvailabilityHistoryAuthority" in persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/availabilityHistoryRepository.ts",
    );
  });

  it("appends, reads, and exactly replays a three-state history", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(async transaction => {
      const graph = await storeSuccessfulReadinessGraphInTransaction(
        transaction,
        values,
      );
      const entries: AvailabilityEntry[] = [];
      let previous: RestoredFrameworkSchemaAvailabilityHistory | null = null;
      for (const spec of availabilitySpecs) {
        const readiness: RestoredFrameworkSchemaReadiness =
          previous?.readiness ?? graph.readiness;
        const history = await captureAvailability(readiness, previous, spec);
        const missing = await runEffect(
          readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            history,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);
        const appended: RestoredFrameworkSchemaAvailabilityHistory =
          await runEffect(
          appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            history,
          ),
        );
        const replayed = await runEffect(
          appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            history,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            history,
          ),
        ));
        expect(replayed.storageId).toBe(appended.storageId);
        expect(read).toEqual(appended);
        expectRestoredHistoryIdentity(appended, previous);
        expectRestoredHistoryIdentity(replayed, previous);
        expectRestoredHistoryIdentity(read, previous);
        expect(restoredFrameworkSchemaAvailabilityHistoryAuthority(
          Object.freeze({ ...appended }),
        )).toBeUndefined();
        entries.push(Object.freeze({ history, restored: appended }));
        previous = appended;
      }
      const last = entries.at(-1);
      const penultimate = entries.at(-2);
      if (last === undefined || penultimate === undefined) {
        throw new Error("Missing cold-restoration history");
      }
      const cold = await runEffect(
        restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect(
          transaction,
          last.restored.installation,
          last.restored.storageId,
          last.restored.history.frame.availabilitySequence,
          last.restored.history.frame.status,
          last.restored.history.sha256,
          "readAvailabilityHistory",
        ),
      );
      expect(cold.storageId).toBe(last.restored.storageId);
      expectRestoredHistoryIdentity(cold, penultimate.restored);
      return Object.freeze({ graph, entries: Object.freeze(entries) });
    });

    const rows = await storedAvailabilityHistoryRows(persistence);
    expect(rows).toHaveLength(availabilitySpecs.length);
    for (let index = 0; index < stored.entries.length; index += 1) {
      const entry = stored.entries[index];
      const row = rows[index];
      const previous = stored.entries[index - 1]?.restored ?? null;
      if (entry === undefined || row === undefined) {
        throw new Error("Missing availability-history entry");
      }
      expect(row).toEqual({
        availabilityHistoryStorageId: entry.restored.storageId,
        installationStorageId: entry.restored.installation.storageId,
        readinessStorageId: entry.restored.readiness.storageId,
        readinessSha256: entry.restored.readiness.readiness.sha256,
        availabilitySequence: BigInt(
          entry.restored.history.frame.availabilitySequence,
        ),
        status: entry.restored.history.frame.status,
        reasonSha256: entry.restored.history.frame.reasonSha256,
        historySha256: entry.restored.history.sha256,
        previousHistoryStorageId: previous?.storageId ?? null,
        previousAvailabilitySequence: previous === null
          ? null
          : BigInt(previous.history.frame.availabilitySequence),
        previousHistorySha256: previous?.history.sha256 ?? null,
        previousStatus: previous?.history.frame.status ?? null,
        frameFormat: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_FORMAT,
        frameVersion: FRAMEWORK_SCHEMA_AVAILABILITY_HISTORY_VERSION,
        canonicalByteLength: canonicalBytes(entry.restored.history).byteLength,
        canonicalBytes: canonicalBytes(entry.restored.history),
      });
    }

    await persistence.drizzle.transaction(async transaction => {
      let previous: RestoredFrameworkSchemaAvailabilityHistory | null = null;
      for (let index = 0; index < availabilitySpecs.length; index += 1) {
        const spec = availabilitySpecs[index];
        const expected = stored.entries[index];
        if (spec === undefined || expected === undefined) {
          throw new Error("Missing independent availability-history entry");
        }
        const readiness: RestoredFrameworkSchemaReadiness | undefined =
          previous?.readiness ??
          stored.entries[0]?.restored.readiness;
        if (readiness === undefined) throw new Error("Missing readiness");
        const history = await captureAvailability(readiness, previous, spec);
        const replayed: RestoredFrameworkSchemaAvailabilityHistory =
          await runEffect(
          appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            history,
          ),
        );
        expect(replayed.storageId).toBe(expected.restored.storageId);
        previous = replayed;
      }
    });
    await expect(availabilityHistoryCount(persistence)).resolves.toBe("3");
  }, PGLITE_TEST_TIMEOUT);

  it("resolves sequence occupants before lazily consulting the digest", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedAvailabilityHistoryFixture(persistence, 1);
    const entry = stored.entries[0];
    if (entry === undefined) throw new Error("Missing availability history");
    const authority = restoredFrameworkSchemaAvailabilityHistoryAuthority(
      entry.restored,
    );
    if (authority === undefined) throw new Error("Missing history authority");
    const occupant = Object.freeze({
      value: entry.restored,
      previous: authority.previous,
    });
    let digestReads = 0;
    const exact = await runEffect(
      resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
        entry.restored.readiness,
        null,
        entry.restored.history,
        "readAvailabilityHistory",
        {
          readBySequence: () => Effect.succeed(Option.some(occupant)),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(Option.getOrThrow(exact).storageId).toBe(entry.restored.storageId);
    expect(digestReads).toBe(0);

    const conflicting = await captureAvailability(
      entry.restored.readiness,
      null,
      { ...availabilitySpecs[0], recordedAt: "2026-08-27T08:36:01.000Z" },
    );
    const sequenceConflict = await runEffectFailure(
      resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
        entry.restored.readiness,
        null,
        conflicting,
        "readAvailabilityHistory",
        {
          readBySequence: () => Effect.succeed(Option.some(occupant)),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(sequenceConflict).toMatchObject({
      operation: "readAvailabilityHistory",
      reason: "immutableConflict",
    });
    expect(digestReads).toBe(0);

    const byDigest = await runEffect(
      resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
        entry.restored.readiness,
        null,
        entry.restored.history,
        "readAvailabilityHistory",
        {
          readBySequence: () => Effect.succeed(Option.none()),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.some(occupant));
          },
        },
      ),
    );
    expect(Option.getOrThrow(byDigest).storageId).toBe(entry.restored.storageId);
    expect(digestReads).toBe(1);

    const digestConflict = await runEffectFailure(
      resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
        entry.restored.readiness,
        null,
        conflicting,
        "readAvailabilityHistory",
        {
          readBySequence: () => Effect.succeed(Option.none()),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.some(occupant));
          },
        },
      ),
    );
    expect(digestConflict).toMatchObject({
      operation: "readAvailabilityHistory",
      reason: "immutableConflict",
    });
    expect(digestReads).toBe(2);

    const absent = await runEffect(
      resolveAuthenticatedFrameworkSchemaAvailabilityHistoryOccupantsEffect(
        entry.restored.readiness,
        null,
        entry.restored.history,
        "readAvailabilityHistory",
        {
          readBySequence: () => Effect.succeed(Option.none()),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(Option.isNone(absent)).toBe(true);
    expect(digestReads).toBe(3);
  }, PGLITE_TEST_TIMEOUT);

  it("refuses an immutable sequence conflict without mutating history", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedAvailabilityHistoryFixture(persistence, 1);
    const entry = stored.entries[0];
    if (entry === undefined) throw new Error("Missing availability history");
    const conflicting = await captureAvailability(
      entry.restored.readiness,
      null,
      { ...availabilitySpecs[0], recordedAt: "2026-08-27T08:36:01.000Z" },
    );
    const before = await storedAvailabilityHistoryRows(persistence);
    const appendFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          entry.restored.readiness,
          null,
          conflicting,
        ),
      ),
    );
    expect(appendFailure).toMatchObject({
      operation: "appendAvailabilityHistory",
      reason: "immutableConflict",
    });
    const readFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          entry.restored.readiness,
          null,
          conflicting,
        ),
      ),
    );
    expect(readFailure).toMatchObject({
      operation: "readAvailabilityHistory",
      reason: "immutableConflict",
    });
    await expect(storedAvailabilityHistoryRows(persistence)).resolves.toEqual(
      before,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("refuses forged and mismatched private dependency authority", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedAvailabilityHistoryFixture(persistence, 2);
    const root = stored.entries[1]?.restored;
    if (root === undefined) throw new Error("Missing dependency history");
    const exact = exactAvailabilityInput(root);
    if (exact.previous === null) throw new Error("Missing exact predecessor");
    const forgedReadiness = Object.freeze({ ...exact.readiness });
    const forgedPrevious = Object.freeze({ ...exact.previous });
    const before = await storedAvailabilityHistoryRows(persistence);

    for (const [readiness, previous] of [
      [forgedReadiness, exact.previous],
      [exact.readiness, forgedPrevious],
      [exact.readiness, root],
    ] as const) {
      const failure = await persistence.drizzle.transaction(
        transaction => runEffectFailure(
          readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
            transaction,
            readiness,
            previous,
            exact.history,
          ),
        ),
      );
      expect(failure).toMatchObject({
        operation: "readAvailabilityHistory",
        reason: "referenceRefusal",
      });
    }
    await expect(storedAvailabilityHistoryRows(persistence)).resolves.toEqual(
      before,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("rejects projected, changed, oversized, cyclic, broken, and corrupt-ancestor state", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await storedAvailabilityHistoryFixture(
      projectionPersistence,
      2,
    );
    const projectionRoot = projection.entries[1];
    if (projectionRoot === undefined) {
      throw new Error("Missing projected history");
    }
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).set({ reasonSha256: new Uint8Array(32).fill(0x7f) }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      projectionRoot.restored.storageId,
    ));
    const projectionBefore = await storedAvailabilityHistoryRows(
      projectionPersistence,
    );
    const projectionInput = exactAvailabilityInput(projectionRoot.restored);
    await expectStoredCorruption(
      projectionPersistence,
      "readAvailabilityHistory",
      transaction => readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
        transaction,
        projectionInput.readiness,
        projectionInput.previous,
        projectionInput.history,
      ),
    );
    await expectStoredCorruption(
      projectionPersistence,
      "appendAvailabilityHistory",
      transaction =>
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          projectionInput.readiness,
          projectionInput.previous,
          projectionInput.history,
        ),
    );
    await expect(
      storedAvailabilityHistoryRows(projectionPersistence),
    ).resolves.toEqual(projectionBefore);

    const changedPersistence = await createMigratedPGlitePersistence();
    const changed = await storedAvailabilityHistoryFixture(
      changedPersistence,
      1,
    );
    const changedEntry = changed.entries[0];
    if (changedEntry === undefined) throw new Error("Missing changed history");
    const changedBytes = canonicalBytes(changedEntry.history);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await changedPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      changedEntry.restored.storageId,
    ));
    const changedBefore = await storedAvailabilityHistoryRows(
      changedPersistence,
    );
    const changedInput = exactAvailabilityInput(changedEntry.restored);
    await expectStoredCorruption(
      changedPersistence,
      "readAvailabilityHistory",
      transaction => readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
        transaction,
        changedInput.readiness,
        changedInput.previous,
        changedInput.history,
      ),
    );
    await expect(
      storedAvailabilityHistoryRows(changedPersistence),
    ).resolves.toEqual(changedBefore);

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await storedAvailabilityHistoryFixture(
      oversizedPersistence,
      1,
    );
    const oversizedEntry = oversized.entries[0];
    if (oversizedEntry === undefined) {
      throw new Error("Missing oversized history");
    }
    await oversizedPersistence.query(`
      alter table fx_system_framework_schema_availability_history
        drop constraint fx_framework_availability_history_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      oversizedEntry.restored.storageId,
    ));
    const oversizedBefore = await storedAvailabilityHistoryRows(
      oversizedPersistence,
    );
    const oversizedInput = exactAvailabilityInput(oversizedEntry.restored);
    await expectStoredCorruption(
      oversizedPersistence,
      "readAvailabilityHistory",
      transaction => readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
        transaction,
        oversizedInput.readiness,
        oversizedInput.previous,
        oversizedInput.history,
      ),
    );
    await expectStoredCorruption(
      oversizedPersistence,
      "appendAvailabilityHistory",
      transaction =>
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          oversizedInput.readiness,
          oversizedInput.previous,
          oversizedInput.history,
        ),
    );
    await expect(
      storedAvailabilityHistoryRows(oversizedPersistence),
    ).resolves.toEqual(oversizedBefore);

    const cyclePersistence = await createMigratedPGlitePersistence();
    const cycle = await storedAvailabilityHistoryFixture(cyclePersistence, 3);
    const cycleSecond = cycle.entries[1];
    const cycleRoot = cycle.entries[2];
    if (cycleSecond === undefined || cycleRoot === undefined) {
      throw new Error("Missing cycle history");
    }
    await cyclePersistence.query(`
      alter table fx_system_framework_schema_availability_history
        drop constraint fx_framework_availability_history_previous_fk
    `);
    await cyclePersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).set({ previousHistoryStorageId: cycleRoot.restored.storageId }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      cycleSecond.restored.storageId,
    ));
    const cycleBefore = await storedAvailabilityHistoryRows(cyclePersistence);
    await expectStoredCorruption(
      cyclePersistence,
      "readAvailabilityHistory",
      transaction =>
        corroborateRestoredFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          cycleRoot.restored,
          "readAvailabilityHistory",
        ),
    );
    await expect(
      storedAvailabilityHistoryRows(cyclePersistence),
    ).resolves.toEqual(cycleBefore);

    const brokenPersistence = await createMigratedPGlitePersistence();
    const broken = await storedAvailabilityHistoryFixture(
      brokenPersistence,
      2,
    );
    const brokenFirst = broken.entries[0];
    const brokenRoot = broken.entries[1];
    if (brokenFirst === undefined || brokenRoot === undefined) {
      throw new Error("Missing broken-chain history");
    }
    await brokenPersistence.query(`
      alter table fx_system_framework_schema_availability_history
        drop constraint fx_framework_availability_history_previous_fk
    `);
    await brokenPersistence.drizzle.delete(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      brokenFirst.restored.storageId,
    ));
    const brokenBefore = await storedAvailabilityHistoryRows(
      brokenPersistence,
    );
    await expectStoredCorruption(
      brokenPersistence,
      "readAvailabilityHistory",
      transaction =>
        restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect(
          transaction,
          brokenRoot.restored.installation,
          brokenRoot.restored.storageId,
          brokenRoot.history.frame.availabilitySequence,
          brokenRoot.history.frame.status,
          brokenRoot.history.sha256,
          "readAvailabilityHistory",
        ),
    );
    await expect(
      storedAvailabilityHistoryRows(brokenPersistence),
    ).resolves.toEqual(brokenBefore);

    const ancestorPersistence = await createMigratedPGlitePersistence();
    const ancestor = await storedAvailabilityHistoryFixture(
      ancestorPersistence,
      3,
    );
    const ancestorFirst = ancestor.entries[0];
    const ancestorRoot = ancestor.entries[2];
    if (ancestorFirst === undefined || ancestorRoot === undefined) {
      throw new Error("Missing ancestor history");
    }
    await ancestorPersistence.query(`
      alter table fx_system_framework_schema_availability_history
        drop constraint fx_framework_availability_history_frame_check
    `);
    const oversizedAncestorBytes = new Uint8Array(
      MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await ancestorPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHistory,
    ).set({
      canonicalByteLength: oversizedAncestorBytes.byteLength,
      canonicalBytes: oversizedAncestorBytes,
    }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHistory.availabilityHistoryStorageId,
      ancestorFirst.restored.storageId,
    ));
    const ancestorBefore = await storedAvailabilityHistoryRows(
      ancestorPersistence,
    );
    await expectStoredCorruption(
      ancestorPersistence,
      "readAvailabilityHistory",
      transaction =>
        restoreStoredFrameworkSchemaAvailabilityHistoryReferenceInTransactionEffect(
          transaction,
          ancestorRoot.restored.installation,
          ancestorRoot.restored.storageId,
          ancestorRoot.history.frame.availabilitySequence,
          ancestorRoot.history.frame.status,
          ancestorRoot.history.sha256,
          "readAvailabilityHistory",
        ),
    );
    await expect(
      storedAvailabilityHistoryRows(ancestorPersistence),
    ).resolves.toEqual(ancestorBefore);
  }, PGLITE_TEST_TIMEOUT);

  it("follows caller rollback and preserves the exact driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const prepared = await persistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulReadinessGraphInTransaction(
          transaction,
          values,
        );
        const history = await captureAvailability(
          graph.readiness,
          null,
          availabilitySpecs[0],
        );
        return Object.freeze({ graph, history });
      },
    );
    const rollback = new Error("deliberate availability-history rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          prepared.graph.readiness,
          null,
          prepared.history,
        ),
      );
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(availabilityHistoryCount(persistence)).resolves.toBe("0");

    const cause = new Error("availability-history driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          rejectingAvailabilityHistoryRootSelectTransaction(
            transaction,
            cause,
          ),
          prepared.graph.readiness,
          null,
          prepared.history,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readAvailabilityHistory",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function storedAvailabilityHistoryFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  length: number,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const graph = await storeSuccessfulReadinessGraphInTransaction(
      transaction,
      values,
    );
    const entries: AvailabilityEntry[] = [];
    let previous: RestoredFrameworkSchemaAvailabilityHistory | null = null;
    for (const spec of availabilitySpecs.slice(0, length)) {
      const readiness: RestoredFrameworkSchemaReadiness =
        previous?.readiness ?? graph.readiness;
      const history = await captureAvailability(readiness, previous, spec);
      const restored: RestoredFrameworkSchemaAvailabilityHistory =
        await runEffect(
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          readiness,
          previous,
          history,
        ),
      );
      entries.push(Object.freeze({ history, restored }));
      previous = restored;
    }
    return Object.freeze({ graph, entries: Object.freeze(entries) });
  });
}

function captureAvailability(
  readiness: RestoredFrameworkSchemaReadiness,
  previous: RestoredFrameworkSchemaAvailabilityHistory | null,
  spec: AvailabilitySpec,
): Promise<FrameworkSchemaAvailabilityHistory> {
  return runEffect(captureFrameworkSchemaAvailabilityHistory({
    readiness: readiness.readiness,
    previous: previous?.history ?? null,
    status: spec.status,
    reasonSha256: spec.reasonSha256,
    recordedAt: spec.recordedAt,
  }));
}

async function availabilityHistoryCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_schema_availability_history
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing availability-history count");
  return row.count;
}

async function storedAvailabilityHistoryRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkSchemaAvailabilityHistory,
  ).orderBy(asc(
    fxSystemFrameworkSchemaAvailabilityHistory.availabilitySequence,
  ));
  return rows.map(row => ({
    availabilityHistoryStorageId: row.availabilityHistoryStorageId,
    installationStorageId: row.installationStorageId,
    readinessStorageId: row.readinessStorageId,
    readinessSha256: Encoding.encodeHex(row.readinessSha256),
    availabilitySequence: row.availabilitySequence,
    status: row.status,
    reasonSha256: row.reasonSha256 === null
      ? null
      : Encoding.encodeHex(row.reasonSha256),
    historySha256: Encoding.encodeHex(row.historySha256),
    previousHistoryStorageId: row.previousHistoryStorageId,
    previousAvailabilitySequence: row.previousAvailabilitySequence,
    previousHistorySha256: row.previousHistorySha256 === null
      ? null
      : Encoding.encodeHex(row.previousHistorySha256),
    previousStatus: row.previousStatus,
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function exactAvailabilityInput(
  value: RestoredFrameworkSchemaAvailabilityHistory,
): Readonly<{
  readiness: RestoredFrameworkSchemaReadiness;
  previous: RestoredFrameworkSchemaAvailabilityHistory | null;
  history: FrameworkSchemaAvailabilityHistory;
}> {
  const authority = restoredFrameworkSchemaAvailabilityHistoryAuthority(value);
  if (authority === undefined) throw new Error("Missing history authority");
  return Object.freeze({
    readiness: value.readiness,
    previous: authority.previous,
    history: value.history,
  });
}

function expectRestoredHistoryIdentity(
  value: RestoredFrameworkSchemaAvailabilityHistory,
  expectedPrevious: RestoredFrameworkSchemaAvailabilityHistory | null,
): void {
  expect(value.installation).toBe(value.readiness.installation);
  const authority = restoredFrameworkSchemaAvailabilityHistoryAuthority(value);
  if (authority === undefined) throw new Error("Missing history authority");
  if (expectedPrevious === null) {
    expect(authority.previous).toBeNull();
    return;
  }
  const previous = authority.previous;
  if (previous === null) throw new Error("Missing restored predecessor");
  expect(previous.storageId).toBe(expectedPrevious.storageId);
  expect(previous.history).toEqual(expectedPrevious.history);
  expect(previous.readiness).toBe(value.readiness);
  expect(previous.installation).toBe(value.installation);
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "appendAvailabilityHistory" | "readAvailabilityHistory",
  effect: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<unknown, FrameworkMigrationRepositoryError>,
): Promise<void> {
  const failure = await persistence.drizzle.transaction(
    transaction => runEffectFailure(effect(transaction)),
  );
  expect(failure).toMatchObject({ operation, reason: "storedCorruption" });
}

function canonicalBytes(value: Readonly<{ canonicalJson: string }>): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function rejectingAvailabilityHistoryRootSelectTransaction(
  transaction: FlarexMetadataTransaction,
  cause: unknown,
): FlarexMetadataTransaction {
  function rejectAtLimit(input: UnknownRecord): UnknownRecord {
    return new Proxy(input, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "limit") return () => Promise.reject(cause);
        return (...args: unknown[]) => {
          const next = Reflect.apply(member, target, args);
          if (!isNonArrayRecord(next)) {
            throw new TypeError(
              "Availability-history read builder must remain an object",
            );
          }
          return rejectAtLimit(next);
        };
      },
    });
  }

  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      const select = Reflect.get(target, property, receiver);
      if (typeof select !== "function") return select;
      return (...args: unknown[]) => {
        const query = Reflect.apply(select, target, args);
        if (!isAvailabilityHistoryRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError(
            "Availability-history select must return an object",
          );
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isAvailabilityHistoryRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "availabilityHistoryStorageId") &&
    Object.hasOwn(input, "historySha256") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
