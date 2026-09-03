import {
  epochMillisecondsFromCanonicalIsoInstant,
  type CanonicalIsoInstant,
} from
  "@flarex/time/iso-instant";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";

import { detachDriverRows } from "../detachDriverRows";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { capturePrivateCanonicalValue } from
  "../frameworkSchema/privateCanonicalValue";
import {
  decodeStoredCanonicalMetadataResult,
  decodeStoredNonNegativeInt64TextResult,
  decodeStoredSha256HexResult,
  decodeStoredStorageIdResult,
} from "../frameworkSchema/privateStoredMetadataValue";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { capturedAuthorityForAttempt } from "./authority";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  verifyStoredFrameworkMigrationValue,
} from "./canonical";
import type { FrameworkMigrationValueError } from "./errors";
import type { FrameworkMigrationAttemptStartSha256 } from "./identity";
import {
  corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect,
  restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect,
} from "./migrationPlanAdmissionRepository";
import {
  FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
  FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
  type CapturedFrameworkMigrationValue,
  type FrameworkMigrationAttemptStartFrame,
} from "./model";
import {
  FrameworkMigrationRepositoryError,
  type FrameworkMigrationRepositoryOperation,
} from "./repositoryErrors";
import { fxSystemFrameworkMigrationAttemptStarts } from "./schema";
import {
  isRestoredFrameworkMigrationAttemptStart,
  isRestoredFrameworkMigrationCollisionDomain,
  isRestoredFrameworkMigrationPlanAdmission,
  restoreStoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type StoredFrameworkMigrationAttemptStartRow,
} from "./storedRestoration";
import { isStoredFrameworkMigrationAttemptStartFrame } from
  "./storedValidation";

type FrameworkMigrationAttemptStart = CapturedFrameworkMigrationValue<
  FrameworkMigrationAttemptStartFrame,
  FrameworkMigrationAttemptStartSha256
>;

type AttemptStartRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  "ensureAttemptStart" | "readAttemptStart"
>;

type AttemptStartAggregateRepositoryOperation = Extract<
  FrameworkMigrationRepositoryOperation,
  | "ensureAttemptStart"
  | "readAttemptStart"
  | "ensureStepReceipt"
  | "readStepReceipt"
  | "ensureAttemptTerminal"
  | "readAttemptTerminal"
>;

interface PreparedFrameworkMigrationAttemptStart {
  readonly admission: RestoredFrameworkMigrationPlanAdmission;
  readonly previousAttempt: RestoredFrameworkMigrationAttemptStart | null;
  readonly attempt: FrameworkMigrationAttemptStart;
  readonly migrationPlanSha256Bytes: Uint8Array;
  readonly admissionSha256Bytes: Uint8Array;
  readonly attemptStartSha256Bytes: Uint8Array;
  readonly attemptFence: bigint;
  readonly leaseExpiresAt: Date;
  readonly canonicalBytes: Uint8Array;
}

interface FrameworkMigrationAttemptStartDriverRow
  extends StoredFrameworkMigrationAttemptStartRow {
  readonly attemptStorageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly migrationPlanSha256: Uint8Array;
  readonly admissionStorageId: bigint;
  readonly admissionSha256: Uint8Array;
  readonly attemptId: string;
  readonly attemptFence: bigint;
  readonly leaseOwnerId: string;
  readonly leaseExpiresAt: Date;
  readonly previousAttemptStorageId: bigint | null;
  readonly previousAttemptId: string | null;
  readonly attemptStartSha256: Uint8Array;
  readonly frameFormat: typeof FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT;
  readonly frameVersion: typeof FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION;
  readonly canonicalByteLength: number;
  readonly observedCanonicalByteLength: number;
  readonly canonicalBytes: Uint8Array | null;
}

interface DecodedFrameworkMigrationAttemptStartRoot {
  readonly storageId: bigint;
  readonly collisionStorageId: bigint;
  readonly planStorageId: bigint;
  readonly admissionStorageId: bigint;
  readonly previousAttemptStorageId: bigint | null;
  readonly frame: FrameworkMigrationAttemptStartFrame;
}

interface RestoredFrameworkMigrationAttemptStartOccupant {
  readonly value: RestoredFrameworkMigrationAttemptStart;
  readonly previousAttempt: RestoredFrameworkMigrationAttemptStart | null;
}

