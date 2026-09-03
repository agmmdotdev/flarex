import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationCollisionHead,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationCollisionHeadSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect,
  operationalFrameworkMigrationLeaseExpiryDate,
  restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect,
} from "./migrationAttemptRepository";
import {
  corroborateRestoredFrameworkMigrationEventInTransactionEffect,
  restoreStoredFrameworkMigrationEventReferenceInTransactionEffect,
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
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import { fxSystemFrameworkMigrationCollisionHeads } from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFreshRelationalMigrationPlan,
} from "./storedRestoration";
import {
  isRestoredFrameworkMigrationCollisionHead,
  isRestoredFrameworkMigrationEvent,
  restoreStoredFrameworkMigrationCollisionHead,
  restoredFrameworkMigrationCollisionHeadAuthority,
  restoredFrameworkMigrationEventAuthority,
  type RestoredFrameworkMigrationCollisionHead,
  type RestoredFrameworkMigrationEvent,
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
  readonly collision: RestoredFrameworkMigrationCollisionDomain;
  readonly plan: RestoredFreshRelationalMigrationPlan;
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  readonly lastEvent: RestoredFrameworkMigrationEvent | null;
}

interface FrameworkMigrationCollisionHeadDriverRow
  extends StoredFrameworkMigrationCollisionHeadRow {
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
}

const UTF8 = new TextEncoder();

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
          ...collisionHeadWriteValues(prepared, dependencies),
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
      const expectedDependencies = yield* corroborateCollisionHeadDependencies(
        transaction,
        preparedExpected,
        operation,
      );
      const current = yield* loadRestoredCollisionHead(
        transaction,
        expectedDependencies.collision,
        operation,
      );
      if (
        Option.isNone(current) ||
        !collisionHeadExactlyMatches(
          current.value,
          expectedDependencies,
          preparedExpected.head,
        )
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }

      const prepared = yield* prepareExpectedCollisionHead(
        current.value.collision,
        nextAdmission,
        nextCurrentAttempt,
        nextLastEvent,
        nextHead,
        operation,
      );
      const dependencies = yield* corroborateCollisionHeadDependencies(
        transaction,
        prepared,
        operation,
      );
      if (
        dependencies.collision.storageId !== current.value.collision.storageId
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.referenceRefusal(operation),
        );
      }
      const expectedSha256Bytes = yield* decodeAuthenticatedSha256(
        expected.head.sha256,
      );
      const updatedRows = yield* runRepositoryStatement(
        operation,
        transaction.update(fxSystemFrameworkMigrationCollisionHeads).set(
          collisionHeadWriteValues(prepared, dependencies),
        ).where(and(
          eq(
            fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
            current.value.collision.storageId,
          ),
          eq(
            fxSystemFrameworkMigrationCollisionHeads.headRevision,
            BigInt(expected.head.frame.headRevision),
          ),
          eq(
            fxSystemFrameworkMigrationCollisionHeads.collisionHeadSha256,
            expectedSha256Bytes,
          ),
        )).returning({
          collisionStorageId:
            fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
        }),
      ).pipe(Effect.map(detachDriverRows));
      if (updatedRows.length === 0) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.staleHead(operation),
        );
      }
      const updated = updatedRows[0];
      if (updated === undefined || updatedRows.length !== 1) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      const updatedCollisionStorageId = yield* Effect.fromResult(
        decodeStoredStorageIdResult(
          updated.collisionStorageId,
          () => FrameworkMigrationRepositoryError.storedCorruption(operation),
        ),
      );
      if (updatedCollisionStorageId !== current.value.collision.storageId) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
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
  return Object.freeze({
    collision: admission.collision,
    plan: admission.plan,
    admission,
    currentAttempt,
    lastEvent,
  });
});

function collisionHeadWriteValues(
  prepared: PreparedFrameworkMigrationCollisionHead,
  dependencies: CorroboratedFrameworkMigrationCollisionHeadDependencies,
) {
  const currentAttempt = prepared.head.frame.currentAttempt;
  return {
    currentPlanStorageId: dependencies.plan.storageId,
    currentPlanSha256: prepared.currentPlanSha256Bytes,
    currentAdmissionStorageId: dependencies.admission.storageId,
    currentAdmissionSha256: prepared.currentAdmissionSha256Bytes,
    headRevision: prepared.headRevision,
    attemptFence: prepared.attemptFence,
    currentAttemptStorageId: dependencies.currentAttempt?.storageId ?? null,
    currentAttemptId: currentAttempt?.attemptId ?? null,
    currentAttemptFence: currentAttempt === null
      ? null
      : BigInt(currentAttempt.attemptFence),
    currentLeaseOwnerId: currentAttempt?.leaseOwnerId ?? null,
    currentLeaseExpiresAt: prepared.currentLeaseExpiresAt,
    lastEventStorageId: dependencies.lastEvent?.storageId ?? null,
    lastEventSequence: dependencies.lastEvent === null
      ? null
      : BigInt(dependencies.lastEvent.event.frame.sequence),
    lastEventSha256: prepared.lastEventSha256Bytes,
    collisionHeadSha256: prepared.collisionHeadSha256Bytes,
    frameFormat: prepared.head.frame.format,
    frameVersion: prepared.head.frame.version,
    canonicalByteLength: prepared.canonicalBytes.byteLength,
    canonicalBytes: prepared.canonicalBytes,
  };
}

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
  let plan: RestoredFreshRelationalMigrationPlan;
  let admission: RestoredFrameworkMigrationPlanAdmission;
  let currentAttempt: RestoredFrameworkMigrationAttemptStart | null;
  if (decoded.currentAttemptStorageId === null) {
    admission = yield*
      restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect(
        transaction,
        collision,
        decoded.currentAdmissionStorageId,
        decoded.frame.currentPlan.admissionSha256,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
    plan = admission.plan;
    currentAttempt = null;
  } else {
    const currentAttemptFrame = decoded.frame.currentAttempt;
    if (currentAttemptFrame === null) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    currentAttempt = yield*
      restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect(
        transaction,
        collision,
        decoded.currentAttemptStorageId,
        currentAttemptFrame.attemptId,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
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
  let lastEvent: RestoredFrameworkMigrationEvent | null = null;
  if (decoded.lastEventStorageId !== null) {
    const lastEventToken = decoded.frame.lastEvent;
    if (lastEventToken === null) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    lastEvent = yield*
      restoreStoredFrameworkMigrationEventReferenceInTransactionEffect(
        transaction,
        collision,
        decoded.lastEventStorageId,
        lastEventToken.sequence,
        lastEventToken.eventSha256,
        operation,
      ).pipe(Effect.mapError(error =>
        mapStoredRepositoryError(operation, error)
      ));
  }
  return yield* restoreStoredFrameworkMigrationCollisionHead({
    row,
    collision,
    plan,
    admission,
    currentAttempt,
    lastEvent,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
});

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
): Effect.fn.Return<
  Option.Option<FrameworkMigrationCollisionHeadDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(
    operation,
    transaction.select(collisionHeadReadSelection).from(
      fxSystemFrameworkMigrationCollisionHeads,
    ).where(eq(
      fxSystemFrameworkMigrationCollisionHeads.collisionStorageId,
      collisionStorageId,
    )).limit(1),
  ).pipe(Effect.map(detachDriverRows));
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
