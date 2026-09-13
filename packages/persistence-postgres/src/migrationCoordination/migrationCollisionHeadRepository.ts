import { isRestoredFrameworkSchemaInstallation, isRestoredFrameworkSchemaReadiness } from "../frameworkSchema/installation/storedMetadataRestoration";
import { withFrameworkGraphReadPass } from "./graphReadPass";
import { readFrameworkMigrationStepReceiptPrefixInTransactionEffect, type FrameworkMigrationCommittedCompletion } from "./migrationStepReceiptRepository";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Brand, Effect, Encoding, Option, Schema } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
  storedDateMatchesCanonicalInstant,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationCollisionHead,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationCollisionHeadSha256, FrameworkMigrationStepReceiptSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect,
  operationalFrameworkMigrationLeaseExpiryDate,
  restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect,
  type FrameworkMigrationEventAttemptSubjects,
} from "./migrationAttemptRepository";
import {
  corroborateRestoredFrameworkMigrationEventInTransactionEffect,
  restoreStoredFrameworkMigrationEventGraphReferenceInTransactionEffect,
  type FrameworkMigrationEventRecord,
} from "./migrationEventRepository";
import {
  corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect,
  restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect,
} from "./migrationPlanAdmissionRepository";
import {
  FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
  FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationCollisionCoordinate,
  type FrameworkMigrationCollisionHeadFrame,
  type RelationalMigrationPlan,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import { fxSystemFrameworkMigrationCollisionHeads } from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationAttemptTerminal,
  restoredFrameworkMigrationAttemptTerminalStepReceipts,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFreshRelationalMigrationPlan,
} from "./storedRestoration";
import {
  isRestoredFrameworkMigrationCollisionHead,
  deriveFrameworkMigrationHeadProgress,
  type FrameworkMigrationHeadProgress,
  isRestoredFrameworkMigrationEvent,
  restoreStoredFrameworkMigrationCollisionHead,
  restoredFrameworkMigrationCollisionHeadAuthority,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationCollisionHead,
  type RestoredFrameworkMigrationEvent,
  type RestoredFrameworkMigrationEventSubject,
  type StoredFrameworkMigrationCollisionHeadRow,
} from "./storedEventRestoration";
import { isStoredFrameworkMigrationCollisionHeadFrame } from
  "./storedValidation";
import {
  readFrameworkMigrationCollisionDomainForOperationInTransactionEffect,
  readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect,
} from "./targetCollisionRepository";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";

type FrameworkMigrationCollisionHead = CapturedFrameworkMigrationValue<
  FrameworkMigrationCollisionHeadFrame,
  FrameworkMigrationCollisionHeadSha256
>;

type CollisionHeadRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  | "initializeCollisionHead"
  | "readCollisionHead"
  | "compareAndSwapCollisionHead"
>;

interface PreparedFrameworkMigrationCollisionHead {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  readonly lastEvent: RestoredFrameworkMigrationEvent | null;
  readonly head: FrameworkMigrationCollisionHead;
  readonly currentPlanSha256Bytes: Uint8Array;
  readonly currentAdmissionSha256Bytes: Uint8Array;
  readonly headRevision: bigint;
  readonly attemptFence: bigint;
  readonly currentLeaseExpiresAt: Date | null;
  readonly lastEventSha256Bytes: Uint8Array | null;
  readonly collisionHeadSha256Bytes: Uint8Array;
  readonly canonicalBytes: Uint8Array;
}

interface CorroboratedFrameworkMigrationCollisionHeadDependencies {
  readonly progress: FrameworkMigrationHeadProgress;
  readonly lastStepReceiptSha256Bytes: Uint8Array | null;
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  readonly lastEvent: RestoredFrameworkMigrationEvent | null;
}

interface FrameworkMigrationCollisionHeadDriverRow
  extends StoredFrameworkMigrationCollisionHeadRow {
  readonly completedStepCount: number;
  readonly lastReceiptStorageId: bigint | null;
  readonly lastStepReceiptSha256: Uint8Array | null;
  readonly collisionStorageId: bigint;
  readonly currentPlanStorageId: bigint;
  readonly currentPlanSha256: Uint8Array;
  readonly currentAdmissionStorageId: bigint;
  readonly currentAdmissionSha256: Uint8Array;
  readonly headRevision: bigint;
  readonly attemptFence: bigint;
  readonly currentAttemptStorageId: bigint | null;
  readonly currentAttemptId: string | null;
  readonly currentAttemptFence: bigint | null;
  readonly currentLeaseOwnerId: string | null;
  readonly currentLeaseExpiresAt: Date | null;
  readonly lastEventStorageId: bigint | null;
  readonly lastEventSequence: bigint | null;
  readonly lastEventSha256: Uint8Array | null;
  readonly collisionHeadSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkMigrationCollisionHeadRoot {
  readonly collisionStorageId: bigint;
  readonly currentPlanStorageId: bigint;
  readonly currentAdmissionStorageId: bigint;
  readonly currentAttemptStorageId: bigint | null;
  readonly lastEventStorageId: bigint | null;
  readonly frame: FrameworkMigrationCollisionHeadFrame;
  readonly head: FrameworkMigrationCollisionHead;
}

const UTF8 = new TextEncoder();

const isProgressPosition = Schema.is(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })));
const recordHeadSha256 = Brand.nominal<FrameworkMigrationCollisionHeadSha256>();
const recordReceiptSha256 = Brand.nominal<FrameworkMigrationStepReceiptSha256>();

/** One decoded operational row. This is not a restored head or full-history
 * capability. The protected command must check its claim, tail and event before
 * executing or advancing progress. */
export interface FrameworkMigrationProgressRecord {
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly head: FrameworkMigrationCollisionHead;
  readonly currentPlanStorageId: bigint;
  readonly currentAdmissionStorageId: bigint;
  readonly currentAttemptStorageId: bigint | null;
  readonly lastEventStorageId: bigint | null;
  readonly completedStepCount: number;
  readonly lastReceipt: Readonly<{ storageId: bigint; sha256: FrameworkMigrationStepReceiptSha256 }> | null;
}

export const readFrameworkMigrationProgressRecordForUpdateInTransactionEffect = Effect.fn("FrameworkMigrationCollisionHeadRepository.readProgressForUpdate")(
  function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain): Effect.fn.Return<
    Option.Option<FrameworkMigrationProgressRecord>, FrameworkMigrationRepositoryError
  > {
    const operation = "readCollisionHead" as const;
    const storedCollision = yield* corroborateCollision(transaction, collision, operation);
    const row = yield* loadCollisionHeadRoot(transaction, storedCollision.storageId, operation, true);
    return Option.isNone(row) ? Option.none() : Option.some(yield* decodeProgressRecord(row.value, storedCollision, operation));
  },
);