interface CachedFrameworkMigrationPlanAdmission {
  readonly admissionSha256: string;
  readonly planStorageId: bigint;
  readonly value: RestoredFrameworkMigrationPlanAdmission;
}

interface FrameworkMigrationAttemptStartOccupantLookups {
  readonly readByAttemptId: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationAttemptStartOccupant>,
    FrameworkMigrationRepositoryError
  >;
  readonly readByAttemptFence: () => Effect.Effect<
    Option.Option<RestoredFrameworkMigrationAttemptStartOccupant>,
    FrameworkMigrationRepositoryError
  >;
}

const FOUR_DIGIT_UTC_MILLISECOND_INSTANT =
  /^(?!0000-)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

export const ensureFrameworkMigrationAttemptStartInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptStartRepository.ensure",
  )(function* (
    transaction: FlarexMetadataTransaction,
    admission: RestoredFrameworkMigrationPlanAdmission,
    previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
    attempt: FrameworkMigrationAttemptStart,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationAttemptStart,
    FrameworkMigrationRepositoryError
  > {
    const operation = "ensureAttemptStart" as const;
    const prepared = yield* prepareExpectedAttemptStart(
      admission,
      previousAttempt,
      attempt,
      operation,
    );
    const storedAdmission = yield*
      corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect(
        transaction,
        prepared.admission,
        operation,
      );
    const storedPreviousAttempt = prepared.previousAttempt === null
      ? null
      : yield*
        corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          prepared.previousAttempt,
          operation,
        );
    if (
      storedPreviousAttempt !== null &&
      storedPreviousAttempt.collision.storageId !==
        storedAdmission.collision.storageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }

    yield* runRepositoryStatement(
      operation,
      transaction.insert(fxSystemFrameworkMigrationAttemptStarts).values({
        collisionStorageId: storedAdmission.collision.storageId,
        planStorageId: storedAdmission.plan.storageId,
        migrationPlanSha256: prepared.migrationPlanSha256Bytes,
        admissionStorageId: storedAdmission.storageId,
        admissionSha256: prepared.admissionSha256Bytes,
        attemptId: prepared.attempt.frame.attemptId,
        attemptFence: prepared.attemptFence,
        leaseOwnerId: prepared.attempt.frame.leaseOwnerId,
        leaseExpiresAt: prepared.leaseExpiresAt,
        previousAttemptStorageId: storedPreviousAttempt?.storageId ?? null,
        previousAttemptId: prepared.attempt.frame.previousAttemptId,
        attemptStartSha256: prepared.attemptStartSha256Bytes,
        frameFormat: prepared.attempt.frame.format,
        frameVersion: prepared.attempt.frame.version,
        canonicalByteLength: prepared.canonicalBytes.byteLength,
        canonicalBytes: prepared.canonicalBytes,
      }).onConflictDoNothing(),
    );

    const resolved = yield* resolveExpectedAttemptStart(
      transaction,
      storedAdmission,
      storedPreviousAttempt,
      prepared.attempt,
      prepared.attemptFence,
      operation,
    );
    if (Option.isNone(resolved)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return resolved.value;
  });

export const readFrameworkMigrationAttemptStartInTransactionEffect = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.read",
)(function* (
  transaction: FlarexMetadataTransaction,
  admission: RestoredFrameworkMigrationPlanAdmission,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  attempt: FrameworkMigrationAttemptStart,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptStart>,
  FrameworkMigrationRepositoryError
> {
  const operation = "readAttemptStart" as const;
  const prepared = yield* prepareExpectedAttemptStart(
    admission,
    previousAttempt,
    attempt,
    operation,
  );
  const storedAdmission = yield*
    corroborateRestoredFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      prepared.admission,
      operation,
    );
  const storedPreviousAttempt = prepared.previousAttempt === null
    ? null
    : yield*
      corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect(
        transaction,
        prepared.previousAttempt,
        operation,
      );
  if (
    storedPreviousAttempt !== null &&
    storedPreviousAttempt.collision.storageId !==
      storedAdmission.collision.storageId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return yield* resolveExpectedAttemptStart(
    transaction,
    storedAdmission,
    storedPreviousAttempt,
    prepared.attempt,
    prepared.attemptFence,
    operation,
  );
});

/**
 * Source-private policy seam for authenticated occupants returned by the two
 * collision-local uniqueness lookups. The fence lookup is intentionally lazy.
 */
export const resolveAuthenticatedFrameworkMigrationAttemptStartOccupantsEffect =
  Effect.fn(
    "FrameworkMigrationAttemptStartRepository.resolveOccupants",
  )(function* (
    admission: RestoredFrameworkMigrationPlanAdmission,
    previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
    expected: FrameworkMigrationAttemptStart,
    operation: AttemptStartRepositoryOperation,
    lookups: FrameworkMigrationAttemptStartOccupantLookups,
  ): Effect.fn.Return<
    Option.Option<RestoredFrameworkMigrationAttemptStart>,
    FrameworkMigrationRepositoryError
  > {
    const byAttemptId = yield* lookups.readByAttemptId();
    if (Option.isSome(byAttemptId)) {
      if (attemptStartExactlyMatches(
        byAttemptId.value,
        admission,
        previousAttempt,
        expected,
      )) {
        return Option.some(byAttemptId.value.value);
      }
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.immutableConflict(operation),
      );
    }

    const byAttemptFence = yield* lookups.readByAttemptFence();
    if (Option.isNone(byAttemptFence)) return Option.none();
    if (attemptStartExactlyMatches(
      byAttemptFence.value,
      admission,
      previousAttempt,
      expected,
    )) {
      return Option.some(byAttemptFence.value.value);
    }
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.immutableConflict(operation),
    );
  });

