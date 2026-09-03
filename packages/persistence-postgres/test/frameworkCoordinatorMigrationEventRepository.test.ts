import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import type { CanonicalIsoInstant } from "@flarex/time/iso-instant";
import { asc, eq } from "drizzle-orm";
import { Brand, Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from
  "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationEvent,
} from "../src/migrationCoordination/canonical";
import type {
  CanonicalNonNegativeInt64,
  FrameworkMigrationLeaseOwnerId,
} from
  "../src/migrationCoordination/identity";
import {
  appendFrameworkMigrationEventInTransactionEffect,
  readFrameworkMigrationEventInTransactionEffect,
  resolveAuthenticatedFrameworkMigrationEventOccupantsEffect,
  restoreStoredFrameworkMigrationEventReferenceInTransactionEffect,
} from "../src/migrationCoordination/migrationEventRepository";
import {
  FRAMEWORK_MIGRATION_EVENT_FORMAT,
  FRAMEWORK_MIGRATION_EVENT_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationEventFrame,
} from "../src/migrationCoordination/model";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import { fxSystemFrameworkMigrationEvents } from
  "../src/migrationCoordination/schema";
import {
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
} from "../src/migrationCoordination/storedRestoration";
import {
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationEvent,
  type RestoredFrameworkMigrationEventSubject,
} from "../src/migrationCoordination/storedEventRestoration";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulReadinessGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 180_000;
const eventSequence = Brand.nominal<CanonicalNonNegativeInt64>();
const canonicalInstant = Brand.nominal<CanonicalIsoInstant>();
const leaseOwnerId = Brand.nominal<FrameworkMigrationLeaseOwnerId>();

type FrameworkMigrationEvent = CapturedFrameworkMigrationValue<
  FrameworkMigrationEventFrame,
  RestoredFrameworkMigrationEvent["event"]["sha256"]
>;

type FrameworkMigrationEventCommon = Pick<
  FrameworkMigrationEventFrame,
  "format" | "version" | "collision" | "sequence" | "previousEvent" |
    "recordedAt"
>;