const decodeProgressRecord = Effect.fn("FrameworkMigrationCollisionHeadRepository.decodeProgressRecord")(
  function* (row: FrameworkMigrationCollisionHeadDriverRow, collision: RestoredFrameworkMigrationCollisionDomain,
    operation: FrameworkMigrationRepositoryOperation): Effect.fn.Return<FrameworkMigrationProgressRecord, FrameworkMigrationRepositoryError> {
    const decoded = yield* decodeCollisionHeadRoot(row, operation);
    if (decoded.collisionStorageId !== collision.storageId || !sameCollisionCoordinate(decoded.frame.collision, collision.coordinate) ||
      !isProgressPosition(row.completedStepCount) ||
      (decoded.frame.currentAttempt !== null && !storedDateMatchesCanonicalInstant(row.currentLeaseExpiresAt, decoded.frame.currentAttempt.leaseExpiresAt))) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    let lastReceipt: FrameworkMigrationProgressRecord["lastReceipt"] = null;
    if (row.completedStepCount === 0) {
      if (row.lastReceiptStorageId !== null || row.lastStepReceiptSha256 !== null) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
    } else {
      const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(row.lastReceiptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation)));
      lastReceipt = Object.freeze({ storageId, sha256: recordReceiptSha256(yield* decodeStoredSha256(row.lastStepReceiptSha256, operation)) });
    }
    return Object.freeze({ collision, head: decoded.head, currentPlanStorageId: decoded.currentPlanStorageId,
      currentAdmissionStorageId: decoded.currentAdmissionStorageId, currentAttemptStorageId: decoded.currentAttemptStorageId,
      lastEventStorageId: decoded.lastEventStorageId, completedStepCount: row.completedStepCount, lastReceipt });
  },
);

/** One coordinator-owned renewal or completion. The caller retains the head
 * lock; full repository transitions continue to own admission and settlement. */
export const advanceFrameworkMigrationProgressRecordInTransactionEffect = Effect.fn("FrameworkMigrationCollisionHeadRepository.advanceProgress")(
  function* (transaction: FlarexMetadataTransaction, expected: FrameworkMigrationProgressRecord,
    attempt: RestoredFrameworkMigrationAttemptStart, event: FrameworkMigrationEventRecord,
    completion: FrameworkMigrationCommittedCompletion | null): Effect.fn.Return<FrameworkMigrationProgressRecord, FrameworkMigrationRepositoryError> {
    const operation = "compareAndSwapCollisionHead" as const;
    const frame = expected.head.frame;
    const current = frame.currentAttempt;
    const nextEvent = event.event.frame;
    if (!isRestoredFrameworkMigrationAttemptStart(attempt) || current === null ||
      expected.currentPlanStorageId !== attempt.plan.storageId || expected.currentAdmissionStorageId !== attempt.admission.storageId ||
      expected.currentAttemptStorageId !== attempt.storageId || expected.collision.storageId !== attempt.collision.storageId ||
      frame.currentPlan.planSha256 !== attempt.plan.plan.migrationPlanSha256 || frame.currentPlan.admissionSha256 !== attempt.admission.admission.sha256 ||
      current.attemptId !== attempt.attempt.frame.attemptId || current.attemptFence !== attempt.attempt.frame.attemptFence ||
      event.collisionStorageId !== expected.collision.storageId || event.previousEventStorageId !== expected.lastEventStorageId ||
      (frame.lastEvent === null ? nextEvent.previousEvent !== null : nextEvent.previousEvent?.eventSha256 !== frame.lastEvent.eventSha256 ||
        nextEvent.previousEvent.sequence !== frame.lastEvent.sequence) ||
      BigInt(nextEvent.sequence) !== BigInt(frame.lastEvent?.sequence ?? "0") + 1n) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    let currentAttempt = current;
    let completedStepCount = expected.completedStepCount;
    let lastReceipt = expected.lastReceipt;
    if (nextEvent.kind === "leaseRenewed") {
      if (completion !== null || nextEvent.attemptId !== current.attemptId || nextEvent.attemptFence !== current.attemptFence ||
        nextEvent.leaseOwnerId !== current.leaseOwnerId) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
      currentAttempt = Object.freeze({ ...current, leaseExpiresAt: nextEvent.leaseExpiresAt });
    } else if (nextEvent.kind === "stepCompleted") {
      if (completion === null || completion.producer !== attempt || completion.step !== attempt.plan.plan.frame.steps[completedStepCount] ||
        nextEvent.stepReceiptSha256 !== completion.sha256) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
      completedStepCount++;
      lastReceipt = Object.freeze({ storageId: completion.storageId, sha256: completion.sha256 });
    } else return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    return yield* persistProgressTransition(transaction, expected, attempt.admission, event, attempt.storageId, currentAttempt, completedStepCount, lastReceipt);
  },
);


type PublicationSubject = Extract<RestoredFrameworkMigrationEventSubject, { kind: "attemptTerminated" | "installationPublished" | "readinessPublished" }>;

/** Only the protected finalizer advances these three publication events. The
 * received subject is issued by its existing owner from actual stored rows. */
export const advanceFrameworkMigrationPublicationProgressInTransactionEffect = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.advancePublication",
)(function* (transaction: FlarexMetadataTransaction, expected: FrameworkMigrationProgressRecord,
  previous: FrameworkMigrationEventRecord, event: FrameworkMigrationEventRecord, subject: PublicationSubject,
): Effect.fn.Return<FrameworkMigrationProgressRecord, FrameworkMigrationRepositoryError> {
  const operation = "compareAndSwapCollisionHead" as const;
  const frame = expected.head.frame;
  const next = event.event.frame;
  const terminal = subject.kind === "attemptTerminated" ? subject.terminal : subject.kind === "installationPublished" ? subject.installation.terminal : subject.readiness.installation.terminal;
  if (!isRestoredFrameworkMigrationAttemptTerminal(terminal) ||
    (subject.kind === "installationPublished" && !isRestoredFrameworkSchemaInstallation(subject.installation)) ||
    (subject.kind === "readinessPublished" && !isRestoredFrameworkSchemaReadiness(subject.readiness))) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
  }
  const attempt = terminal.attempt;
  const receipts = restoredFrameworkMigrationAttemptTerminalStepReceipts(terminal);
  if (terminal.terminal.frame.outcome.kind !== "succeeded" || receipts === undefined ||
    expected.completedStepCount !== receipts.length || receipts.length !== attempt.plan.plan.frame.steps.length ||
    expected.lastReceipt?.storageId !== receipts.at(-1)?.storageId || expected.lastReceipt?.sha256 !== receipts.at(-1)?.receipt.sha256 ||
    expected.currentPlanStorageId !== attempt.plan.storageId || expected.currentAdmissionStorageId !== attempt.admission.storageId ||
    expected.collision.storageId !== attempt.collision.storageId || frame.attemptFence !== attempt.attempt.frame.attemptFence ||
    frame.currentPlan.planSha256 !== attempt.plan.plan.migrationPlanSha256 || frame.currentPlan.admissionSha256 !== attempt.admission.admission.sha256 ||
    previous.storageId !== expected.lastEventStorageId || previous.collisionStorageId !== expected.collision.storageId ||
    previous.event.sha256 !== frame.lastEvent?.eventSha256 || previous.event.frame.sequence !== frame.lastEvent.sequence ||
    event.collisionStorageId !== expected.collision.storageId || event.previousEventStorageId !== previous.storageId ||
    next.previousEvent?.eventSha256 !== previous.event.sha256 || next.previousEvent.sequence !== previous.event.frame.sequence ||
    BigInt(next.sequence) !== BigInt(previous.event.frame.sequence) + 1n || next.kind !== subject.kind) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
  }
  const matches = subject.kind === "attemptTerminated"
    ? next.kind === "attemptTerminated" && next.terminalSha256 === terminal.terminal.sha256 &&
      expected.currentAttemptStorageId === attempt.storageId && frame.currentAttempt?.attemptId === attempt.attempt.frame.attemptId &&
      frame.currentAttempt.attemptFence === attempt.attempt.frame.attemptFence
    : expected.currentAttemptStorageId === null && frame.currentAttempt === null && (subject.kind === "installationPublished"
      ? next.kind === "installationPublished" && next.installationReceiptSha256 === subject.installation.installation.sha256 &&
        previous.event.frame.kind === "attemptTerminated" && previous.event.frame.terminalSha256 === terminal.terminal.sha256
      : next.kind === "readinessPublished" && next.readinessSha256 === subject.readiness.readiness.sha256 &&
        previous.event.frame.kind === "installationPublished" && previous.event.frame.installationReceiptSha256 === subject.readiness.installation.installation.sha256);
  if (!matches) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
  return yield* persistProgressTransition(transaction, expected, attempt.admission, event, null, null, expected.completedStepCount, expected.lastReceipt);
});