/**
 * Source-private same-transaction corroboration for a restored attempt used as
 * a prerequisite. Its complete predecessor lineage is restored before the
 * supplied handle is accepted.
 */
export const corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptStartRepository.corroborateRestored",
  )(function* (
    transaction: FlarexMetadataTransaction,
    expected: RestoredFrameworkMigrationAttemptStart,
    operation: AttemptStartAggregateRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationAttemptStart,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationAttemptStart(expected)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const row = yield* loadAttemptStartRootByStorageId(
      transaction,
      expected.storageId,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    const occupant = yield* restoreAttemptStartLineage(
      transaction,
      row.value,
      expected.collision,
      operation,
    );
    if (!restoredAttemptStartExactlyMatches(occupant.value, expected)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      );
    }
    return occupant.value;
  });

/**
 * Source-private restoration for an attempt referenced by stored aggregate
 * state. Missing or mismatched rows are corruption, never ordinary absence.
 */
export const restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect =
  Effect.fn(
    "FrameworkMigrationAttemptStartRepository.restoreStoredReference",
  )(function* (
    transaction: FlarexMetadataTransaction,
    preferredCollision: RestoredFrameworkMigrationCollisionDomain,
    attemptStorageId: bigint,
    attemptId: string,
    operation: AttemptStartAggregateRepositoryOperation,
  ): Effect.fn.Return<
    RestoredFrameworkMigrationAttemptStart,
    FrameworkMigrationRepositoryError
  > {
    if (!isRestoredFrameworkMigrationCollisionDomain(preferredCollision)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const row = yield* loadAttemptStartRootByStorageId(
      transaction,
      attemptStorageId,
      operation,
    );
    if (Option.isNone(row)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const occupant = yield* restoreAttemptStartLineage(
      transaction,
      row.value,
      preferredCollision,
      operation,
    );
    if (occupant.value.attempt.frame.attemptId !== attemptId) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    return occupant.value;
  });

const prepareExpectedAttemptStart = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.prepareExpected",
)(function* (
  admission: RestoredFrameworkMigrationPlanAdmission,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  attempt: FrameworkMigrationAttemptStart,
  operation: AttemptStartRepositoryOperation,
): Effect.fn.Return<
  PreparedFrameworkMigrationAttemptStart,
  FrameworkMigrationRepositoryError
> {
  const authority = capturedAuthorityForAttempt(attempt);
  if (
    !isRestoredFrameworkMigrationPlanAdmission(admission) ||
    authority === undefined ||
    authority.admission !== admission.admission ||
    authority.plan !== admission.plan.plan ||
    !attemptFrameMatchesAdmission(attempt.frame, admission)
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  if (
    attempt.frame.previousAttemptId === null
      ? previousAttempt !== null
      : previousAttempt === null ||
        !isRestoredFrameworkMigrationAttemptStart(previousAttempt) ||
        previousAttempt.collision.storageId !== admission.collision.storageId ||
        !sameCollisionCoordinate(
          previousAttempt.collision.coordinate,
          admission.collision.coordinate,
        ) ||
        previousAttempt.attempt.frame.attemptId !==
          attempt.frame.previousAttemptId
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const captured = yield* capturePrivateCanonicalValue(
    attempt.frame,
    MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    {
      invalidInput: () =>
        FrameworkMigrationRepositoryError.referenceRefusal(operation),
      hashFailure: cause =>
        FrameworkMigrationRepositoryError.resourceFailure(operation, cause),
    },
  );
  if (
    captured.sha256Hex !== attempt.sha256 ||
    captured.canonicalJson !== attempt.canonicalJson
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  const leaseExpiresAt = operationalLeaseExpiryDate(
    attempt.frame.leaseExpiresAt,
  );
  if (leaseExpiresAt === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.referenceRefusal(operation),
    );
  }
  return Object.freeze({
    admission,
    previousAttempt,
    attempt,
    migrationPlanSha256Bytes: yield* decodeAuthenticatedSha256(
      attempt.frame.planSha256,
    ),
    admissionSha256Bytes: yield* decodeAuthenticatedSha256(
      attempt.frame.admissionSha256,
    ),
    attemptStartSha256Bytes: captured.copySha256Bytes(),
    attemptFence: BigInt(attempt.frame.attemptFence),
    leaseExpiresAt,
    canonicalBytes: captured.copyCanonicalBytes(),
  });
});

const resolveExpectedAttemptStart = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.resolveExpected",
)(function* (
  transaction: FlarexMetadataTransaction,
  admission: RestoredFrameworkMigrationPlanAdmission,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  expected: FrameworkMigrationAttemptStart,
  attemptFence: bigint,
  operation: AttemptStartRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptStart>,
  FrameworkMigrationRepositoryError
> {
  return yield*
    resolveAuthenticatedFrameworkMigrationAttemptStartOccupantsEffect(
      admission,
      previousAttempt,
      expected,
      operation,
      {
        readByAttemptId: () => loadAttemptStartOccupantByAttemptId(
          transaction,
          admission.collision,
          expected.frame.attemptId,
          previousAttempt,
          admission,
          operation,
        ),
        readByAttemptFence: () => loadAttemptStartOccupantByAttemptFence(
          transaction,
          admission.collision,
          attemptFence,
          previousAttempt,
          admission,
          operation,
        ),
      },
    );
});

const loadAttemptStartOccupantByAttemptId = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.loadByAttemptId",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  attemptId: string,
  preferredPreviousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  preferredAdmission: RestoredFrameworkMigrationPlanAdmission,
  operation: AttemptStartRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptStartOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptStartReadSelection).from(
    fxSystemFrameworkMigrationAttemptStarts,
  ).where(and(
    eq(
      fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
      collision.storageId,
    ),
    eq(fxSystemFrameworkMigrationAttemptStarts.attemptId, attemptId),
  )).limit(1);
  return yield* loadAttemptStartOccupant(
    transaction,
    collision,
    query,
    preferredPreviousAttempt,
    preferredAdmission,
    operation,
  );
});

