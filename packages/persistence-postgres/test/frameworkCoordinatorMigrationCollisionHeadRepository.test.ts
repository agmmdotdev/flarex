import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import { eq } from "drizzle-orm";
import { Brand, Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationCollisionHead,
  captureFrameworkMigrationEvent,
} from "../src/migrationCoordination/canonical";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationLeaseOwnerId,
} from "../src/migrationCoordination/identity";
import {
  compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect,
  initializeFrameworkMigrationCollisionHeadInTransactionEffect,
  readFrameworkMigrationCollisionHeadInTransactionEffect,
} from "../src/migrationCoordination/migrationCollisionHeadRepository";
import {
  appendFrameworkMigrationEventInTransactionEffect,
} from "../src/migrationCoordination/migrationEventRepository";
import {
  FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationCollisionHeadFrame,
} from "../src/migrationCoordination/model";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { fxSystemFrameworkMigrationCollisionHeads } from
  "../src/migrationCoordination/schema";
import {
  restoredFrameworkMigrationCollisionHeadAuthority,
  type RestoredFrameworkMigrationCollisionHead,
  type RestoredFrameworkMigrationEvent,
} from "../src/migrationCoordination/storedEventRestoration";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulReadinessGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 180_000;
const eventSequence = Brand.nominal<CanonicalNonNegativeInt64>();
const leaseOwnerId = Brand.nominal<FrameworkMigrationLeaseOwnerId>();
const canonicalInstant = Brand.nominal<CanonicalIsoInstant>();

type FrameworkMigrationCollisionHead = CapturedFrameworkMigrationValue<
  FrameworkMigrationCollisionHeadFrame,
  RestoredFrameworkMigrationCollisionHead["head"]["sha256"]
>;