const persistProgressTransition = Effect.fn("FrameworkMigrationCollisionHeadRepository.persistProgressTransition")(
  function* (transaction: FlarexMetadataTransaction, expected: FrameworkMigrationProgressRecord, admission: RestoredFrameworkMigrationPlanAdmission,
    event: FrameworkMigrationEventRecord, currentAttemptStorageId: bigint | null, currentAttempt: FrameworkMigrationCollisionHeadFrame["currentAttempt"],
    completedStepCount: number, lastReceipt: FrameworkMigrationProgressRecord["lastReceipt"],
  ): Effect.fn.Return<FrameworkMigrationProgressRecord, FrameworkMigrationRepositoryError> {
    const operation = "compareAndSwapCollisionHead" as const;
    const frame = expected.head.frame;
    const nextEvent = event.event.frame;
    const head = yield* captureFrameworkMigrationCollisionHead({ admission: admission.admission,
      headRevision: String(BigInt(frame.headRevision) + 1n), attemptFence: frame.attemptFence, currentAttempt,
      lastEvent: { sequence: nextEvent.sequence, eventSha256: event.event.sha256 }, updatedAt: nextEvent.recordedAt,
    }).pipe(Effect.mapError(error => mapInputValueError(operation, error)));
    const values = yield* encodeCollisionHeadWriteValues(head, {
      currentPlanStorageId: expected.currentPlanStorageId, currentAdmissionStorageId: expected.currentAdmissionStorageId,
      currentAttemptStorageId: currentAttemptStorageId, lastEventStorageId: event.storageId, completedStepCount,
      lastReceiptStorageId: lastReceipt?.storageId ?? null,
      lastStepReceiptSha256: lastReceipt === null ? null : yield* decodeAuthenticatedSha256(lastReceipt.sha256),
    }, operation);
    yield* updateCollisionHeadRoot(transaction, expected, values, operation);
    const selected = yield* loadCollisionHeadRoot(transaction, expected.collision.storageId, operation);
    if (Option.isNone(selected)) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    const actual = yield* decodeProgressRecord(selected.value, expected.collision, operation);
    if (actual.head.sha256 !== head.sha256 || actual.head.canonicalJson !== head.canonicalJson || actual.completedStepCount !== completedStepCount ||
      actual.currentPlanStorageId !== expected.currentPlanStorageId || actual.currentAdmissionStorageId !== expected.currentAdmissionStorageId ||
      actual.currentAttemptStorageId !== currentAttemptStorageId || actual.lastEventStorageId !== event.storageId ||
      actual.lastReceipt?.storageId !== lastReceipt?.storageId || actual.lastReceipt?.sha256 !== lastReceipt?.sha256) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    return actual;
  },
);

/** Observed projections only: no restored authority, history authentication or
 * catalog/readiness claim. The full verifier owns corroborating these counts. */
export interface FrameworkMigrationProgressSnapshot {
  readonly kind: "observed";
  readonly planSha256: string;
  readonly headRevision: string;
  readonly completedStepCount: number;
  readonly requiredStepCount: number;
  readonly currentAttempt: FrameworkMigrationCollisionHeadFrame["currentAttempt"];
}

export const inspectFrameworkMigrationProgressInTransactionEffect = Effect.fn("FrameworkMigrationCollisionHeadRepository.inspect")(
  function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain,
    plan: RelationalMigrationPlan): Effect.fn.Return<Option.Option<FrameworkMigrationProgressSnapshot>, FrameworkMigrationRepositoryError> {
    const operation = "readCollisionHead" as const;
    const storedCollision = yield* corroborateCollision(transaction, collision, operation);
    const selected = yield* loadCollisionHeadRoot(transaction, storedCollision.storageId, operation);
    if (Option.isNone(selected)) return Option.none();
    const row = selected.value;
    const decoded = yield* decodeCollisionHeadRoot(row, operation);
    if (decoded.collisionStorageId !== storedCollision.storageId ||
      !sameCollisionCoordinate(decoded.frame.collision, storedCollision.coordinate)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    if (decoded.frame.currentPlan.planSha256 !== plan.migrationPlanSha256) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    if (!isProgressPosition(row.completedStepCount) || row.completedStepCount > plan.frame.steps.length ||
      (decoded.frame.currentAttempt !== null && !storedDateMatchesCanonicalInstant(row.currentLeaseExpiresAt, decoded.frame.currentAttempt.leaseExpiresAt))) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    if (row.completedStepCount === 0) {
      if (row.lastReceiptStorageId !== null || row.lastStepReceiptSha256 !== null) {
        return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
      }
    } else {
      yield* Effect.fromResult(decodeStoredStorageIdResult(row.lastReceiptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation)));
      yield* decodeStoredSha256(row.lastStepReceiptSha256, operation);
    }
    return Option.some(Object.freeze({ kind: "observed", planSha256: plan.migrationPlanSha256,
      headRevision: decoded.frame.headRevision, completedStepCount: row.completedStepCount,
      requiredStepCount: plan.frame.steps.length,
      currentAttempt: decoded.frame.currentAttempt === null ? null : Object.freeze({ ...decoded.frame.currentAttempt }),
    }));
  },
);