const loadAttemptStartOccupantByAttemptFence = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.loadByAttemptFence",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  attemptFence: bigint,
  preferredPreviousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  preferredAdmission: RestoredFrameworkMigrationPlanAdmission,
  operation: AttemptStartRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptStartOccupant>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptStartReadSelection).from(
    fxSystemFrameworkMigrationAttemptStarts,
  ).where(and(
    eq(
      fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
      collision.storageId,
    ),
    eq(fxSystemFrameworkMigrationAttemptStarts.attemptFence, attemptFence),
  )).limit(1);
  return yield* loadAttemptStartOccupant(
    transaction,
    collision,
    query,
    preferredPreviousAttempt,
    preferredAdmission,
    operation,
  );
});

const loadAttemptStartOccupant = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.loadOccupant",
)(function* (
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  query: PromiseLike<readonly FrameworkMigrationAttemptStartDriverRow[]>,
  preferredPreviousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  preferredAdmission: RestoredFrameworkMigrationPlanAdmission,
  operation: AttemptStartRepositoryOperation,
): Effect.fn.Return<
  Option.Option<RestoredFrameworkMigrationAttemptStartOccupant>,
  FrameworkMigrationRepositoryError
> {
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  const row = rows[0];
  return row === undefined
    ? Option.none()
    : Option.some(yield* restoreAttemptStartLineage(
      transaction,
      row,
      collision,
      operation,
      preferredPreviousAttempt,
      preferredAdmission,
    ));
});