describe("framework coordinator migration-event repository", () => {
  it("keeps the event transaction kernel and authority source-private", async () => {
    expect(
      "appendFrameworkMigrationEventInTransactionEffect" in persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationEventInTransactionEffect" in persistenceRoot,
    ).toBe(false);
    expect("restoredFrameworkMigrationEventAuthority" in persistenceRoot)
      .toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationEventRepository.ts",
    );
  });

  it("appends, reads, and exactly replays all seven event kinds", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const stored = await persistence.drizzle.transaction(async transaction => {
      const graph = await storeSuccessfulReadinessGraphInTransaction(
        transaction,
        values,
      );
      const chain = await captureEventChain(graph);
      const restored: RestoredFrameworkMigrationEvent[] = [];
      let previous: RestoredFrameworkMigrationEvent | null = null;
      for (const entry of chain) {
        const missing = await runEffect(
          readFrameworkMigrationEventInTransactionEffect(
            transaction,
            graph.collision,
            previous,
            entry.subject,
            entry.event,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);
        const appended: RestoredFrameworkMigrationEvent = await runEffect(
          appendFrameworkMigrationEventInTransactionEffect(
            transaction,
            graph.collision,
            previous,
            entry.subject,
            entry.event,
          ),
        );
        const replayed: RestoredFrameworkMigrationEvent = await runEffect(
          appendFrameworkMigrationEventInTransactionEffect(
            transaction,
            graph.collision,
            previous,
            entry.subject,
            entry.event,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkMigrationEventInTransactionEffect(
            transaction,
            graph.collision,
            previous,
            entry.subject,
            entry.event,
          ),
        ));
        expect(replayed.storageId).toBe(appended.storageId);
        expect(read).toEqual(appended);
        restored.push(appended);
        previous = appended;
      }
      return { graph, chain, restored: Object.freeze(restored) };
    });

    const rows = await storedEventRows(persistence);
    expect(rows).toHaveLength(7);
    for (let index = 0; index < stored.chain.length; index += 1) {
      const entry = stored.chain[index];
      const restored = stored.restored[index];
      const row = rows[index];
      if (entry === undefined || restored === undefined || row === undefined) {
        throw new Error("Missing event chain entry");
      }
      expect(row.eventStorageId).toBe(restored.storageId);
      expect(row.collisionStorageId).toBe(stored.graph.collision.storageId);
      expect(row.eventSequence).toBe(BigInt(entry.event.frame.sequence));
      expect(row.eventSha256).toBe(entry.event.sha256);
      expect(row.eventKind).toBe(entry.event.frame.kind);
      expect(row.frameFormat).toBe(FRAMEWORK_MIGRATION_EVENT_FORMAT);
      expect(row.frameVersion).toBe(FRAMEWORK_MIGRATION_EVENT_VERSION);
      expect(row.canonicalByteLength).toBe(
        canonicalBytes(entry.event).byteLength,
      );
      expect(row.canonicalBytes).toEqual(canonicalBytes(entry.event));
      const prior = index === 0 ? undefined : stored.restored[index - 1];
      expect(row.previousEventStorageId).toBe(prior?.storageId ?? null);
      expect(row.previousEventSequence).toBe(
        prior === undefined ? null : BigInt(prior.event.frame.sequence),
      );
      expect(row.previousEventSha256).toBe(prior?.event.sha256 ?? null);
      if (entry.event.frame.kind === "leaseRenewed") {
        expect(row.subjectSha256).toBeNull();
        expect(row.leaseAttemptId).toBe(entry.event.frame.attemptId);
        expect(row.leaseAttemptFence).toBe(
          BigInt(entry.event.frame.attemptFence),
        );
        expect(row.leaseOwnerId).toBe(entry.event.frame.leaseOwnerId);
        expect(row.leaseExpiresAt).toBe(entry.event.frame.leaseExpiresAt);
      } else {
        expect(row.subjectSha256).toBe(eventSubjectSha256(entry.event.frame));
        expect(row.leaseAttemptId).toBeNull();
        expect(row.leaseAttemptFence).toBeNull();
        expect(row.leaseOwnerId).toBeNull();
        expect(row.leaseExpiresAt).toBeNull();
      }
    }

    const independentlyCaptured = await captureEventChain(stored.graph);
    await persistence.drizzle.transaction(async transaction => {
      let previous: RestoredFrameworkMigrationEvent | null = null;
      for (let index = 0; index < independentlyCaptured.length; index += 1) {
        const entry = independentlyCaptured[index];
        const expected = stored.restored[index];
        if (entry === undefined || expected === undefined) {
          throw new Error("Missing independently captured event");
        }
        const replayed: RestoredFrameworkMigrationEvent = await runEffect(
          appendFrameworkMigrationEventInTransactionEffect(
            transaction,
            stored.graph.collision,
            previous,
            entry.subject,
            entry.event,
          ),
        );
        expect(replayed.storageId).toBe(expected.storageId);
        previous = replayed;
      }
    });
    await expect(eventCount(persistence)).resolves.toBe("7");
  }, PGLITE_TEST_TIMEOUT);

  it("resolves sequence occupants before lazily consulting the digest", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedEventFixture(persistence, 1);
    const value = stored.restored[0];
    const entry = stored.chain[0];
    if (value === undefined || entry === undefined) {
      throw new Error("Missing stored event");
    }
    const authority = restoredFrameworkMigrationEventAuthority(value);
    if (authority === undefined) throw new Error("Missing event authority");
    const occupant = Object.freeze({ value, ...authority });
    let digestReads = 0;
    const exact = await runEffect(
      resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
        stored.graph.collision,
        null,
        entry.subject,
        entry.event,
        "readEvent",
        {
          readBySequence: () => Effect.succeed(Option.some(occupant)),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(Option.getOrThrow(exact).storageId).toBe(value.storageId);
    expect(digestReads).toBe(0);

    const conflicting = await capturePlanAdmittedEvent(
      stored.graph,
      eventSequence("5"),
      null,
      "2026-08-27T08:40:01.000Z",
    );
    const conflict = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
        stored.graph.collision,
        null,
        entry.subject,
        conflicting,
        "readEvent",
        {
          readBySequence: () => Effect.succeed(Option.some(occupant)),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(conflict).toMatchObject({
      operation: "readEvent",
      reason: "immutableConflict",
    });
    expect(digestReads).toBe(0);

    const byDigest = await runEffect(
      resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
        stored.graph.collision,
        null,
        entry.subject,
        entry.event,
        "readEvent",
        {
          readBySequence: () => Effect.succeed(Option.none()),
          readByDigest: () => {
            digestReads += 1;
            return Effect.succeed(Option.some(occupant));
          },
        },
      ),
    );
    expect(Option.getOrThrow(byDigest).storageId).toBe(value.storageId);
    expect(digestReads).toBe(1);

    const digestConflict = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
        stored.graph.collision,
        null,
        entry.subject,
        conflicting,
        "readEvent",
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
      operation: "readEvent",
      reason: "immutableConflict",
    });
    expect(digestReads).toBe(2);

    const absent = await runEffect(
      resolveAuthenticatedFrameworkMigrationEventOccupantsEffect(
        stored.graph.collision,
        null,
        entry.subject,
        entry.event,
        "readEvent",
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

  it("restores an incumbent through its actual predecessor", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const result = await persistence.drizzle.transaction(async transaction => {
      const graph = await storeSuccessfulReadinessGraphInTransaction(
        transaction,
        values,
      );
      const subject = planAdmittedSubject(graph);
      const firstValue = await capturePlanAdmittedEvent(
        graph,
        eventSequence("5"),
        null,
        "2026-08-27T08:40:00.000Z",
      );
      const first = await runEffect(
        appendFrameworkMigrationEventInTransactionEffect(
          transaction,
          graph.collision,
          null,
          subject,
          firstValue,
        ),
      );
      const alternateValue = await capturePlanAdmittedEvent(
        graph,
        eventSequence("6"),
        null,
        "2026-08-27T08:40:01.000Z",
      );
      const alternate = await runEffect(
        appendFrameworkMigrationEventInTransactionEffect(
          transaction,
          graph.collision,
          null,
          subject,
          alternateValue,
        ),
      );
      const storedValue = await capturePlanAdmittedEvent(
        graph,
        eventSequence("13"),
        firstValue,
        "2026-08-27T08:40:02.000Z",
      );
      await runEffect(appendFrameworkMigrationEventInTransactionEffect(
        transaction,
        graph.collision,
        first,
        subject,
        storedValue,
      ));
      const expectedValue = await capturePlanAdmittedEvent(
        graph,
        eventSequence("13"),
        alternateValue,
        "2026-08-27T08:40:03.000Z",
      );
      const failure = await runEffectFailure(
        readFrameworkMigrationEventInTransactionEffect(
          transaction,
          graph.collision,
          alternate,
          subject,
          expectedValue,
        ),
      );
      return failure;
    });
    expect(result).toMatchObject({
      operation: "readEvent",
      reason: "immutableConflict",
    });
    await expect(eventCount(persistence)).resolves.toBe("3");
  }, PGLITE_TEST_TIMEOUT);

  it("rejects cyclic, projected, changed, and oversized state without healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await storedEventFixture(projectionPersistence, 1);
    const projectionValue = projection.restored[0];
    const projectionEntry = projection.chain[0];
    if (projectionValue === undefined || projectionEntry === undefined) {
      throw new Error("Missing projected event");
    }
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkMigrationEvents,
    ).set({ subjectSha256: new Uint8Array(32).fill(0x7f) }).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      projectionValue.storageId,
    ));
    const projectionBefore = await storedEventRows(projectionPersistence);
    await expectStoredCorruption(
      projectionPersistence,
      "readEvent",
      transaction => readFrameworkMigrationEventInTransactionEffect(
        transaction,
        projection.graph.collision,
        null,
        projectionEntry.subject,
        projectionEntry.event,
      ),
    );
    await expect(storedEventRows(projectionPersistence)).resolves.toEqual(
      projectionBefore,
    );

    const changedPersistence = await createMigratedPGlitePersistence();
    const changed = await storedEventFixture(changedPersistence, 1);
    const changedValue = changed.restored[0];
    const changedEntry = changed.chain[0];
    if (changedValue === undefined || changedEntry === undefined) {
      throw new Error("Missing changed event");
    }
    const changedBytes = canonicalBytes(changedEntry.event);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await changedPersistence.drizzle.update(
      fxSystemFrameworkMigrationEvents,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      changedValue.storageId,
    ));
    await expectStoredCorruption(
      changedPersistence,
      "readEvent",
      transaction => readFrameworkMigrationEventInTransactionEffect(
        transaction,
        changed.graph.collision,
        null,
        changedEntry.subject,
        changedEntry.event,
      ),
    );

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await storedEventFixture(oversizedPersistence, 1);
    const oversizedValue = oversized.restored[0];
    const oversizedEntry = oversized.chain[0];
    if (oversizedValue === undefined || oversizedEntry === undefined) {
      throw new Error("Missing oversized event");
    }
    await oversizedPersistence.query(`
      alter table fx_system_framework_migration_event
        drop constraint fx_framework_migration_event_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkMigrationEvents,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      oversizedValue.storageId,
    ));
    const oversizedBefore = await storedEventRows(oversizedPersistence);
    await expectStoredCorruption(
      oversizedPersistence,
      "appendEvent",
      transaction => appendFrameworkMigrationEventInTransactionEffect(
        transaction,
        oversized.graph.collision,
        null,
        oversizedEntry.subject,
        oversizedEntry.event,
      ),
    );
    await expect(storedEventRows(oversizedPersistence)).resolves.toEqual(
      oversizedBefore,
    );

    const cyclePersistence = await createMigratedPGlitePersistence();
    const cycle = await storedEventFixture(cyclePersistence, 2);
    const cycleValue = cycle.restored[1];
    const cycleEntry = cycle.chain[1];
    const cyclePrevious = cycle.restored[0];
    if (
      cycleValue === undefined || cycleEntry === undefined ||
      cyclePrevious === undefined
    ) throw new Error("Missing cycle event");
    await cyclePersistence.query(`
      alter table fx_system_framework_migration_event
        drop constraint fx_framework_migration_event_previous_fk
    `);
    await cyclePersistence.drizzle.update(
      fxSystemFrameworkMigrationEvents,
    ).set({ previousEventStorageId: cycleValue.storageId }).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      cycleValue.storageId,
    ));
    await expectStoredCorruption(
      cyclePersistence,
      "readEvent",
      transaction => readFrameworkMigrationEventInTransactionEffect(
        transaction,
        cycle.graph.collision,
        cyclePrevious,
        cycleEntry.subject,
        cycleEntry.event,
      ),
    );

    const ancestorPersistence = await createMigratedPGlitePersistence();
    const ancestor = await storedEventFixture(ancestorPersistence, 2);
    const ancestorRoot = ancestor.restored[1];
    const ancestorPrevious = ancestor.restored[0];
    if (ancestorRoot === undefined || ancestorPrevious === undefined) {
      throw new Error("Missing ancestor event");
    }
    await ancestorPersistence.query(`
      alter table fx_system_framework_migration_event
        drop constraint fx_framework_migration_event_frame_check
    `);
    const oversizedAncestorBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await ancestorPersistence.drizzle.update(
      fxSystemFrameworkMigrationEvents,
    ).set({
      canonicalByteLength: oversizedAncestorBytes.byteLength,
      canonicalBytes: oversizedAncestorBytes,
    }).where(eq(
      fxSystemFrameworkMigrationEvents.eventStorageId,
      ancestorPrevious.storageId,
    ));
    await expectStoredCorruption(
      ancestorPersistence,
      "readEvent",
      transaction =>
        restoreStoredFrameworkMigrationEventReferenceInTransactionEffect(
          transaction,
          ancestor.graph.collision,
          ancestorRoot.storageId,
          ancestorRoot.event.frame.sequence,
          ancestorRoot.event.sha256,
          "readEvent",
        ),
    );
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
        const chain = await captureEventChain(graph);
        const first = chain[0];
        if (first === undefined) throw new Error("Missing rollback event");
        return { graph, first };
      },
    );
    const rollback = new Error("deliberate event rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(appendFrameworkMigrationEventInTransactionEffect(
        transaction,
        prepared.graph.collision,
        null,
        prepared.first.subject,
        prepared.first.event,
      ));
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(eventCount(persistence)).resolves.toBe("0");

    const cause = new Error("event driver unavailable");
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationEventInTransactionEffect(
          rejectingEventRootSelectTransaction(transaction, cause),
          prepared.graph.collision,
          null,
          prepared.first.subject,
          prepared.first.event,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readEvent",
      reason: "resourceFailure",
      cause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function storedEventFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  length: number,
) {
  const values = await createSuccessfulTerminalPlanValues();
  return persistence.drizzle.transaction(async transaction => {
    const graph = await storeSuccessfulReadinessGraphInTransaction(
      transaction,
      values,
    );
    const chain = (await captureEventChain(graph)).slice(0, length);
    const restored: RestoredFrameworkMigrationEvent[] = [];
    let previous: RestoredFrameworkMigrationEvent | null = null;
    for (const entry of chain) {
      const value: RestoredFrameworkMigrationEvent = await runEffect(
        appendFrameworkMigrationEventInTransactionEffect(
          transaction,
          graph.collision,
          previous,
          entry.subject,
          entry.event,
        ),
      );
      restored.push(value);
      previous = value;
    }
    return { graph, chain, restored: Object.freeze(restored) };
  });
}

async function captureEventChain(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
) {
  const receipts = restoredFrameworkMigrationAttemptTerminalStepReceipts(
    graph.terminal,
  );
  const receipt = receipts?.[0];
  if (receipt === undefined) {
    throw new Error("Missing authenticated terminal receipt prefix");
  }
  const subjects = Object.freeze([
    planAdmittedSubject(graph),
    Object.freeze({
      kind: "attemptStarted",
      attempt: graph.attempt,
    }),
    Object.freeze({
      kind: "leaseRenewed",
      attempt: graph.attempt,
    }),
    Object.freeze({ kind: "stepCompleted", receipt }),
    Object.freeze({
      kind: "attemptTerminated",
      terminal: graph.terminal,
    }),
    Object.freeze({
      kind: "installationPublished",
      installation: graph.installation,
    }),
    Object.freeze({ kind: "readinessPublished", readiness: graph.readiness }),
  ] satisfies readonly RestoredFrameworkMigrationEventSubject[]);
  const sequences = Object.freeze(["5", "8", "13", "21", "34", "55", "89"])
    .map(eventSequence);
  const times = Object.freeze([
    "2026-08-27T08:40:00.000Z",
    "2026-08-27T08:40:01.000Z",
    "2026-08-27T08:40:02.000Z",
    "2026-08-27T08:40:03.000Z",
    "2026-08-27T08:40:04.000Z",
    "2026-08-27T08:40:05.000Z",
    "2026-08-27T08:40:06.000Z",
  ]);
  const captured: FrameworkMigrationEvent[] = [];
  const common = (index: number): FrameworkMigrationEventCommon => ({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence: sequences[index] ?? eventSequence("0"),
    previousEvent: captured[index - 1] === undefined
      ? null
      : Object.freeze({
        sequence: captured[index - 1].frame.sequence,
        eventSha256: captured[index - 1].sha256,
      }),
    recordedAt: canonicalInstant(times[index] ?? "1970-01-01T00:00:00.000Z"),
  });
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(0),
    kind: "planAdmitted",
    admissionSha256: graph.admission.admission.sha256,
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(1),
    kind: "attemptStarted",
    attemptStartSha256: graph.attempt.attempt.sha256,
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(2),
    kind: "leaseRenewed",
    attemptId: graph.attempt.attempt.frame.attemptId,
    attemptFence: graph.attempt.attempt.frame.attemptFence,
    leaseOwnerId: leaseOwnerId("worker-b"),
    leaseExpiresAt: canonicalInstant("2026-08-27T08:42:00.000Z"),
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(3),
    kind: "stepCompleted",
    stepReceiptSha256: receipt.receipt.sha256,
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(4),
    kind: "attemptTerminated",
    terminalSha256: graph.terminal.terminal.sha256,
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(5),
    kind: "installationPublished",
    installationReceiptSha256: graph.installation.installation.sha256,
  })));
  captured.push(await runEffect(captureFrameworkMigrationEvent({
    ...common(6),
    kind: "readinessPublished",
    readinessSha256: graph.readiness.readiness.sha256,
  })));
  return Object.freeze(captured.map((event, index) => Object.freeze({
    event,
    subject: subjects[index] ?? subjects[0],
  })));
}

function planAdmittedSubject(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
): RestoredFrameworkMigrationEventSubject {
  return Object.freeze({
    kind: "planAdmitted",
    admission: graph.admission,
  });
}

function capturePlanAdmittedEvent(
  graph: Awaited<ReturnType<
    typeof storeSuccessfulReadinessGraphInTransaction
  >>,
  sequence: CanonicalNonNegativeInt64,
  previous: FrameworkMigrationEvent | null,
  recordedAt: string,
) {
  return runEffect(captureFrameworkMigrationEvent({
    format: FRAMEWORK_MIGRATION_EVENT_FORMAT,
    version: FRAMEWORK_MIGRATION_EVENT_VERSION,
    collision: graph.collision.coordinate,
    sequence,
    previousEvent: previous === null
      ? null
      : Object.freeze({
        sequence: previous.frame.sequence,
        eventSha256: previous.sha256,
      }),
    recordedAt: canonicalInstant(recordedAt),
    kind: "planAdmitted",
    admissionSha256: graph.admission.admission.sha256,
  }));
}

async function eventCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_migration_event
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing event count row");
  return row.count;
}

async function storedEventRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkMigrationEvents,
  ).orderBy(asc(fxSystemFrameworkMigrationEvents.eventSequence));
  return rows.map(row => ({
    eventStorageId: row.eventStorageId,
    collisionStorageId: row.collisionStorageId,
    eventSequence: row.eventSequence,
    eventSha256: Encoding.encodeHex(row.eventSha256),
    previousEventStorageId: row.previousEventStorageId,
    previousEventSequence: row.previousEventSequence,
    previousEventSha256: row.previousEventSha256 === null
      ? null
      : Encoding.encodeHex(row.previousEventSha256),
    eventKind: row.eventKind,
    subjectSha256: row.subjectSha256 === null
      ? null
      : Encoding.encodeHex(row.subjectSha256),
    leaseAttemptId: row.leaseAttemptId,
    leaseAttemptFence: row.leaseAttemptFence,
    leaseOwnerId: row.leaseOwnerId,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function eventSubjectSha256(
  frame: Exclude<
    FrameworkMigrationEventFrame,
    { readonly kind: "leaseRenewed" }
  >,
): string {
  switch (frame.kind) {
    case "planAdmitted":
      return frame.admissionSha256;
    case "attemptStarted":
      return frame.attemptStartSha256;
    case "stepCompleted":
      return frame.stepReceiptSha256;
    case "attemptTerminated":
      return frame.terminalSha256;
    case "installationPublished":
      return frame.installationReceiptSha256;
    case "readinessPublished":
      return frame.readinessSha256;
  }
}

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "appendEvent" | "readEvent",
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

function rejectingEventRootSelectTransaction(
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
            throw new TypeError("Event read builder must remain an object");
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
        if (!isEventRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Event select must return an object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isEventRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "eventStorageId") &&
    Object.hasOwn(input, "eventSequence") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}