export const initializeFrameworkMigrationCollisionHeadInTransactionEffect =
  Effect.fn("FrameworkMigrationCollisionHeadRepository.initialize")(
    function* (
      transaction: FlarexMetadataTransaction,
      collision: RestoredFrameworkMigrationCollisionDomain,
      admission: RestoredFrameworkMigrationPlanAdmission,
      currentAttempt: RestoredFrameworkMigrationAttemptStart | null,
      lastEvent: RestoredFrameworkMigrationEvent | null,
      head: FrameworkMigrationCollisionHead,
    ): Effect.fn.Return<
      RestoredFrameworkMigrationCollisionHead,
      FrameworkMigrationRepositoryError
    > {
      const operation = "initializeCollisionHead" as const;
      const prepared = yield* prepareExpectedCollisionHead(
        collision,
        admission,
        currentAttempt,
        lastEvent,
        head,
        operation,
      );
      const dependencies = yield* corroborateCollisionHeadDependencies(
        transaction,
        prepared,
        operation,
      );
      const insertedRows = yield* runRepositoryStatement(
        operation,
        transaction.insert(fxSystemFrameworkMigrationCollisionHeads).values({
          collisionStorageId: dependencies.collision.storageId,
          ...(yield* collisionHeadWriteValues(prepared, dependencies, operation)),
        }).onConflictDoNothing().returning({
          collisionStorageId:
            fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
        }),
      ).pipe(Effect.map(detachDriverRows));
      if (insertedRows.length > 1) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const inserted = insertedRows[0];
      if (inserted !== undefined) {
        yield* Effect.fromResult(decodeStoredStorageIdResult(
          inserted.collisionStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ));
      }
      const restored = yield* loadRestoredCollisionHead(
        transaction,
        dependencies.collision,
        operation,
      );
      if (Option.isNone(restored)) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      if (!collisionHeadExactlyMatches(
        restored.value,
        dependencies,
        prepared.head,
      )) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }
      return restored.value;
    },
  );

export const readFrameworkMigrationCollisionHeadInTransactionEffect = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationCollisionHead>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readCollisionHead" as const;
  const storedCollision = yield* corroborateCollision(
    transaction,
    collision,
    operation,
  );
  return yield* loadRestoredCollisionHead(
    transaction,
    storedCollision,
    operation,
  );
});

/**
 * Source-private coordinator read that serializes one collision lane before
 * inspecting its fence, lease, or progress.
 */
export const readFrameworkMigrationCollisionHeadForUpdateInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationCollisionHeadRepository.readForUpdate",
  )(function* (
    transaction: FlarexMetadataTransaction,
    collision: RestoredFrameworkMigrationCollisionDomain,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationCollisionHead>,
    FrameworkMigrationRepositoryError
  > {
    const operation = "readCollisionHead" as const;
    const storedCollision = yield* corroborateCollision(
      transaction,
      collision,
      operation,
    );
    const row = yield* loadCollisionHeadRoot(
      transaction,
      storedCollision.storageId,
      operation,
      true,
    );
    if (Option.isNone(row)) return Option.none();
    return Option.some(yield* restoreCollisionHeadOccupant(
      transaction,
      row.value,
      storedCollision,
      operation,
    ));
  });

/** Claim-specific read: the head lock/read is fresh; its immutable event graph
 * and complete receipt inventory are restored together before returning. */
export const readFrameworkMigrationClaimGraphForUpdateInTransactionEffect = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.readClaimGraphForUpdate",
)(function* (transaction: FlarexMetadataTransaction, collision: RestoredFrameworkMigrationCollisionDomain) {
  const operation = "readCollisionHead" as const;
  const storedCollision = yield* corroborateCollision(transaction, collision, operation);
  const row = yield* loadCollisionHeadRoot(transaction, storedCollision.storageId, operation, true);
  if (Option.isNone(row)) return Option.none();
  return Option.some(yield* restoreClaimGraph(transaction, row.value, storedCollision));
});

const restoreClaimGraph = Effect.fn("FrameworkMigrationCollisionHeadRepository.restoreClaimGraph")(
  function* (transaction: FlarexMetadataTransaction, row: FrameworkMigrationCollisionHeadDriverRow,
    collision: RestoredFrameworkMigrationCollisionDomain) {
    const head = yield* restoreCollisionHeadOccupant(transaction, row, collision, "readCollisionHead");
    const attempt = restoredFrameworkMigrationCollisionHeadAuthority(head)?.currentAttempt;
    const receipts = attempt === null || attempt === undefined ? undefined :
      yield* readFrameworkMigrationStepReceiptPrefixInTransactionEffect(transaction, attempt);
    return Object.freeze({ head, receipts });
  }, withFrameworkGraphReadPass,
);

export const compareAndSwapFrameworkMigrationCollisionHeadInTransactionEffect =
  Effect.fn("FrameworkMigrationCollisionHeadRepository.compareAndSwap")(
    function* (
      transaction: FlarexMetadataTransaction,
      expected: RestoredFrameworkMigrationCollisionHead,
      nextAdmission: RestoredFrameworkMigrationPlanAdmission,
      nextCurrentAttempt: RestoredFrameworkMigrationAttemptStart | null,
      nextLastEvent: RestoredFrameworkMigrationEvent | null,
      nextHead: FrameworkMigrationCollisionHead,
    ): Effect.fn.Return<
      RestoredFrameworkMigrationCollisionHead,
      FrameworkMigrationRepositoryError
    > {
      const operation = "compareAndSwapCollisionHead" as const;
      const expectedAuthority = isRestoredFrameworkMigrationCollisionHead(
          expected,
        )
        ? restoredFrameworkMigrationCollisionHeadAuthority(expected)
        : undefined;
      if (expectedAuthority === undefined) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const preparedExpected = yield* prepareExpectedCollisionHead(
        expected.collision,
        expected.admission,
        expectedAuthority.currentAttempt,
        expectedAuthority.lastEvent,
        expected.head,
        operation,
      );
      // Read the mutable root freshly, outside graph reuse. Authenticate its
      // immutable prerequisites and both sides of the proposed swap together;
      // that read-only pass settles before the guarded UPDATE below.
      const currentRow = yield* loadCollisionHeadRoot(transaction, expected.collision.storageId, operation);
      const { current, prepared, dependencies } = yield* prepareStoredHeadSwap(
        transaction, currentRow, preparedExpected, nextAdmission, nextCurrentAttempt, nextLastEvent, nextHead, operation,
      );
      yield* updateCollisionHeadRoot(transaction, {
        collision: current.collision, head: expected.head, completedStepCount: expected.progress.completedStepCount,
        lastReceipt: expected.progress.lastReceipt === null ? null : {
          storageId: expected.progress.lastReceipt.storageId, sha256: expected.progress.lastReceipt.receipt.sha256,
        },
      }, yield* collisionHeadWriteValues(prepared, dependencies, operation), operation);
      const restored = yield* loadRestoredCollisionHead(
        transaction,
        dependencies.collision,
        operation,
      );
      if (
        Option.isNone(restored) ||
        !collisionHeadExactlyMatches(
          restored.value,
          dependencies,
          prepared.head,
        )
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      return restored.value;
    },
  );

const prepareStoredHeadSwap = Effect.fn("FrameworkMigrationCollisionHeadRepository.prepareStoredSwap")(
  function* (
    transaction: FlarexMetadataTransaction,
    currentRow: Option.Option<FrameworkMigrationCollisionHeadDriverRow>,
    expected: PreparedFrameworkMigrationCollisionHead,
    nextAdmission: RestoredFrameworkMigrationPlanAdmission,
    nextAttempt: RestoredFrameworkMigrationAttemptStart | null,
    nextEvent: RestoredFrameworkMigrationEvent | null,
    nextHead: FrameworkMigrationCollisionHead,
    operation: CollisionHeadRepositoryOperation,
  ) {
    const expectedDependencies = yield* corroborateCollisionHeadDependencies(transaction, expected, operation);
    if (Option.isNone(currentRow)) return yield* Effect.fail(FrameworkMigrationRepositoryError.staleHead(operation));
    const current = yield* restoreCollisionHeadOccupant(transaction, currentRow.value, expectedDependencies.collision, operation);
    if (!collisionHeadExactlyMatches(current, expectedDependencies, expected.head)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.staleHead(operation));
    }
    const prepared = yield* prepareExpectedCollisionHead(current.collision, nextAdmission, nextAttempt, nextEvent, nextHead, operation);
    const dependencies = yield* corroborateCollisionHeadDependencies(transaction, prepared, operation);
    if (dependencies.collision.storageId !== current.collision.storageId) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    const samePlan = dependencies.plan.storageId === current.plan.storageId;
    const increment = dependencies.progress.completedStepCount - current.progress.completedStepCount;
    const nextSubject = dependencies.lastEvent === null ? undefined :
      restoredFrameworkMigrationEventAuthority(dependencies.lastEvent)?.subject;
    if (samePlan ? (increment !== 0 && increment !== 1) ||
      (increment === 0 && dependencies.progress.lastReceipt?.storageId !== current.progress.lastReceipt?.storageId) ||
      (increment === 1 && (nextSubject?.kind !== "stepCompleted" ||
        nextSubject.receipt.storageId !== dependencies.progress.lastReceipt?.storageId ||
        dependencies.progress.lastReceipt?.attempt.storageId !== dependencies.currentAttempt?.storageId)) :
      dependencies.progress.completedStepCount !== 0 || nextSubject?.kind !== "planAdmitted" ||
        nextSubject.admission.storageId !== dependencies.admission.storageId) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    }
    return { current, prepared, dependencies };
  }, withFrameworkGraphReadPass,
);

