import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import {
  compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect,
  initializeFrameworkSchemaAvailabilityHeadInTransactionEffect,
  readFrameworkSchemaAvailabilityHeadInTransactionEffect,
} from
  "../src/frameworkSchema/installation/availabilityHeadRepository";
import {
  appendFrameworkSchemaAvailabilityHistoryInTransactionEffect,
} from
  "../src/frameworkSchema/installation/availabilityHistoryRepository";
import {
  capturedAuthorityForFrameworkSchemaAvailabilityHead,
} from "../src/frameworkSchema/installation/authority";
import {
  MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES,
  captureFrameworkSchemaAvailabilityHead,
  captureFrameworkSchemaAvailabilityHistory,
} from "../src/frameworkSchema/installation/canonical";
import {
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
  FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
  type FrameworkSchemaAvailabilityHead,
  type FrameworkSchemaAvailabilityStatus,
} from "../src/frameworkSchema/installation/model";
import { fxSystemFrameworkSchemaAvailabilityHeads } from
  "../src/frameworkSchema/installation/schema";
import {
  isRestoredFrameworkSchemaAvailabilityHead,
  type RestoredFrameworkSchemaAvailabilityHead,
  type RestoredFrameworkSchemaAvailabilityHistory,
} from
  "../src/frameworkSchema/installation/storedMetadataRestoration";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulAvailabilityHistoryGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 180_000;

type AvailabilitySpec = Readonly<{
  status: FrameworkSchemaAvailabilityStatus;
  reasonSha256: string | null;
  recordedAt: string;
}>;