describe("framework coordinator migration-collision-head repository", () => {
  it("keeps the mutable head kernel and dependency authority source-private", async () => {
    expect(
      "initializeFrameworkMigrationCollisionHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationCollisionHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoredFrameworkMigrationCollisionHeadAuthority" in persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationCollisionHeadRepository.ts",
    );
  });

  it("reads absence, initializes exact normalized storage, and replays", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(async transaction => {
      const prepared = await prepareCollisionHeadGraph(transaction, values);
      const missing = await runEffect(
        readFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
        ),
      );
      expect(Option.isNone(missing)).toBe(true);
      const initialized = await runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
          prepared.graph.admission,
          prepared.graph.attempt,
          prepared.events.started,
          prepared.initialValue,
        ),
      );
      const replayed = await runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
          prepared.graph.admission,
          prepared.graph.attempt,
          prepared.events.started,
          prepared.initialValue,
        ),
      );
      const read = Option.getOrThrow(await runEffect(
        readFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
        ),
      ));
      expect(replayed).toEqual(initialized);
      expect(read).toEqual(initialized);
      const authority = restoredFrameworkMigrationCollisionHeadAuthority(
        initialized,
      );
      expect(authority?.currentAttempt?.storageId).toBe(
        prepared.graph.attempt.storageId,
      );
      expect(authority?.lastEvent?.storageId).toBe(
        prepared.events.started.storageId,
      );
      expect(authority?.currentAttempt?.collision).toBe(initialized.collision);
      expect(authority?.currentAttempt?.plan).toBe(initialized.plan);
      expect(authority?.currentAttempt?.admission).toBe(initialized.admission);
      expect(authority?.lastEvent?.collision).toBe(initialized.collision);
      expect(initialized.admission.plan).toBe(initialized.plan);
      return { ...prepared, initialized };
    });

    await expect(collisionHeadCount(persistence)).resolves.toBe("1");
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      expectedCollisionHeadRow(
        stored.initialized,
        stored.graph.attempt.storageId,
        stored.events.started.storageId,
      ),
    );

    const independentlyCaptured = await captureInitialHead(
      stored.graph,
      stored.events.started,
    );
    expect(independentlyCaptured).not.toBe(stored.initialValue);
    const separateReplay = await persistence.drizzle.transaction(
      transaction => runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.graph.collision,
          stored.graph.admission,
          stored.graph.attempt,
          stored.events.started,
          independentlyCaptured,
        ),
      ),
    );
    expect(separateReplay.head.sha256).toBe(stored.initialized.head.sha256);
  }, PGLITE_TEST_TIMEOUT);

  it("stores and advances the all-null optional projections", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(async transaction => {
      const prepared = await prepareCollisionHeadGraph(transaction, values);
      const emptyValue = await captureEmptyHead(prepared.graph);
      const initialized = await runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
          prepared.graph.admission,
          null,
          null,
          emptyValue,
        ),
      );
      const replayed = await runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
          prepared.graph.admission,
          null,
          null,
          emptyValue,
        ),
      );
      const read = Option.getOrThrow(await runEffect(
        readFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
        ),
      ));
      expect(replayed).toEqual(initialized);
      expect(read).toEqual(initialized);
      expect(restoredFrameworkMigrationCollisionHeadAuthority(initialized))
        .toEqual({ currentAttempt: null, lastEvent: null });
      return { ...prepared, emptyValue, initialized };
    });

    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      expectedCollisionHeadRow(stored.initialized, null, null),
    );

    const advanced = await persistence.drizzle.transaction(
      transaction => runEffect(
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.initialized,
          stored.graph.admission,
          stored.graph.attempt,
          stored.events.started,
          stored.initialValue,
        ),
      ),
    );
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      expectedCollisionHeadRow(
        advanced,
        stored.graph.attempt.storageId,
        stored.events.started.storageId,
      ),
    );
    const cleared = await persistence.drizzle.transaction(
      transaction => runEffect(
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          advanced,
          stored.graph.admission,
          null,
          null,
          stored.emptyValue,
        ),
      ),
    );
    expect(restoredFrameworkMigrationCollisionHeadAuthority(cleared)).toEqual({
      currentAttempt: null,
      lastEvent: null,
    });
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      expectedCollisionHeadRow(cleared, null, null),
    );
  }, PGLITE_TEST_TIMEOUT);

  it("applies exact CAS without adding revision or lease-transition policy", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await initializedCollisionHeadFixture(persistence);
    expect(stored.nextValue.frame.headRevision).toBe(
      stored.initialized.head.frame.headRevision,
    );
    expect(stored.nextValue.frame.currentAttempt?.leaseOwnerId).toBe(
      leaseOwnerId("worker-b"),
    );
    expect(stored.graph.attempt.attempt.frame.leaseOwnerId).not.toBe(
      leaseOwnerId("worker-b"),
    );

    const advanced = await persistence.drizzle.transaction(
      transaction => runEffect(
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.initialized,
          stored.graph.admission,
          stored.graph.attempt,
          stored.events.renewed,
          stored.nextValue,
        ),
      ),
    );
    expect(advanced.head.sha256).toBe(stored.nextValue.sha256);
    expect(advanced.head.sha256).not.toBe(stored.initialized.head.sha256);
    expect(advanced.head.frame.currentAttempt?.leaseOwnerId).toBe(
      leaseOwnerId("worker-b"),
    );
    expect(advanced.head.frame.currentAttempt?.leaseExpiresAt).toBe(
      canonicalInstant("2026-08-27T08:42:00.000Z"),
    );
    expect(advanced.head.frame.lastEvent).toEqual({
      sequence: stored.events.renewed.event.frame.sequence,
      eventSha256: stored.events.renewed.event.sha256,
    });
    const advancedAuthority = restoredFrameworkMigrationCollisionHeadAuthority(
      advanced,
    );
    expect(advancedAuthority?.currentAttempt?.collision).toBe(
      advanced.collision,
    );
    expect(advancedAuthority?.currentAttempt?.plan).toBe(advanced.plan);
    expect(advancedAuthority?.currentAttempt?.admission).toBe(
      advanced.admission,
    );
    expect(advancedAuthority?.lastEvent?.collision).toBe(advanced.collision);
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      expectedCollisionHeadRow(
        advanced,
        stored.graph.attempt.storageId,
        stored.events.renewed.storageId,
      ),
    );

    const beforeStale = await storedCollisionHeadRow(persistence);
    const stale = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.initialized,
          stored.graph.admission,
          stored.graph.attempt,
          stored.events.renewed,
          stored.nextValue,
        ),
      ),
    );
    expect(stale).toMatchObject({
      operation: "compareAndSwapCollisionHead",
      reason: "staleHead",
    });
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(
      beforeStale,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("refuses an expected head whose private event authority belongs to another store", async () => {
    const expectedPersistence = await createMigratedPGlitePersistence();
    const actualPersistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const expected = await expectedPersistence.drizzle.transaction(
      async transaction => {
        const prepared = await prepareCollisionHeadGraph(transaction, values);
        const initialized = await runEffect(
          initializeFrameworkMigrationCollisionHeadInTransactionEffect(
            transaction,
            prepared.graph.collision,
            prepared.graph.admission,
            prepared.graph.attempt,
            prepared.events.started,
            prepared.initialValue,
          ),
        );
        return { ...prepared, initialized };
      },
    );
    const actual = await actualPersistence.drizzle.transaction(
      async transaction => {
        const graph = await storeSuccessfulReadinessGraphInTransaction(
          transaction,
          values,
        );
        await appendDistractorHeadEvent(transaction, graph);
        const events = await appendHeadEventChain(transaction, graph);
        const initialValue = await captureInitialHead(graph, events.started);
        const nextValue = await captureRenewedHead(graph, events.renewed);
        const initialized = await runEffect(
          initializeFrameworkMigrationCollisionHeadInTransactionEffect(
            transaction,
            graph.collision,
            graph.admission,
            graph.attempt,
            events.started,
            initialValue,
          ),
        );
        return { graph, events, initialValue, nextValue, initialized };
      },
    );

    expect(expected.initialized).toEqual(actual.initialized);
    const expectedAuthority = restoredFrameworkMigrationCollisionHeadAuthority(
      expected.initialized,
    );
    const actualAuthority = restoredFrameworkMigrationCollisionHeadAuthority(
      actual.initialized,
    );
    expect(expectedAuthority?.lastEvent?.storageId).not.toBe(
      actualAuthority?.lastEvent?.storageId,
    );
    const before = await storedCollisionHeadRow(actualPersistence);
    const failure = await actualPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          expected.initialized,
          actual.graph.admission,
          actual.graph.attempt,
          actual.events.renewed,
          actual.nextValue,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "compareAndSwapCollisionHead",
      reason: "referenceRefusal",
    });
    await expect(storedCollisionHeadRow(actualPersistence)).resolves.toEqual(
      before,
    );
  }, PGLITE_TEST_TIMEOUT);

  it("reports a different initialized incumbent as stale without mutation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await initializedCollisionHeadFixture(persistence);
    const before = await storedCollisionHeadRow(persistence);
    const stale = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.graph.collision,
          stored.graph.admission,
          stored.graph.attempt,
          stored.events.renewed,
          stored.nextValue,
        ),
      ),
    );
    expect(stale).toMatchObject({
      operation: "initializeCollisionHead",
      reason: "staleHead",
    });
    await expect(storedCollisionHeadRow(persistence)).resolves.toEqual(before);

    const emptyPersistence = await createMigratedPGlitePersistence();
    const missing = await emptyPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          stored.graph.collision,
        ),
      ),
    );
    expect(missing).toMatchObject({
      operation: "readCollisionHead",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("rejects corrupt projections and over-limit bytes without CAS healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await initializedCollisionHeadFixture(
      projectionPersistence,
    );
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkMigrationCollisionHeads,
    ).set({ currentLeaseOwnerId: "worker-corrupt" }).where(eq(
      fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
      projection.graph.collision.storageId,
    ));
    const projectionBefore = await storedCollisionHeadRow(
      projectionPersistence,
    );
    await expectStoredCorruption(
      projectionPersistence,
      "readCollisionHead",
      transaction => readFrameworkMigrationCollisionHeadInTransactionEffect(
        transaction,
        projection.graph.collision,
      ),
    );
    await expectStoredCorruption(
      projectionPersistence,
      "compareAndSwapCollisionHead",
      transaction =>
        compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          projection.initialized,
          projection.graph.admission,
          projection.graph.attempt,
          projection.events.renewed,
          projection.nextValue,
        ),
    );
    await expect(storedCollisionHeadRow(projectionPersistence)).resolves
      .toEqual(projectionBefore);

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await initializedCollisionHeadFixture(
      oversizedPersistence,
    );
    await oversizedPersistence.query(`
      alter table fx_system_framework_migration_collision_head
        drop constraint fx_framework_migration_collision_head_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkMigrationCollisionHeads,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
      oversized.graph.collision.storageId,
    ));
    const oversizedBefore = await storedCollisionHeadRow(oversizedPersistence);
    await expectStoredCorruption(
      oversizedPersistence,
      "readCollisionHead",
      transaction => readFrameworkMigrationCollisionHeadInTransactionEffect(
        transaction,
        oversized.graph.collision,
      ),
    );
    await expect(storedCollisionHeadRow(oversizedPersistence)).resolves
      .toEqual(oversizedBefore);
  }, PGLITE_TEST_TIMEOUT);

  it("follows caller rollback and preserves the exact driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const prepared = await persistence.drizzle.transaction(
      transaction => prepareCollisionHeadGraph(transaction, values),
    );
    const rollback = new Error("deliberate collision head rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        initializeFrameworkMigrationCollisionHeadInTransactionEffect(
          transaction,
          prepared.graph.collision,
          prepared.graph.admission,
          prepared.graph.attempt,
          prepared.events.started,
          prepared.initialValue,
        ),
      );
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(collisionHeadCount(persistence)).resolves.toBe("0");

    const cause = new Error("collision head driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationCollisionHeadInTransactionEffect(
          rejectingCollisionHeadRootSelectTransaction(transaction, cause),
          prepared.graph.collision,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readCollisionHead",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function initializedCollisionHeadFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const prepared = await prepareCollisionHeadGraph(transaction, values);
    const initialized = await runEffect(
      initializeFrameworkMigrationCollisionHeadInTransactionEffect(
        transaction,
        prepared.graph.collision,
        prepared.graph.admission,
        prepared.graph.attempt,
        prepared.events.started,
        prepared.initialValue,
      ),
    );
    return { ...prepared, initialized };
  });
}

async function prepareCollisionHeadGraph(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof createSuccessfulTerminalPlanValues>>,
) {
  const graph = await storeSuccessfulReadinessGraphInTransaction(
    transaction,
    values,
  );
  const events = await appendHeadEventChain(transaction, graph);
  const initialValue = await captureInitialHead(graph, events.started);
  const nextValue = await captureRenewedHead(graph, events.renewed);
  return { graph, events, initialValue, nextValue };
}

async function appendHeadEventChain(
  transaction: FlarexMetadataTransaction,
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
) {
  const admittedValue = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence: eventSequence("5"),
    previousEvent: null,
    recordedAt: graph.admission.admission.frame.admittedAt,
    kind: "planAdmitted",
    admissionSha256: graph.admission.admission.sha256,
  }));
  const admitted = await runEffect(
    appendFrameworkMigrationEventInTransactionEffect(
      transaction,
      graph.collision,
      null,
      Object.freeze({
        kind: "planAdmitted",
        admission: graph.admission,
      }),
      admittedValue,
    ),
  );
  const startedValue = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence: eventSequence("8"),
    previousEvent: Object.freeze({
      sequence: admitted.event.frame.sequence,
      eventSha256: admitted.event.sha256,
    }),
    recordedAt: graph.attempt.attempt.frame.startedAt,
    kind: "attemptStarted",
    attemptStartSha256: graph.attempt.attempt.sha256,
  }));
  const started = await runEffect(
    appendFrameworkMigrationEventInTransactionEffect(
      transaction,
      graph.collision,
      admitted,
      Object.freeze({
        kind: "attemptStarted",
        attempt: graph.attempt,
      }),
      startedValue,
    ),
  );
  const renewedValue = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence: eventSequence("13"),
    previousEvent: Object.freeze({
      sequence: started.event.frame.sequence,
      eventSha256: started.event.sha256,
    }),
    recordedAt: canonicalInstant("2026-08-27T08:40:02.000Z"),
    kind: "leaseRenewed",
    attemptId: graph.attempt.attempt.frame.attemptId,
    attemptFence: graph.attempt.attempt.frame.attemptFence,
    leaseOwnerId: leaseOwnerId("worker-b"),
    leaseExpiresAt: canonicalInstant("2026-08-27T08:42:00.000Z"),
  }));
  const renewed = await runEffect(
    appendFrameworkMigrationEventInTransactionEffect(
      transaction,
      graph.collision,
      started,
      Object.freeze({
        kind: "leaseRenewed",
        attempt: graph.attempt,
      }),
      renewedValue,
    ),
  );
  return Object.freeze({ admitted, started, renewed });
}

async function appendDistractorHeadEvent(
  transaction: FlarexMetadataTransaction,
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
): Promise<void> {
  const event = await runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence: eventSequence("2"),
    previousEvent: null,
    recordedAt: canonicalInstant("2026-08-27T08:39:59.000Z"),
    kind: "planAdmitted",
    admissionSha256: graph.admission.admission.sha256,
  }));
  await runEffect(appendFrameworkMigrationEventInTransactionEffect(
    transaction,
    graph.collision,
    null,
    Object.freeze({ kind: "planAdmitted", admission: graph.admission }),
    event,
  ));
}

function captureInitialHead(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
  lastEvent: RestoredFrameworkMigrationEvent,
): Promise<FrameworkMigrationCollisionHead> {
  return runEffect(captureFrameworkMigrationCollisionHead({
    admission: graph.admission.admission,
    headRevision: "1",
    attemptFence: graph.attempt.attempt.frame.attemptFence,
    currentAttempt: Object.freeze({
      attemptId: graph.attempt.attempt.frame.attemptId,
      attemptFence: graph.attempt.attempt.frame.attemptFence,
      leaseOwnerId: graph.attempt.attempt.frame.leaseOwnerId,
      leaseExpiresAt: graph.attempt.attempt.frame.leaseExpiresAt,
    }),
    lastEvent: Object.freeze({
      sequence: lastEvent.event.frame.sequence,
      eventSha256: lastEvent.event.sha256,
    }),
    updatedAt: "2026-08-27T08:40:01.000Z",
  }));
}

function captureEmptyHead(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
): Promise<FrameworkMigrationCollisionHead> {
  return runEffect(captureFrameworkMigrationCollisionHead({
    admission: graph.admission.admission,
    headRevision: eventSequence("0"),
    attemptFence: eventSequence("0"),
    currentAttempt: null,
    lastEvent: null,
    updatedAt: canonicalInstant("2026-08-27T08:40:00.000Z"),
  }));
}

function captureRenewedHead(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
  lastEvent: RestoredFrameworkMigrationEvent,
): Promise<FrameworkMigrationCollisionHead> {
  const frame = lastEvent.event.frame;
  if (frame.kind !== "leaseRenewed") {
    throw new Error("Expected a lease-renewed event");
  }
  return runEffect(captureFrameworkMigrationCollisionHead({
    admission: graph.admission.admission,
    headRevision: "1",
    attemptFence: graph.attempt.attempt.frame.attemptFence,
    currentAttempt: Object.freeze({
      attemptId: graph.attempt.attempt.frame.attemptId,
      attemptFence: graph.attempt.attempt.frame.attemptFence,
      leaseOwnerId: frame.leaseOwnerId,
      leaseExpiresAt: frame.leaseExpiresAt,
    }),
    lastEvent: Object.freeze({
      sequence: lastEvent.event.frame.sequence,
      eventSha256: lastEvent.event.sha256,
    }),
    updatedAt: frame.recordedAt,
  }));
}

async function collisionHeadCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_migration_collision_head
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing collision-head count row");
  return row.count;
}

async function storedCollisionHeadRow(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkMigrationCollisionHeads,
  );
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    collisionStorageId: row.collisionStorageId,
    currentPlanStorageId: row.currentPlanStorageId,
    currentPlanSha256: Encoding.encodeHex(row.currentPlanSha256),
    currentAdmissionStorageId: row.currentAdmissionStorageId,
    currentAdmissionSha256: Encoding.encodeHex(row.currentAdmissionSha256),
    headRevision: row.headRevision,
    attemptFence: row.attemptFence,
    currentAttemptStorageId: row.currentAttemptStorageId,
    currentAttemptId: row.currentAttemptId,
    currentAttemptFence: row.currentAttemptFence,
    currentLeaseOwnerId: row.currentLeaseOwnerId,
    currentLeaseExpiresAt: row.currentLeaseExpiresAt?.toISOString() ?? null,
    lastEventStorageId: row.lastEventStorageId,
    lastEventSequence: row.lastEventSequence,
    lastEventSha256: row.lastEventSha256 === null
      ? null
      : Encoding.encodeHex(row.lastEventSha256),
    collisionHeadSha256: Encoding.encodeHex(row.collisionHeadSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  };
}

function expectedCollisionHeadRow(
  restored: RestoredFrameworkMigrationCollisionHead,
  currentAttemptStorageId: bigint | null,
  lastEventStorageId: bigint | null,
) {
  const { frame } = restored.head;
  if (
    (frame.currentAttempt === null) !== (currentAttemptStorageId === null) ||
    (frame.lastEvent === null) !== (lastEventStorageId === null)
  ) {
    throw new Error("Collision-head fixture projections are incoherent");
  }
  return {
    collisionStorageId: restored.collision.storageId,
    currentPlanStorageId: restored.plan.storageId,
    currentPlanSha256: restored.plan.plan.migrationPlanSha256,
    currentAdmissionStorageId: restored.admission.storageId,
    currentAdmissionSha256: restored.admission.admission.sha256,
    headRevision: BigInt(frame.headRevision),
    attemptFence: BigInt(frame.attemptFence),
    currentAttemptStorageId,
    currentAttemptId: frame.currentAttempt?.attemptId ?? null,
    currentAttemptFence: frame.currentAttempt === null
      ? null
      : BigInt(frame.currentAttempt.attemptFence),
    currentLeaseOwnerId: frame.currentAttempt?.leaseOwnerId ?? null,
    currentLeaseExpiresAt: frame.currentAttempt?.leaseExpiresAt ?? null,
    lastEventStorageId,
    lastEventSequence: frame.lastEvent === null
      ? null
      : BigInt(frame.lastEvent.sequence),
    lastEventSha256: frame.lastEvent?.eventSha256 ?? null,
    collisionHeadSha256: restored.head.sha256,
    frameFormat: FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
    frameVersion: FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
    canonicalByteLength: canonicalBytes(restored.head).byteLength,
    canonicalBytes: canonicalBytes(restored.head),
  };
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation:
    | "readCollisionHead"
    | "compareAndSwapCollisionHead",
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

function rejectingCollisionHeadRootSelectTransaction(
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
            throw new TypeError("Collision-head read builder must be an object");
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
        if (!isCollisionHeadRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Collision-head select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isCollisionHeadRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "collisionHeadSha256") &&
    Object.hasOwn(input, "headRevision") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