const loadAttemptStartRootByStorageId = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.loadByStorageId",
)(function* (
  transaction: FlarexMetadataTransaction,
  attemptStorageId: bigint,
  operation: AttemptStartAggregateRepositoryOperation,
): Effect.fn.Return<
  Option.Option<FrameworkMigrationAttemptStartDriverRow>,
  FrameworkMigrationRepositoryError
> {
  const query = transaction.select(attemptStartReadSelection).from(
    fxSystemFrameworkMigrationAttemptStarts,
  ).where(eq(
    fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
    attemptStorageId,
  )).limit(1);
  const rows = yield* runRepositoryStatement(operation, query).pipe(
    Effect.map(detachDriverRows),
  );
  return rows[0] === undefined ? Option.none() : Option.some(rows[0]);
});

const restoreAttemptStartLineage = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.restoreLineage",
)(function* (
  transaction: FlarexMetadataTransaction,
  root: FrameworkMigrationAttemptStartDriverRow,
  preferredCollision: RestoredFrameworkMigrationCollisionDomain,
  operation: AttemptStartAggregateRepositoryOperation,
  preferredPreviousAttempt?: RestoredFrameworkMigrationAttemptStart | null,
  preferredAdmission?: RestoredFrameworkMigrationPlanAdmission,
): Effect.fn.Return<
  RestoredFrameworkMigrationAttemptStartOccupant,
  FrameworkMigrationRepositoryError
> {
  if (!isRestoredFrameworkMigrationCollisionDomain(preferredCollision)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const rows: FrameworkMigrationAttemptStartDriverRow[] = [];
  const decodedRows: DecodedFrameworkMigrationAttemptStartRoot[] = [];
  const seenStorageIds = new Set<bigint>();
  const seenAttemptIds = new Set<string>();
  const admissionsByStorageId = new Map<
    bigint,
    CachedFrameworkMigrationPlanAdmission
  >();
  if (
    preferredAdmission !== undefined &&
    isRestoredFrameworkMigrationPlanAdmission(preferredAdmission) &&
    preferredAdmission.collision === preferredCollision
  ) {
    admissionsByStorageId.set(preferredAdmission.storageId, Object.freeze({
      admissionSha256: preferredAdmission.admission.sha256,
      planStorageId: preferredAdmission.plan.storageId,
      value: preferredAdmission,
    }));
  }
  let row = root;
  let requiredAttemptId: string | null = null;
  let anchoredPreviousAttempt: RestoredFrameworkMigrationAttemptStart | null =
    null;
  while (true) {
    const decoded = yield* decodeAttemptStartRoot(row, operation);
    if (
      decoded.collisionStorageId !== preferredCollision.storageId ||
      !sameCollisionCoordinate(
        decoded.frame.collision,
        preferredCollision.coordinate,
      ) ||
      (requiredAttemptId !== null &&
        decoded.frame.attemptId !== requiredAttemptId) ||
      seenStorageIds.has(decoded.storageId) ||
      seenAttemptIds.has(decoded.frame.attemptId)
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    seenStorageIds.add(decoded.storageId);
    seenAttemptIds.add(decoded.frame.attemptId);
    rows.push(row);
    decodedRows.push(decoded);
    if (
      rows.length === 1 &&
      preferredPreviousAttempt !== undefined &&
      preferredPreviousAttempt !== null &&
      isRestoredFrameworkMigrationAttemptStart(preferredPreviousAttempt) &&
      preferredPreviousAttempt.collision === preferredCollision &&
      decoded.previousAttemptStorageId === preferredPreviousAttempt.storageId &&
      decoded.frame.previousAttemptId ===
        preferredPreviousAttempt.attempt.frame.attemptId
    ) {
      anchoredPreviousAttempt = preferredPreviousAttempt;
      break;
    }
    if (decoded.previousAttemptStorageId === null) break;
    const previous = yield* loadAttemptStartRootByStorageId(
      transaction,
      decoded.previousAttemptStorageId,
      operation,
    );
    if (Option.isNone(previous)) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    requiredAttemptId = decoded.frame.previousAttemptId;
    if (requiredAttemptId === null) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    row = previous.value;
  }

  let previousAttempt = anchoredPreviousAttempt;
  let rootPreviousAttempt: RestoredFrameworkMigrationAttemptStart | null = null;
  let restoredRoot: RestoredFrameworkMigrationAttemptStart | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const lineageRow = rows[index];
    const decoded = decodedRows[index];
    if (lineageRow === undefined || decoded === undefined) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const cachedAdmission = admissionsByStorageId.get(
      decoded.admissionStorageId,
    );
    let admission: RestoredFrameworkMigrationPlanAdmission;
    if (cachedAdmission === undefined) {
      admission = yield*
        restoreStoredFrameworkMigrationPlanAdmissionReferenceInTransactionEffect(
          transaction,
          preferredCollision,
          decoded.admissionStorageId,
          decoded.frame.admissionSha256,
          operation,
        ).pipe(Effect.mapError(error =>
          mapStoredRepositoryError(operation, error)
        ));
      admissionsByStorageId.set(decoded.admissionStorageId, Object.freeze({
        admissionSha256: decoded.frame.admissionSha256,
        planStorageId: decoded.planStorageId,
        value: admission,
      }));
    } else {
      if (
        cachedAdmission.admissionSha256 !== decoded.frame.admissionSha256 ||
        cachedAdmission.planStorageId !== decoded.planStorageId ||
        cachedAdmission.value.storageId !== decoded.admissionStorageId ||
        cachedAdmission.value.admission.sha256 !==
          decoded.frame.admissionSha256 ||
        cachedAdmission.value.plan.storageId !== decoded.planStorageId
      ) {
        return yield* Effect.fail(
          FrameworkMigrationRepositoryError.storedCorruption(operation),
        );
      }
      admission = cachedAdmission.value;
    }
    if (
      admission.collision !== preferredCollision ||
      admission.plan.storageId !== decoded.planStorageId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    const restored: RestoredFrameworkMigrationAttemptStart = yield*
      restoreStoredFrameworkMigrationAttemptStart({
      row: lineageRow,
      collision: preferredCollision,
      plan: admission.plan,
      admission,
      previousAttempt,
    }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
    if (index === 0) {
      rootPreviousAttempt = previousAttempt;
      restoredRoot = restored;
    }
    previousAttempt = restored;
  }
  if (restoredRoot === undefined) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  return Object.freeze({
    value: restoredRoot,
    previousAttempt: rootPreviousAttempt,
  });
});

const decodeAttemptStartRoot = Effect.fn(
  "FrameworkMigrationAttemptStartRepository.decodeRoot",
)(function* (
  row: FrameworkMigrationAttemptStartDriverRow,
  operation: AttemptStartAggregateRepositoryOperation,
): Effect.fn.Return<
  DecodedFrameworkMigrationAttemptStartRoot,
  FrameworkMigrationRepositoryError
> {
  const storageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.attemptStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const collisionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.collisionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const planStorageId = yield* Effect.fromResult(decodeStoredStorageIdResult(
    row.planStorageId,
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const admissionStorageId = yield* Effect.fromResult(
    decodeStoredStorageIdResult(
      row.admissionStorageId,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const stored = yield* Effect.fromResult(decodeStoredCanonicalMetadataResult(
    row,
    row.attemptStartSha256,
    {
      format: FRAMEWORK_MIGRATION_ATTEMPT_START_FORMAT,
      version: FRAMEWORK_MIGRATION_ATTEMPT_START_VERSION,
      maximumCanonicalBytes: MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
    },
    () => FrameworkMigrationRepositoryError.storedCorruption(operation),
  ));
  const frame = yield* verifyStoredFrameworkMigrationValue({
    kind: "attemptStart",
    canonicalBytes: stored.canonicalBytes,
    sha256Hex: stored.sha256Hex,
  }).pipe(Effect.mapError(error => mapStoredValueError(operation, error)));
  if (!isStoredFrameworkMigrationAttemptStartFrame(frame)) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }
  const migrationPlanSha256 = yield* Effect.fromResult(
    decodeStoredSha256HexResult(
      row.migrationPlanSha256,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const admissionSha256 = yield* Effect.fromResult(
    decodeStoredSha256HexResult(
      row.admissionSha256,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  const attemptFence = yield* Effect.fromResult(
    decodeStoredNonNegativeInt64TextResult(
      row.attemptFence,
      () => FrameworkMigrationRepositoryError.storedCorruption(operation),
    ),
  );
  if (
    migrationPlanSha256 !== frame.planSha256 ||
    admissionSha256 !== frame.admissionSha256 ||
    row.attemptId !== frame.attemptId ||
    attemptFence !== frame.attemptFence ||
    row.leaseOwnerId !== frame.leaseOwnerId ||
    operationalLeaseExpiryDate(frame.leaseExpiresAt) === undefined
  ) {
    return yield* Effect.fail(
      FrameworkMigrationRepositoryError.storedCorruption(operation),
    );
  }

  let previousAttemptStorageId: bigint | null = null;
  if (frame.previousAttemptId === null) {
    if (
      row.previousAttemptStorageId !== null || row.previousAttemptId !== null
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  } else {
    if (
      row.previousAttemptStorageId === null ||
      row.previousAttemptId !== frame.previousAttemptId
    ) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
    previousAttemptStorageId = yield* Effect.fromResult(
      decodeStoredStorageIdResult(
        row.previousAttemptStorageId,
        () => FrameworkMigrationRepositoryError.storedCorruption(operation),
      ),
    );
    if (previousAttemptStorageId === storageId) {
      return yield* Effect.fail(
        FrameworkMigrationRepositoryError.storedCorruption(operation),
      );
    }
  }
  return Object.freeze({
    storageId,
    collisionStorageId,
    planStorageId,
    admissionStorageId,
    previousAttemptStorageId,
    frame,
  });
});

function runRepositoryStatement<Value>(
  operation: AttemptStartAggregateRepositoryOperation,
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

function mapStoredValueError(
  operation: AttemptStartAggregateRepositoryOperation,
  error: FrameworkMigrationValueError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? FrameworkMigrationRepositoryError.resourceFailure(
      operation,
      error.cause,
    )
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function mapStoredRepositoryError(
  operation: AttemptStartAggregateRepositoryOperation,
  error: FrameworkMigrationRepositoryError,
): FrameworkMigrationRepositoryError {
  return error.reason === "resourceFailure"
    ? error
    : FrameworkMigrationRepositoryError.storedCorruption(operation);
}

function attemptStartExactlyMatches(
  occupant: RestoredFrameworkMigrationAttemptStartOccupant,
  admission: RestoredFrameworkMigrationPlanAdmission,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
  expected: FrameworkMigrationAttemptStart,
): boolean {
  return restoredAdmissionExactlyMatches(occupant.value.admission, admission) &&
    restoredPreviousAttemptExactlyMatches(
      occupant.previousAttempt,
      previousAttempt,
    ) &&
    occupant.value.attempt.sha256 === expected.sha256 &&
    occupant.value.attempt.canonicalJson === expected.canonicalJson;
}

function restoredAttemptStartExactlyMatches(
  left: RestoredFrameworkMigrationAttemptStart,
  right: RestoredFrameworkMigrationAttemptStart,
): boolean {
  return left.storageId === right.storageId &&
    restoredAdmissionExactlyMatches(left.admission, right.admission) &&
    left.attempt.sha256 === right.attempt.sha256 &&
    left.attempt.canonicalJson === right.attempt.canonicalJson;
}

function restoredAdmissionExactlyMatches(
  left: RestoredFrameworkMigrationPlanAdmission,
  right: RestoredFrameworkMigrationPlanAdmission,
): boolean {
  return left.storageId === right.storageId &&
    left.collision.storageId === right.collision.storageId &&
    left.plan.storageId === right.plan.storageId &&
    left.plan.plan.migrationPlanSha256 === right.plan.plan.migrationPlanSha256 &&
    left.plan.plan.canonicalJson === right.plan.plan.canonicalJson &&
    left.admission.sha256 === right.admission.sha256 &&
    left.admission.canonicalJson === right.admission.canonicalJson;
}

function restoredPreviousAttemptExactlyMatches(
  left: RestoredFrameworkMigrationAttemptStart | null,
  right: RestoredFrameworkMigrationAttemptStart | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && restoredAttemptStartExactlyMatches(left, right);
}

function attemptFrameMatchesAdmission(
  frame: FrameworkMigrationAttemptStartFrame,
  admission: RestoredFrameworkMigrationPlanAdmission,
): boolean {
  return frame.planSha256 === admission.plan.plan.migrationPlanSha256 &&
    frame.admissionSha256 === admission.admission.sha256 &&
    sameCollisionCoordinate(frame.collision, admission.collision.coordinate);
}

function sameCollisionCoordinate(
  left: FrameworkMigrationAttemptStartFrame["collision"],
  right: FrameworkMigrationAttemptStartFrame["collision"],
): boolean {
  return sameTargetNamespace(left.targetNamespace, right.targetNamespace) &&
    left.owner === right.owner &&
    left.lineageId === right.lineageId &&
    left.physicalNamespaceProfile === right.physicalNamespaceProfile;
}

function sameTargetNamespace(
  left: FrameworkMigrationAttemptStartFrame["collision"]["targetNamespace"],
  right: FrameworkMigrationAttemptStartFrame["collision"]["targetNamespace"],
): boolean {
  return left.format === right.format && left.version === right.version &&
    left.deploymentId === right.deploymentId &&
    left.physicalDatabaseIdentity === right.physicalDatabaseIdentity &&
    left.schemaName === right.schemaName;
}

function operationalLeaseExpiryDate(
  value: CanonicalIsoInstant,
): Date | undefined {
  if (!FOUR_DIGIT_UTC_MILLISECOND_INSTANT.test(value)) return undefined;
  const date = new Date(epochMillisecondsFromCanonicalIsoInstant(value));
  return date.toISOString() === value ? date : undefined;
}

const attemptStartCanonicalBytesWithinReadBounds = sql`
  octet_length(${fxSystemFrameworkMigrationAttemptStarts.canonicalBytes})
    <= ${MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES}
`;

const attemptStartReadSelection = {
  attemptStorageId:
    fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
  collisionStorageId:
    fxSystemFrameworkMigrationAttemptStarts.collisionStorageId,
  planStorageId: fxSystemFrameworkMigrationAttemptStarts.planStorageId,
  migrationPlanSha256:
    fxSystemFrameworkMigrationAttemptStarts.migrationPlanSha256,
  admissionStorageId:
    fxSystemFrameworkMigrationAttemptStarts.admissionStorageId,
  admissionSha256: fxSystemFrameworkMigrationAttemptStarts.admissionSha256,
  attemptId: fxSystemFrameworkMigrationAttemptStarts.attemptId,
  attemptFence: fxSystemFrameworkMigrationAttemptStarts.attemptFence,
  leaseOwnerId: fxSystemFrameworkMigrationAttemptStarts.leaseOwnerId,
  leaseExpiresAt: fxSystemFrameworkMigrationAttemptStarts.leaseExpiresAt,
  previousAttemptStorageId:
    fxSystemFrameworkMigrationAttemptStarts.previousAttemptStorageId,
  previousAttemptId:
    fxSystemFrameworkMigrationAttemptStarts.previousAttemptId,
  attemptStartSha256:
    fxSystemFrameworkMigrationAttemptStarts.attemptStartSha256,
  frameFormat: fxSystemFrameworkMigrationAttemptStarts.frameFormat,
  frameVersion: fxSystemFrameworkMigrationAttemptStarts.frameVersion,
  canonicalByteLength:
    fxSystemFrameworkMigrationAttemptStarts.canonicalByteLength,
  observedCanonicalByteLength: sql<number>`
    octet_length(${fxSystemFrameworkMigrationAttemptStarts.canonicalBytes})
  `,
  canonicalBytes: sql<Uint8Array | null>`
    case when ${attemptStartCanonicalBytesWithinReadBounds}
      then ${fxSystemFrameworkMigrationAttemptStarts.canonicalBytes}
      else null
    end
  `,
} as const satisfies Record<
  keyof StoredFrameworkMigrationAttemptStartRow,
  unknown
>;