const laterAvailabilitySpecs = Object.freeze([
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

describe("framework coordinator schema-availability-head repository", () => {
  it("keeps the mutable head kernel and authority source-private", async () => {
    expect(
      "initializeFrameworkSchemaAvailabilityHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkSchemaAvailabilityHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect("isRestoredFrameworkSchemaAvailabilityHead" in persistenceRoot)
      .toBe(false);
    expect(
      "capturedAuthorityForFrameworkSchemaAvailabilityHead" in persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/frameworkSchema/installation/availabilityHeadRepository.ts",
    );
  });

  it("reads absence, initializes exact normalized storage, and replays", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(async transaction => {
      const prepared = await prepareAvailabilityHeadGraph(transaction, values);
      const missing = await runEffect(
        readFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          prepared.histories.initial.installation,
        ),
      );
      expect(Option.isNone(missing)).toBe(true);
      const initialized = await runEffect(
        initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          prepared.histories.initial,
          prepared.heads.initial,
        ),
      );
      const replayed = await runEffect(
        initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          prepared.histories.initial,
          prepared.heads.initial,
        ),
      );
      const read = Option.getOrThrow(await runEffect(
        readFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          prepared.histories.initial.installation,
        ),
      ));
      expect(replayed).toEqual(initialized);
      expect(read).toEqual(initialized);
      expectAvailabilityHeadIdentity(initialized);
      expectAvailabilityHeadIdentity(replayed);
      expectAvailabilityHeadIdentity(read);
      return Object.freeze({ ...prepared, initialized });
    });

    await expect(availabilityHeadCount(persistence)).resolves.toBe("1");
    await expect(storedAvailabilityHeadRow(persistence)).resolves.toEqual(
      expectedAvailabilityHeadRow(stored.initialized),
    );

    const independentlyCaptured = await captureHead(stored.initialized.history);
    expect(independentlyCaptured).not.toBe(stored.heads.initial);
    const separateReplay = await persistence.drizzle.transaction(
      transaction => runEffect(
        initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.initialized.history,
          independentlyCaptured,
        ),
      ),
    );
    expect(separateReplay.head.sha256).toBe(stored.initialized.head.sha256);
    expectAvailabilityHeadIdentity(separateReplay);
  }, PGLITE_TEST_TIMEOUT);

  it("applies exact CAS without adding sequence or transition policy", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await initializedAvailabilityHeadFixture(persistence);
    expect(stored.histories.ready.history.frame.availabilitySequence).toBe("3");

    const advanced = await persistence.drizzle.transaction(
      transaction => runEffect(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.initialized,
          stored.histories.ready,
          stored.heads.ready,
        ),
      ),
    );
    expect(advanced.head.sha256).toBe(stored.heads.ready.sha256);
    expect(advanced.head.frame.availabilitySequence).toBe("3");
    expectAvailabilityHeadIdentity(advanced);
    await expect(storedAvailabilityHeadRow(persistence)).resolves.toEqual(
      expectedAvailabilityHeadRow(advanced),
    );

    const beforeStale = await storedAvailabilityHeadRow(persistence);
    const stale = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.initialized,
          stored.histories.withdrawn,
          stored.heads.withdrawn,
        ),
      ),
    );
    expect(stale).toMatchObject({
      operation: "compareAndSwapAvailabilityHead",
      reason: "staleHead",
    });
    await expect(storedAvailabilityHeadRow(persistence)).resolves.toEqual(
      beforeStale,
    );

    const movedBackward = await persistence.drizzle.transaction(
      transaction => runEffect(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          advanced,
          stored.histories.initial,
          stored.heads.initial,
        ),
      ),
    );
    expect(movedBackward.head.frame.availabilitySequence).toBe("1");
    expect(movedBackward.head.sha256).toBe(stored.heads.initial.sha256);
    await expect(storedAvailabilityHeadRow(persistence)).resolves.toEqual(
      expectedAvailabilityHeadRow(movedBackward),
    );
  }, PGLITE_TEST_TIMEOUT);

  it("reports stale initialization and refuses forged dependency authority", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await initializedAvailabilityHeadFixture(persistence);
    const before = await storedAvailabilityHeadRow(persistence);

    const stale = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.histories.ready,
          stored.heads.ready,
        ),
      ),
    );
    expect(stale).toMatchObject({
      operation: "initializeAvailabilityHead",
      reason: "staleHead",
    });

    const forgedExpected = Object.freeze({ ...stored.initialized });
    expect(isRestoredFrameworkSchemaAvailabilityHead(forgedExpected)).toBe(
      false,
    );
    const forgedExpectedFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          forgedExpected,
          stored.histories.ready,
          stored.heads.ready,
        ),
      ),
    );
    expect(forgedExpectedFailure).toMatchObject({
      operation: "compareAndSwapAvailabilityHead",
      reason: "referenceRefusal",
    });

    const forgedHistory = Object.freeze({ ...stored.histories.ready });
    const forgedHistoryFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.initialized,
          forgedHistory,
          stored.heads.ready,
        ),
      ),
    );
    expect(forgedHistoryFailure).toMatchObject({
      operation: "compareAndSwapAvailabilityHead",
      reason: "referenceRefusal",
    });
    await expect(storedAvailabilityHeadRow(persistence)).resolves.toEqual(
      before,
    );

    const emptyPersistence = await createMigratedPGlitePersistence();
    const missingInstallation = await emptyPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          stored.initialized.installation,
        ),
      ),
    );
    expect(missingInstallation).toMatchObject({
      operation: "readAvailabilityHead",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("refuses expected private history authority from another store", async () => {
    const expectedPersistence = await createMigratedPGlitePersistence();
    const actualPersistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const expected = await expectedPersistence.drizzle.transaction(
      async transaction => {
        const prepared = await prepareAvailabilityHeadGraph(
          transaction,
          values,
        );
        const initialized = await runEffect(
          initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
            transaction,
            prepared.histories.initial,
            prepared.heads.initial,
          ),
        );
        return Object.freeze({ ...prepared, initialized });
      },
    );
    await actualPersistence.query(`
      select nextval('fx_framework_availability_history_storage_id_seq')
    `);
    const actual = await actualPersistence.drizzle.transaction(
      async transaction => {
        const prepared = await prepareAvailabilityHeadGraph(
          transaction,
          values,
        );
        const initialized = await runEffect(
          initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
            transaction,
            prepared.histories.initial,
            prepared.heads.initial,
          ),
        );
        return Object.freeze({ ...prepared, initialized });
      },
    );
    expect(expected.initialized.head).toEqual(actual.initialized.head);
    expect(expected.initialized.history.storageId).not.toBe(
      actual.initialized.history.storageId,
    );
    const before = await storedAvailabilityHeadRow(actualPersistence);
    const failure = await actualPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          expected.initialized,
          actual.histories.ready,
          actual.heads.ready,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "compareAndSwapAvailabilityHead",
      reason: "referenceRefusal",
    });
    await expect(storedAvailabilityHeadRow(actualPersistence)).resolves.toEqual(
      before,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("rejects corrupt projections, references, and over-limit bytes without healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await initializedAvailabilityHeadFixture(
      projectionPersistence,
    );
    await projectionPersistence.query(`
      alter table fx_system_framework_schema_availability_head
        drop constraint fx_framework_availability_head_history_fk
    `);
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHeads,
    ).set({ status: "superseded" }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
      projection.initialized.installation.storageId,
    ));
    const projectionBefore = await storedAvailabilityHeadRow(
      projectionPersistence,
    );
    await expectStoredCorruption(
      projectionPersistence,
      "readAvailabilityHead",
      transaction => readFrameworkSchemaAvailabilityHeadInTransactionEffect(
        transaction,
        projection.initialized.installation,
      ),
    );
    await expectStoredCorruption(
      projectionPersistence,
      "compareAndSwapAvailabilityHead",
      transaction =>
        compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          projection.initialized,
          projection.histories.ready,
          projection.heads.ready,
        ),
    );
    await expect(
      storedAvailabilityHeadRow(projectionPersistence),
    ).resolves.toEqual(projectionBefore);

    const referencePersistence = await createMigratedPGlitePersistence();
    const reference = await initializedAvailabilityHeadFixture(
      referencePersistence,
    );
    await referencePersistence.query(`
      alter table fx_system_framework_schema_availability_head
        drop constraint fx_framework_availability_head_history_fk
    `);
    await referencePersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHeads,
    ).set({ availabilityHistoryStorageId: 999_999n }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
      reference.initialized.installation.storageId,
    ));
    const referenceBefore = await storedAvailabilityHeadRow(
      referencePersistence,
    );
    await expectStoredCorruption(
      referencePersistence,
      "readAvailabilityHead",
      transaction => readFrameworkSchemaAvailabilityHeadInTransactionEffect(
        transaction,
        reference.initialized.installation,
      ),
    );
    await expect(storedAvailabilityHeadRow(referencePersistence)).resolves
      .toEqual(referenceBefore);

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await initializedAvailabilityHeadFixture(
      oversizedPersistence,
    );
    await oversizedPersistence.query(`
      alter table fx_system_framework_schema_availability_head
        drop constraint fx_framework_availability_head_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_SCHEMA_AVAILABILITY_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkSchemaAvailabilityHeads,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkSchemaAvailabilityHeads.installationStorageId,
      oversized.initialized.installation.storageId,
    ));
    const oversizedBefore = await storedAvailabilityHeadRow(
      oversizedPersistence,
    );
    await expectStoredCorruption(
      oversizedPersistence,
      "readAvailabilityHead",
      transaction => readFrameworkSchemaAvailabilityHeadInTransactionEffect(
        transaction,
        oversized.initialized.installation,
      ),
    );
    await expect(storedAvailabilityHeadRow(oversizedPersistence)).resolves
      .toEqual(oversizedBefore);
  }, PGLITE_TEST_TIMEOUT);

  it("follows caller rollback and preserves the exact driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const prepared = await persistence.drizzle.transaction(
      transaction => prepareAvailabilityHeadGraph(transaction, values),
    );
    const rollback = new Error("deliberate availability-head rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
          transaction,
          prepared.histories.initial,
          prepared.heads.initial,
        ),
      );
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(availabilityHeadCount(persistence)).resolves.toBe("0");

    const cause = new Error("availability-head driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkSchemaAvailabilityHeadInTransactionEffect(
          rejectingAvailabilityHeadRootSelectTransaction(transaction, cause),
          prepared.histories.initial.installation,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readAvailabilityHead",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function initializedAvailabilityHeadFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const prepared = await prepareAvailabilityHeadGraph(transaction, values);
    const initialized = await runEffect(
      initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(
        transaction,
        prepared.histories.initial,
        prepared.heads.initial,
      ),
    );
    return Object.freeze({ ...prepared, initialized });
  });
}

async function prepareAvailabilityHeadGraph(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const first = await storeSuccessfulAvailabilityHistoryGraphInTransaction(
    transaction,
    values,
  );
  const histories: RestoredFrameworkSchemaAvailabilityHistory[] = [
    first.availabilityHistory,
  ];
  let previous: RestoredFrameworkSchemaAvailabilityHistory =
    first.availabilityHistory;
  for (const spec of laterAvailabilitySpecs) {
    const captured = await runEffect(
      captureFrameworkSchemaAvailabilityHistory({
        readiness: previous.readiness.readiness,
        previous: previous.history,
        status: spec.status,
        reasonSha256: spec.reasonSha256,
        recordedAt: spec.recordedAt,
      }),
    );
    const restored: RestoredFrameworkSchemaAvailabilityHistory =
      await runEffect(
        appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(
          transaction,
          previous.readiness,
          previous,
          captured,
        ),
      );
    histories.push(restored);
    previous = restored;
  }
  const initial = histories[0];
  const withdrawn = histories[1];
  const ready = histories[2];
  if (initial === undefined || withdrawn === undefined || ready === undefined) {
    throw new Error("Missing availability-head history fixture");
  }
  return Object.freeze({
    histories: Object.freeze({ initial, withdrawn, ready }),
    heads: Object.freeze({
      initial: await captureHead(initial),
      withdrawn: await captureHead(withdrawn),
      ready: await captureHead(ready),
    }),
  });
}

function captureHead(
  history: RestoredFrameworkSchemaAvailabilityHistory,
): Promise<FrameworkSchemaAvailabilityHead> {
  return runEffect(captureFrameworkSchemaAvailabilityHead(history.history));
}

function expectAvailabilityHeadIdentity(
  restored: RestoredFrameworkSchemaAvailabilityHead,
): void {
  expect(restored.installation).toBe(restored.readiness.installation);
  expect(restored.installation).toBe(restored.history.installation);
  expect(restored.readiness).toBe(restored.history.readiness);
  const authority = capturedAuthorityForFrameworkSchemaAvailabilityHead(
    restored.head,
  );
  expect(authority?.history).toBe(restored.history.history);
  expect(authority?.readiness).toBe(restored.readiness.readiness);
}

async function availabilityHeadCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_schema_availability_head
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing availability-head count");
  return row.count;
}

async function storedAvailabilityHeadRow(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkSchemaAvailabilityHeads,
  ).limit(2);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error("Expected one availability-head row");
  }
  const row = rows[0];
  return {
    installationStorageId: row.installationStorageId,
    readinessStorageId: row.readinessStorageId,
    availabilityHistoryStorageId: row.availabilityHistoryStorageId,
    availabilitySequence: row.availabilitySequence,
    status: row.status,
    historySha256: Encoding.encodeHex(row.historySha256),
    availabilityHeadSha256: Encoding.encodeHex(row.availabilityHeadSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  };
}

function expectedAvailabilityHeadRow(
  restored: RestoredFrameworkSchemaAvailabilityHead,
) {
  return {
    installationStorageId: restored.installation.storageId,
    readinessStorageId: restored.readiness.storageId,
    availabilityHistoryStorageId: restored.history.storageId,
    availabilitySequence: BigInt(restored.head.frame.availabilitySequence),
    status: restored.head.frame.status,
    historySha256: restored.head.frame.historySha256,
    availabilityHeadSha256: restored.head.sha256,
    frameFormat: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_FORMAT,
    frameVersion: FRAMEWORK_SCHEMA_AVAILABILITY_HEAD_VERSION,
    canonicalByteLength: canonicalBytes(restored.head).byteLength,
    canonicalBytes: canonicalBytes(restored.head),
  };
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation:
    | "readAvailabilityHead"
    | "compareAndSwapAvailabilityHead",
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

function rejectingAvailabilityHeadRootSelectTransaction(
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
              "Availability-head read builder must remain an object",
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
        if (!isAvailabilityHeadRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Availability-head select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isAvailabilityHeadRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "availabilityHeadSha256") &&
    Object.hasOwn(input, "availabilityHistoryStorageId") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