const prepareExpectedCollisionHead = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.prepareExpected",
)(function* (
  collision: RestoredFrameworkMigrationCollisionDomain,
  admission: RestoredFrameworkMigrationPlanAdmission,
  currentAttempt: RestoredFrameworkMigrationAttemptStart | null,
  lastEvent: RestoredFrameworkMigrationEvent | null,
  head: FrameworkMigrationCollisionHead,
  operation: CollisionHeadRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkMigrationCollisionHead,
  FrameworkMigrationRepositoryError
> {
  if (
    !isRestoredFrameworkMigrationCollisionDomain(collision) ||
    !isRestoredFrameworkMigrationPlanAdmission(admission) ||
    admission.collision.storageId !== collision.storageId ||
    !sameCollisionCoordinate(head.frame.collision, collision.coordinate) ||
    head.frame.currentPlan.planSha256 !==
      admission.plan.plan.migrationPlanSha256 ||
    head.frame.currentPlan.admissionSha256 !== admission.admission.sha256 ||
    !currentAttemptMatchesHead(
      currentAttempt,
      collision,
      admission,
      head.frame,
    ) ||
    !lastEventMatchesHead(lastEvent, collision, head.frame)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const recaptured = yield* captureFrameworkMigrationCollisionHead({
    admission: admission.admission,
    headRevision: head.frame.headRevision,
    attemptFence: head.frame.attemptFence,
    currentAttempt: head.frame.currentAttempt,
    lastEvent: head.frame.lastEvent,
    updatedAt: head.frame.updatedAt,
  }).pipe(Effect.mapError(error => mapInputValueError(operation, error)));
  if (
    recaptured.sha256 !== head.sha256 ||
    recaptured.canonicalJson !== head.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const currentLeaseExpiresAt = recaptured.frame.currentAttempt === null
    ? null
    : operationalFrameworkMigrationLeaseExpiryDate(
      recaptured.frame.currentAttempt.leaseExpiresAt,
    );
  if (
    recaptured.frame.currentAttempt !== null &&
    currentLeaseExpiresAt === undefined
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    collision,
    admission,
    currentAttempt,
    lastEvent,
    head: recaptured,
    currentPlanSha256Bytes: yield* decodeAuthenticatedSha256(
      recaptured.frame.currentPlan.planSha256,
    ),
    currentAdmissionSha256Bytes: yield* decodeAuthenticatedSha256(
      recaptured.frame.currentPlan.admissionSha256,
    ),
    headRevision: BigInt(recaptured.frame.headRevision),
    attemptFence: BigInt(recaptured.frame.attemptFence),
    currentLeaseExpiresAt: currentLeaseExpiresAt ?? null,
    lastEventSha256Bytes: recaptured.frame.lastEvent === null
      ? null
      : yield* decodeAuthenticatedSha256(
        recaptured.frame.lastEvent.eventSha256,
      ),
    collisionHeadSha256Bytes: yield* decodeAuthenticatedSha256(
      recaptured.sha256,
    ),
    canonicalBytes: UTF8.encode(recaptured.canonicalJson),
  });
});

const corroborateCollisionHeadDependencies = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.corroborateDependencies",
)(function* (
  transaction: FlarexMetadataTransaction,
  prepared: PreparedFrameworkMigrationCollisionHead,
  operation: CollisionHeadRepositoryOperation,
): Effect.fn.Return<
  CorroboratedFrameworkMigrationCollisionHeadDependencies,
  FrameworkMigrationRepositoryError
> {
  let admission: RestoredFrameworkMigrationPlanAdmission;
  let currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  if (prepared.currentAttempt === null) {
    admission = yield*
      corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect(
        transaction,
        prepared.admission,
        operation,
      );
    currentAttempt = null;
  } else {
    currentAttempt = yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        prepared.currentAttempt,
        operation,
      );
    admission = currentAttempt.admission;
    if (!restoredAdmissionsExactlyMatch(admission, prepared.admission)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
  }
  if (
    admission.collision.storageId !== prepared.collision.storageId ||
    admission.plan.plan.migrationPlanSha256 !==
      prepared.head.frame.currentPlan.planSha256
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const lastEvent = prepared.lastEvent === null
    ? null
    : yield* corroborateRestoredFrameworkMigrationEventInTransactionEffect(
      transaction,
      prepared.lastEvent,
      operation,
    );
  if (
    lastEvent !== null &&
    lastEvent.collision.storageId !== admission.collision.storageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const progress = yield* deriveFrameworkMigrationHeadProgress(admission.plan, currentAttempt, lastEvent, prepared.head.frame.attemptFence)
    .pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  return Object.freeze({
    progress,
    lastStepReceiptSha256Bytes: progress.lastReceipt === null ? null :
      yield* decodeAuthenticatedSha256(progress.lastReceipt.receipt.sha256),
    collision: admission.collision,
    plan: admission.plan,
    admission,
    currentAttempt,
    lastEvent,
  });
}, withFrameworkGraphReadPass);

type CollisionHeadWriteValues = Omit<typeof fxSystemFrameworkMigrationCollisionHeads.$inferInsert, "collisionStorageId">;
type CollisionHeadWriteReferences = Pick<CollisionHeadWriteValues,
  "currentPlanStorageId" | "currentAdmissionStorageId" | "currentAttemptStorageId" | "lastEventStorageId" |
  "completedStepCount" | "lastReceiptStorageId" | "lastStepReceiptSha256">;

function collisionHeadWriteValues(prepared: PreparedFrameworkMigrationCollisionHead,
  dependencies: CorroboratedFrameworkMigrationCollisionHeadDependencies, operation: CollisionHeadRepositoryOperation) {
  return encodeCollisionHeadWriteValues(prepared.head, {
    currentPlanStorageId: dependencies.plan.storageId, currentAdmissionStorageId: dependencies.admission.storageId,
    currentAttemptStorageId: dependencies.currentAttempt?.storageId ?? null, lastEventStorageId: dependencies.lastEvent?.storageId ?? null,
    completedStepCount: dependencies.progress.completedStepCount, lastReceiptStorageId: dependencies.progress.lastReceipt?.storageId ?? null,
    lastStepReceiptSha256: dependencies.lastStepReceiptSha256Bytes,
  }, operation);
}

const encodeCollisionHeadWriteValues = Effect.fn("FrameworkMigrationCollisionHeadRepository.encodeWrite")(
  function* (head: FrameworkMigrationCollisionHead, references: CollisionHeadWriteReferences,
    operation: CollisionHeadRepositoryOperation): Effect.fn.Return<CollisionHeadWriteValues, FrameworkMigrationRepositoryError> {
    const frame = head.frame;
    const currentAttempt = frame.currentAttempt;
    const leaseExpiresAt = currentAttempt === null ? null : operationalFrameworkMigrationLeaseExpiryDate(currentAttempt.leaseExpiresAt);
    if (leaseExpiresAt === undefined) return yield* Effect.fail(FrameworkMigrationRepositoryError.referenceRefusal(operation));
    const canonicalBytes = UTF8.encode(head.canonicalJson);
    return {
      ...references, currentPlanSha256: yield* decodeAuthenticatedSha256(frame.currentPlan.planSha256),
      currentAdmissionSha256: yield* decodeAuthenticatedSha256(frame.currentPlan.admissionSha256),
      headRevision: BigInt(frame.headRevision), attemptFence: BigInt(frame.attemptFence),
      currentAttemptId: currentAttempt?.attemptId ?? null, currentAttemptFence: currentAttempt === null ? null : BigInt(currentAttempt.attemptFence),
      currentLeaseOwnerId: currentAttempt?.leaseOwnerId ?? null, currentLeaseExpiresAt: leaseExpiresAt,
      lastEventSequence: frame.lastEvent === null ? null : BigInt(frame.lastEvent.sequence),
      lastEventSha256: frame.lastEvent === null ? null : yield* decodeAuthenticatedSha256(frame.lastEvent.eventSha256),
      collisionHeadSha256: yield* decodeAuthenticatedSha256(head.sha256), frameFormat: frame.format, frameVersion: frame.version,
      canonicalByteLength: canonicalBytes.byteLength, canonicalBytes,
    };
  },
);

const updateCollisionHeadRoot = Effect.fn("FrameworkMigrationCollisionHeadRepository.updateRoot")(
  function* (transaction: FlarexMetadataTransaction,
    expected: Pick<FrameworkMigrationProgressRecord, "collision" | "head" | "completedStepCount" | "lastReceipt">,
    values: CollisionHeadWriteValues, operation: CollisionHeadRepositoryOperation): Effect.fn.Return<void, FrameworkMigrationRepositoryError> {
    const rows = yield* runRepositoryStatement(operation, transaction.update(fxSystemFrameworkMigrationCollisionHeads).set(values).where(and(
      eq(fxSystemFrameworkMigrationCollisionHeads.collisionStorageId, expected.collision.storageId),
      eq(fxSystemFrameworkMigrationCollisionHeads.headRevision, BigInt(expected.head.frame.headRevision)),
      eq(fxSystemFrameworkMigrationCollisionHeads.collisionHeadSha256, yield* decodeAuthenticatedSha256(expected.head.sha256)),
      eq(fxSystemFrameworkMigrationCollisionHeads.completedStepCount, expected.completedStepCount),
      expected.lastReceipt === null ? isNull(fxSystemFrameworkMigrationCollisionHeads.lastReceiptStorageId) :
        eq(fxSystemFrameworkMigrationCollisionHeads.lastReceiptStorageId, expected.lastReceipt.storageId),
      expected.lastReceipt === null ? isNull(fxSystemFrameworkMigrationCollisionHeads.lastStepReceiptSha256) :
        eq(fxSystemFrameworkMigrationCollisionHeads.lastStepReceiptSha256, yield* decodeAuthenticatedSha256(expected.lastReceipt.sha256)),
    )).returning({ collisionStorageId: fxSystemFrameworkMigrationCollisionHeads.collisionStorageId })).pipe(Effect.map(detachDriverRows));
    if (rows.length === 0) return yield* Effect.fail(FrameworkMigrationRepositoryError.staleHead(operation));
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || row.collisionStorageId !== expected.collision.storageId) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
  },
);

const loadRestoredCollisionHead = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.loadRestored",
)(function* (
  transaction: FlarexMetadataTransaction,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationCollisionHead>,
  FrameworkMigrationRepositoryError
> {
  const row = yield* loadCollisionHeadRoot(
    transaction,
    preferredCollision.storageId,
    operation,
  );
  if (Option.isNone(row)) return Option.none();
  return Option.some(yield* restoreCollisionHeadOccupant(
    transaction,
    row.value,
    preferredCollision,
    operation,
  ));
});

const restoreCollisionHeadOccupant = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.restoreOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationCollisionHeadDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionHead,
  FrameworkMigrationRepositoryError
> {
  const decoded = yield* decodeCollisionHeadRoot(row, operation);
  const collision = yield* resolveCollisionHeadOccupantCollision(
    transaction,
    row,
    decoded.frame,
    preferredCollision,
    operation,
  );
  const currentAttemptFrame = decoded.frame.currentAttempt;
  if (decoded.currentAttemptStorageId !== null && currentAttemptFrame === null) {
    return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  }
  let lastEvent: RestoredFrameworkMigrationEvent | null = null;
  let eventAttempts: FrameworkMigrationEventAttemptSubjects | undefined;
  if (decoded.lastEventStorageId !== null) {
    const lastEventToken = decoded.frame.lastEvent;
    if (lastEventToken === null) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    const graph = yield* restoreStoredFrameworkMigrationEventGraphReferenceInTransactionEffect(
      transaction, collision, decoded.lastEventStorageId, lastEventToken.sequence, lastEventToken.eventSha256, operation,
      decoded.currentAttemptStorageId === null || currentAttemptFrame === null ? undefined : {
        attemptStorageId: decoded.currentAttemptStorageId, attemptId: currentAttemptFrame.attemptId,
      },
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
    lastEvent = graph.event;
    eventAttempts = graph.attempts;
  }
  let plan: RestoredFreshRelationalMigrationPlan;
  let admission: RestoredFrameworkMigrationPlanAdmission;
  let currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  if (decoded.currentAttemptStorageId === null) {
    const graphAdmission = eventAttempts === undefined ? undefined : [...eventAttempts.byStorageId.values()]
      .find(attempt => attempt.admission.storageId === decoded.currentAdmissionStorageId)?.admission;
    admission = graphAdmission ?? (yield*
      restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect(
        transaction,
        collision,
        decoded.currentAdmissionStorageId,
        decoded.frame.currentPlan.admissionSha256,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      )));
    plan = admission.plan;
    currentAttempt = null;
  } else {
    if (currentAttemptFrame === null) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const graphAttempt = eventAttempts?.byStorageId.get(decoded.currentAttemptStorageId);
    if (eventAttempts !== undefined && (graphAttempt === undefined || graphAttempt.attempt.frame.attemptId !== currentAttemptFrame.attemptId)) {
      return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
    }
    currentAttempt = graphAttempt ?? (yield*
      restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
        transaction,
        collision,
        decoded.currentAttemptStorageId,
        currentAttemptFrame.attemptId,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      )));
    admission = currentAttempt.admission;
    plan = currentAttempt.plan;
  }
  if (
    plan.storageId !== decoded.currentPlanStorageId ||
    admission.storageId !== decoded.currentAdmissionStorageId ||
    plan.plan.migrationPlanSha256 !==
      decoded.frame.currentPlan.planSha256 ||
    admission.admission.sha256 !==
      decoded.frame.currentPlan.admissionSha256
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return yield* restoreStoredFrameworkMigrationCollisionHead({
    row,
    collision,
    plan,
    admission,
    currentAttempt,
    lastEvent,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
}, withFrameworkGraphReadPass);

const decodeCollisionHeadRoot = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.decodeRoot",
)(function* (
  row: FrameworkMigrationCollisionHeadDriverRow,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkMigrationCollisionHeadRoot,
  FrameworkMigrationRepositoryError
> {
  const collisionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.collisionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const currentPlanStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.currentPlanStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const currentAdmissionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.currentAdmissionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.collisionHeadSha256,
    {
      format: FRAMEWORK_MIGRATION_COLLISION_HEAD_FORMAT,
      version: FRAMEWORK_MIGRATION_COLLISION_HEAD_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "collisionHead",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFrameworkMigrationCollisionHeadFrame(frame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const currentPlanSha256 = yield* decodeStoredSha256(
    row.currentPlanSha256,
    operation,
  );
  const currentAdmissionSha256 = yield* decodeStoredSha256(
    row.currentAdmissionSha256,
    operation,
  );
  const headRevision = yield* decodeStoredNonNegativeInt64(
    row.headRevision,
    operation,
  );
  const attemptFence = yield* decodeStoredNonNegativeInt64(
    row.attemptFence,
    operation,
  );
  if (
    currentPlanSha256 !== frame.currentPlan.planSha256 ||
    currentAdmissionSha256 !== frame.currentPlan.admissionSha256 ||
    headRevision !== frame.headRevision ||
    attemptFence !== frame.attemptFence
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  let currentAttemptStorageId: bigint | null = null;
  const hasCurrentAttempt = row.currentAttemptStorageId !== null ||
    row.currentAttemptId !== null || row.currentAttemptFence !== null ||
    row.currentLeaseOwnerId !== null || row.currentLeaseExpiresAt !== null;
  if (frame.currentAttempt === null) {
    if (hasCurrentAttempt) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.currentAttemptStorageId === null || row.currentAttemptId === null ||
      row.currentAttemptFence === null || row.currentLeaseOwnerId === null ||
      row.currentLeaseExpiresAt === null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    currentAttemptStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        row.currentAttemptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    const currentAttemptFence = yield* decodeStoredNonNegativeInt64(
      row.currentAttemptFence,
      operation,
    );
    if (
      row.currentAttemptId !== frame.currentAttempt.attemptId ||
      currentAttemptFence !== frame.currentAttempt.attemptFence ||
      row.currentLeaseOwnerId !== frame.currentAttempt.leaseOwnerId ||
      operationalFrameworkMigrationLeaseExpiryDate(
        frame.currentAttempt.leaseExpiresAt,
      ) === undefined
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }

  let lastEventStorageId: bigint | null = null;
  const hasLastEvent = row.lastEventStorageId !== null ||
    row.lastEventSequence !== null || row.lastEventSha256 !== null;
  if (frame.lastEvent === null) {
    if (hasLastEvent) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.lastEventStorageId === null || row.lastEventSequence === null ||
      row.lastEventSha256 === null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    lastEventStorageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
      row.lastEventStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ));
    const lastEventSequence = yield* decodeStoredNonNegativeInt64(
      row.lastEventSequence,
      operation,
    );
    const lastEventSha256 = yield* decodeStoredSha256(
      row.lastEventSha256,
      operation,
    );
    if (
      lastEventSequence !== frame.lastEvent.sequence ||
      lastEventSha256 !== frame.lastEvent.eventSha256
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  return Object.freeze({
    collisionStorageId,
    currentPlanStorageId,
    currentAdmissionStorageId,
    currentAttemptStorageId,
    lastEventStorageId,
    frame,
    head: Object.freeze({ frame, sha256: recordHeadSha256(stored.sha256Hex), canonicalJson: stored.canonicalJson }),
  });
});

const resolveCollisionHeadOccupantCollision = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.resolveOccupantCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  row: FrameworkMigrationCollisionHeadDriverRow,
  frame: FrameworkMigrationCollisionHeadFrame,
  preferred: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (
    isRestoredFrameworkMigrationCollisionDomain(preferred) &&
    row.collisionStorageId === preferred.storageId &&
    sameCollisionCoordinate(frame.collision, preferred.coordinate)
  ) return preferred;

  const targetValue = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId: frame.collision.targetNamespace.deploymentId,
    physicalDatabaseIdentity:
      frame.collision.targetNamespace.physicalDatabaseIdentity,
    schemaName: frame.collision.targetNamespace.schemaName,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  const target = yield*
    readFrameworkSchemaTargetNamespaceForOperationInTransactionEffect(
      transaction,
      targetValue,
      operation,
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
  if (Option.isNone(target)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const collision = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      target.value,
      frame.collision,
      operation,
    ).pipe(Effect.mapError(error => mapStoredRepositoryError(operation, error)));
  if (
    Option.isNone(collision) ||
    collision.value.storageId !== row.collisionStorageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return collision.value;
});

const corroborateCollision = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.corroborateCollision",
)(function* (
  transaction: FlarexMetadataTransaction,
  expected: RestoredFrameworkMigrationCollisionDomain,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.fn.Return<
  RestoredFrameworkMigrationCollisionDomain,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(expected)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const restored = yield*
    readFrameworkMigrationCollisionDomainForOperationInTransactionEffect(
      transaction,
      expected.targetNamespace,
      expected.coordinate,
      operation,
    );
  if (
    Option.isNone(restored) || restored.value.storageId !== expected.storageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return restored.value;
});

const loadCollisionHeadRoot = Effect.fn(
  "FrameworkMigrationCollisionHeadRepository.loadRoot",
)(function* (
  transaction: FlarexMetadataTransaction,
  collisionStorageId: bigint,
  operation: FrameworkMigrationRepositoryOperation,
  forUpdate = false,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationCollisionHeadDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(collisionHeadReadSelection).from(
    fxSystemFrameworkMigrationCollisionHeads,
  ).where(eq(
    fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
    collisionStorageId,
  )).limit(2);
  const rows = yield* runRepositoryStatement(
    operation,
    forUpdate ? query.for("update") : query,
  ).pipe(Effect.map(detachDriverRows));
  if (rows.length > 1) return yield* Effect.fail(FrameworkMigrationRepositoryError.storedCorruption(operation));
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

function currentAttemptMatchesHead(
  attempt: RestoredFrameworkMigrationAttemptStart | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
  admission: RestoredFrameworkMigrationPlanAdmission,
  frame: FrameworkMigrationCollisionHeadFrame,
): boolean {
  if (frame.currentAttempt === null) return attempt === null;
  return attempt !== null && isRestoredFrameworkMigrationAttemptStart(attempt) &&
    attempt.collision.storageId === collision.storageId &&
    attempt.plan.storageId === admission.plan.storageId &&
    attempt.admission.storageId === admission.storageId &&
    attempt.attempt.frame.attemptId === frame.currentAttempt.attemptId &&
    attempt.attempt.frame.attemptFence === frame.currentAttempt.attemptFence &&
    frame.attemptFence === frame.currentAttempt.attemptFence;
}

function lastEventMatchesHead(
  event: RestoredFrameworkMigrationEvent | null,
  collision: RestoredFrameworkMigrationCollisionDomain,
  frame: FrameworkMigrationCollisionHeadFrame,
): boolean {
  if (frame.lastEvent === null) return event === null;
  return event !== null && isRestoredFrameworkMigrationEvent(event) &&
    restoredFrameworkMigrationEventAuthority(event) !== undefined &&
    event.collision.storageId === collision.storageId &&
    event.event.frame.sequence === frame.lastEvent.sequence &&
    event.event.sha256 === frame.lastEvent.eventSha256;
}

function collisionHeadExactlyMatches(
  actual: RestoredFrameworkMigrationCollisionHead,
  dependencies: CorroboratedFrameworkMigrationCollisionHeadDependencies,
  expected: FrameworkMigrationCollisionHead,
): boolean {
  return actual.collision.storageId === dependencies.collision.storageId &&
    actual.plan.storageId === dependencies.plan.storageId &&
    actual.admission.storageId === dependencies.admission.storageId &&
    actual.head.sha256 === expected.sha256 &&
    actual.head.canonicalJson === expected.canonicalJson;
}

function restoredAdmissionsExactlyMatch(
  left: RestoredFrameworkMigrationPlanAdmission,
  right: RestoredFrameworkMigrationPlanAdmission,
): boolean {
  return left.storageId === right.storageId &&
    left.collision.storageId === right.collision.storageId &&
    left.plan.storageId === right.plan.storageId &&
    left.plan.plan.migrationPlanSha256 === right.plan.plan.migrationPlanSha256 &&
    left.admission.sha256 === right.admission.sha256 &&
    left.admission.canonicalJson === right.admission.canonicalJson;
}

function sameCollisionCoordinate(
  left: FrameworkMigrationCollisionCoordinate,
  right: FrameworkMigrationCollisionCoordinate,
): boolean {
  return sameTargetNamespace(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner && left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespace(
  left: FrameworkMigrationCollisionCoordinate["targetNamespace"],
  right: FrameworkMigrationCollisionCoordinate["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

function runRepositoryStatement<Value>(
  operation: FrameworkMigrationRepositoryOperation,
  statement: PromiseLike<Value>,
): Effect.Effect<Value, FrameworkMigrationRepositoryError> {
  return runDrizzleStatementEffect(
    statement,
    cause => FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      cause,
    ),
  );
}

function decodeAuthenticatedSha256(value: string): Effect.Effect<Uint8Array> {
  return Effect.fromResult(Encoding.decodeHex(value)).pipe(Effect.orDie);
}

function decodeStoredSha256(
  value: unknown,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredSha256HexResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function decodeStoredNonNegativeInt64(
  value: unknown,
  operation: FrameworkMigrationRepositoryOperation,
): Effect.Effect<string, FrameworkMigrationRepositoryError> {
  return Effect.fromResult(decodeStoredNonNegativeInt64TextResult(
    value,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
}

function mapInputValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.referenceRefusal(operation);
}

function mapStoredValueError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(operation, error.cause)
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredRepositoryError(
  operation: FrameworkMigrationRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

const collisionHeadCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationCollisionHeads.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const collisionHeadReadSelection = {
  completedStepCount: fxSystemFrameworkMigrationCollisionHeads.completedStepCount,
  lastReceiptStorageId: fxSystemFrameworkMigrationCollisionHeads.lastReceiptStorageId,
  lastStepReceiptSha256: fxSystemFrameworkMigrationCollisionHeads.lastStepReceiptSha256,
  collisionStorageId:
    fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
  currentPlanStorageId:
    fxSystemFrameworkMigrationCollisionHeads.currentPlanStorageId,
  currentPlanSha256:
    fxSystemFrameworkMigrationCollisionHeads.currentPlanSha256,
  currentAdmissionStorageId:
    fxSystemFrameworkMigrationCollisionHeads.currentAdmissionStorageId,
  currentAdmissionSha256:
    fxSystemFrameworkMigrationCollisionHeads.currentAdmissionSha256,
  headRevision: fxSystemFrameworkMigrationCollisionHeads.headRevision,
  attemptFence: fxSystemFrameworkMigrationCollisionHeads.attemptFence,
  currentAttemptStorageId:
    fxSystemFrameworkMigrationCollisionHeads.currentAttemptStorageId,
  currentAttemptId:
    fxSystemFrameworkMigrationCollisionHeads.currentAttemptId,
  currentAttemptFence:
    fxSystemFrameworkMigrationCollisionHeads.currentAttemptFence,
  currentLeaseOwnerId:
    fxSystemFrameworkMigrationCollisionHeads.currentLeaseOwnerId,
  currentLeaseExpiresAt:
    fxSystemFrameworkMigrationCollisionHeads.currentLeaseExpiresAt,
  lastEventStorageId:
    fxSystemFrameworkMigrationCollisionHeads.lastEventStorageId,
  lastEventSequence:
    fxSystemFrameworkMigrationCollisionHeads.lastEventSequence,
  lastEventSha256: fxSystemFrameworkMigrationCollisionHeads.lastEventSha256,
  collisionHeadSha256:
    fxSystemFrameworkMigrationCollisionHeads.collisionHeadSha256,
  frameFormat: fxSystemFrameworkMigrationCollisionHeads.frameFormat,
  frameVersion: fxSystemFrameworkMigrationCollisionHeads.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkMigrationCollisionHeads.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationCollisionHeads.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${collisionHeadCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationCollisionHeads.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkMigrationCollisionHeadRow,
  unknown
>;
