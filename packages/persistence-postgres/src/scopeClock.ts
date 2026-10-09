import { observeDrizzleQuery } from "./drizzleQueryObservation";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CommitSeqSchema,
  ScopeUuidV1Schema, ScopeEpochUuidV1Schema, SnapshotTokenSchema,
  projectScopeIdUuidV1Result, projectScopeEpochUuidV1Result,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  StorageGenerationSchema,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  TransactionAuthorizationRevocationEpochSchema,
  type TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "./schema";

import { MetadataSequenceSchema, type MetadataSequence } from "flarex-protocol/commit-protocol";
import type { TransactionAttemptFence, TransactionSessionIdV1 } from "flarex-protocol/transaction-session";

const decodeMetadataSequenceResult = Schema.decodeUnknownResult(Schema.toType(MetadataSequenceSchema));

const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeStorageGenerationFenceResult = Schema.decodeUnknownResult(
  Schema.toType(StorageGenerationFenceSchema),
);
const decodeStorageGenerationResult = Schema.decodeUnknownResult(
  Schema.toType(StorageGenerationSchema),
);

export interface ScopeClockRecord {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
  readonly lastMetadataSequence: MetadataSequence;
  readonly oldestAvailableCommitSeq: CommitSeq;
  readonly epoch: ScopeEpoch;
  readonly updatedAt: Date;
}

/** Flat compatibility projection of the two actual owners; no duplicated writable fields. */
export const scopeClockSelection = () => ({ ...getTableColumns(fxSystemScopeClocks),
  updatedAt: sql`greatest(${fxSystemScopeClocks.updatedAt}, ${fxSystemScopeExecutionAuthorities.updatedAt})`.mapWith(fxSystemScopeClocks.updatedAt),
  storageGeneration: fxSystemScopeExecutionAuthorities.storageGeneration,
  storageGenerationFence: fxSystemScopeExecutionAuthorities.storageGenerationFence,
  oldestAvailableCommitSeq: fxSystemScopeExecutionAuthorities.oldestAvailableCommitSeq,
  epoch: fxSystemScopeExecutionAuthorities.epoch,
  epochUuid: fxSystemScopeExecutionAuthorities.epochUuid,
  authorizationRevocationEpoch: fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch,
});
export const selectScopeClockRows = (db: FlarexMetadataDatabase) => db.select(scopeClockSelection())
  .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities,
    eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId));

export const ScopeExecutionAuthoritySchema = Schema.Struct({
  scopeId: ScopeIdSchema, scopeUuid: Schema.NullOr(ScopeUuidV1Schema), epoch: ScopeEpochSchema, epochUuid: Schema.NullOr(ScopeEpochUuidV1Schema),
  storageGeneration: StorageGenerationSchema, storageGenerationFence: StorageGenerationFenceSchema,
  oldestAvailableCommitSeq: CommitSeqSchema, authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema,
});
export type ScopeExecutionAuthorityRecord = typeof ScopeExecutionAuthoritySchema.Type;
const decodeAuthority = Schema.decodeUnknownResult(Schema.toType(ScopeExecutionAuthoritySchema));
const finiteAuthorityBrand: unique symbol = Symbol("FiniteExecutionAuthorityObservation");
export interface FiniteExecutionAuthorityObservation extends Omit<ScopeExecutionAuthorityRecord, "scopeUuid" | "epochUuid"> {
  readonly scopeUuid: typeof ScopeUuidV1Schema.Type;
  readonly epochUuid: typeof ScopeEpochUuidV1Schema.Type;
  readonly [finiteAuthorityBrand]: true;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotToken: typeof SnapshotTokenSchema.Type;
}
const finiteAuthorities = new WeakMap<FlarexMetadataTransaction, Readonly<{
  observation: FiniteExecutionAuthorityObservation;
}>>();
/** Kernel-only issuance after exact session, lease, root, claim and post-wait time acceptance. */
export function openFiniteExecutionAuthorityObservation(tx: FlarexMetadataTransaction,
  authority: ScopeExecutionAuthorityRecord, attempt: Pick<FiniteExecutionAuthorityObservation, "sessionId" | "attemptFence" | "snapshotToken">,
): FiniteExecutionAuthorityObservation {
  if (finiteAuthorities.has(tx)) throw new Error("Finite execution authority already open");
  const scopeProjection = projectScopeIdUuidV1Result(authority.scopeId);
  const epochProjection = projectScopeEpochUuidV1Result(authority.epoch);
  if (Result.isFailure(scopeProjection) || Result.isFailure(epochProjection) ||
    authority.scopeUuid !== scopeProjection.success.scopeUuid || authority.epochUuid !== epochProjection.success.epochUuid)
    throw new ScopeClockCorruptionError(authority.scopeId, "finite execution authority native identity is invalid");
  if (authority.scopeUuid === null || authority.epochUuid === null) throw new ScopeClockCorruptionError(authority.scopeId, "finite execution authority has no native identity");
  const observation: FiniteExecutionAuthorityObservation = Object.freeze({ ...authority, ...attempt, scopeUuid: authority.scopeUuid, epochUuid: authority.epochUuid,
    snapshotToken: Object.freeze({ ...attempt.snapshotToken }), [finiteAuthorityBrand]: true as const });
  finiteAuthorities.set(tx, Object.freeze({ observation }));
  return observation;
}
export function readFiniteExecutionAuthorityObservation(tx: FlarexMetadataTransaction, scopeId: ScopeId):
  FiniteExecutionAuthorityObservation | undefined {
  const observation = finiteAuthorities.get(tx)?.observation;
  return observation?.scopeId === scopeId ? observation : undefined;
}
export function requireFiniteExecutionAuthorityObservation(tx: FlarexMetadataTransaction,
  observation: FiniteExecutionAuthorityObservation,
): Result.Result<FiniteExecutionAuthorityObservation, ScopeClockCorruptionError> {
  return finiteAuthorities.get(tx)?.observation === observation ? Result.succeed(observation)
    : Result.fail(new ScopeClockCorruptionError(observation.scopeId, "finite execution authority is foreign or closed"));
}
export function closeFiniteExecutionAuthorityObservation(tx: FlarexMetadataTransaction): void { finiteAuthorities.delete(tx); }

/** Lifecycle writer/reader gate. The immutable identity root is read, not locked, for finite reads. */
export const lockScopeExecutionAuthorityInTransactionEffect = Effect.fn("ScopeClock.lockExecutionAuthority")(
  function* (db: FlarexMetadataTransaction, scopeId: ScopeId, mode: "share" | "update" | "key share" = "share") {
    const operation = mode === "update" ? "lockForUpdate" : mode === "key share" ? "lockForSnapshotRead" : "readForShare";
    const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect(operation, db.select({
      ...getTableColumns(fxSystemScopeExecutionAuthorities), scopeUuid: fxSystemScopeClocks.scopeUuid,
    }).from(fxSystemScopeExecutionAuthorities).innerJoin(fxSystemScopeClocks,
      eq(fxSystemScopeClocks.scopeId, fxSystemScopeExecutionAuthorities.scopeId))
      .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId)).limit(1).for(mode, { of: fxSystemScopeExecutionAuthorities }));
    const row = rows[0];
    if (row === undefined) return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
    return yield* Effect.fromResult(decodeAuthority(row).pipe(Result.mapError(cause =>
      new ScopeClockCorruptionError(scopeId, "execution authority is invalid", { cause }))));
  });

/** Issued by the exact-running kernel or native writer clock owner after live
 * row checks, while its stronger lock is held. It never crosses transactions. */
const exactAttemptClockObservations = new WeakMap<FlarexMetadataTransaction, Readonly<{
  clock: ScopeClockRecord;
  revocation: TransactionAuthorizationRevocationEpoch;
  lock: "snapshot" | "share" | "attempt";
  lifetime: symbol;
}>>();

export function openExactAttemptScopeClockObservation(
  tx: FlarexMetadataTransaction, clock: ScopeClockRecord,
  revocation: TransactionAuthorizationRevocationEpoch, lock: "snapshot" | "share" | "attempt",
): void {
  if (exactAttemptClockObservations.has(tx)) throw new Error("Exact attempt clock scope already opened");
  exactAttemptClockObservations.set(tx, Object.freeze({ clock: copyScopeClockObservation(clock), revocation, lock, lifetime: Symbol("ExactScopeClockLifetime") }));
}

const copyScopeClockObservation = (clock: ScopeClockRecord): ScopeClockRecord =>
  Object.freeze({ ...clock, updatedAt: new Date(clock.updatedAt.getTime()) });

/** Writer owners can reuse only this owner-issued, still-open strong lock observation. */
export function readExactScopeWriteClockObservation(tx: FlarexMetadataTransaction, scopeId: ScopeId): ScopeClockRecord | undefined {
  const observed = exactAttemptClockObservations.get(tx);
  return observed?.clock.scopeId === scopeId && observed.lock === "attempt" ? copyScopeClockObservation(observed.clock) : undefined;
}

/** Process-local identity of the currently open writer observation. Closing or
 * reopening the clock makes previously prepared writer evidence unusable. */
export function exactScopeWriteClockObservationIdentity(tx: FlarexMetadataTransaction, scopeId: ScopeId): symbol | undefined {
  const observed = exactAttemptClockObservations.get(tx);
  return observed?.clock.scopeId === scopeId && observed.lock === "attempt" ? observed.lifetime : undefined;
}

/** SQL-row capture for publication's existing clock owner. The same protected
 * row issues the exact transaction observation; detached caller clocks cannot. */
export const lockScopeClockRowsForOrdinaryWriteInTransactionEffect = Effect.fn("ScopeClock.captureOrdinaryWriteRows")(
  function* (db: ScopeClockTransaction, scopeId: ScopeId,
    observer?: Parameters<typeof observeDrizzleQuery<"lockScopeClock">>[2],
  ) {
    closeExactAttemptScopeClockObservation(db);
    yield* lockScopeExecutionAuthorityInTransactionEffect(db, scopeId, "share");
    const query = selectScopeClockRows(db).where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(2).for("no key update", { of: fxSystemScopeClocks });
    observeDrizzleQuery("lockScopeClock", query, observer);
    const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect("lockForOrdinaryWrite", query);
    if (rows.length === 1) {
      const row = rows[0];
      if (row === undefined) return yield* Effect.die(new Error("Scope clock capture lost its row"));
      const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row));
      const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(clock.scopeId)).pipe(Effect.mapError(cause => new ScopeClockCorruptionError(scopeId, "scope identity does not project", { cause })));
      const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch)).pipe(Effect.mapError(cause => new ScopeClockCorruptionError(scopeId, "epoch identity does not project", { cause })));
      if (row.scopeUuid !== scope.scopeUuid || row.epochUuid !== epoch.epochUuid)
        return yield* Effect.fail(new ScopeClockCorruptionError(scopeId, "clock row identities disagree"));
      const revocation = yield* Effect.fromResult(decodeScopeAuthorizationRevocationEpochResult(scopeId, row.authorizationRevocationEpoch));
      closeExactAttemptScopeClockObservation(db);
      openExactAttemptScopeClockObservation(db, clock, revocation, "attempt");
    }
    return rows;
  });

export function closeExactAttemptScopeClockObservation(tx: FlarexMetadataTransaction): void {
  exactAttemptClockObservations.delete(tx);
}

export class ScopeClockNotFoundError extends Error {
  readonly _tag = "ScopeClockNotFoundError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Scope clock does not exist: ${scopeId}`);
    this.name = "ScopeClockNotFoundError";
  }
}

export class ScopeClockCorruptionError extends Error {
  readonly _tag = "ScopeClockCorruptionError" as const;

  constructor(
    readonly scopeId: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`Scope clock ${scopeId} is invalid: ${reason}`, options);
    this.name = "ScopeClockCorruptionError";
  }
}

export class ScopeAuthorizationRevocationEpochExhaustedError extends Error {
  readonly _tag =
    "ScopeAuthorizationRevocationEpochExhaustedError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Authorization revocation epoch is exhausted for scope: ${scopeId}`);
    this.name = "ScopeAuthorizationRevocationEpochExhaustedError";
  }
}

export interface AdvanceScopeAuthorizationRevocationEpochResult {
  readonly previous: TransactionAuthorizationRevocationEpoch;
  readonly current: TransactionAuthorizationRevocationEpoch;
}

export type ScopeAuthorizationRevocationEpochReadError =
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | ScopeAuthorizationRevocationEpochPersistenceError;

export class ScopeAuthorizationRevocationEpochPersistenceError
  extends Data.TaggedError(
    "ScopeAuthorizationRevocationEpochPersistenceError",
  )<{
    readonly operation: "readForShare" | "readForKeyShare" | "lockForUpdate" | "lockForSnapshotRead" | "lockForOrdinaryWrite" | "update";
    readonly cause: unknown;
  }> {}

export type AdvanceScopeAuthorizationRevocationEpochError =
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | ScopeAuthorizationRevocationEpochExhaustedError
  | ScopeAuthorizationRevocationEpochPersistenceError;

/**
 * Promise compatibility projection for the public persistence facade and
 * transaction owners not yet consuming the package-local Result authority.
 * Delete it when those callers consume Result or Effect directly.
 */
export async function getScopeClock(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<ScopeClockRecord | null> {
  return Result.getOrThrow(await getScopeClockResult(db, scopeId));
}

export async function getScopeClockResult(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<Result.Result<ScopeClockRecord | null, ScopeClockCorruptionError>> {
  const rows = await db
    .select(scopeClockSelection())
    .from(fxSystemScopeClocks)
    .leftJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const clock = rows[0];
  return clock === undefined
    ? Result.succeed(null)
    : decodeScopeClockRecordResult(clock);
}

/**
 * Private S07-A authority read. This module is not a package export; O03-A
 * owns the future trusted command and consumer-facing capability.
 */
export const requireScopeAuthorizationRevocationEpochInTransactionEffect =
  Effect.fn("ScopeClock.requireAuthorizationRevocationEpochInTransaction")(
    function* (
      db: ScopeClockTransaction,
      scopeId: ScopeId,
    ): Effect.fn.Return<
      TransactionAuthorizationRevocationEpoch,
      ScopeAuthorizationRevocationEpochReadError
    > {
      const finite = readFiniteExecutionAuthorityObservation(db, scopeId);
      if (finite !== undefined) return finite.authorizationRevocationEpoch;
      const observed = exactAttemptClockObservations.get(db);
      if (observed?.clock.scopeId === scopeId) return observed.revocation;
      const query = selectScopeAuthorizationRevocationEpochForKeyShare(
        db,
        scopeId,
      );
      const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect(
        "readForKeyShare",
        query,
      );
      const row = rows[0];
      if (row === undefined) {
        return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
      }
      return yield* Effect.fromResult(
        decodeScopeAuthorizationRevocationEpochResult(
          row.scopeId,
          row.authorizationRevocationEpoch,
        ),
      );
    },
  );

// Revocation always obtains FOR UPDATE before changing its non-key epoch.
// Protect that transition without excluding ordinary sequence publication.
function selectScopeAuthorizationRevocationEpochForKeyShare(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
) {
  return db
    .select({
      scopeId: fxSystemScopeExecutionAuthorities.scopeId,
      authorizationRevocationEpoch:
        fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch,
    })
    .from(fxSystemScopeExecutionAuthorities)
    .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId))
    .limit(1)
    .for("key share");
}

/**
 * Advances the current scope authority by exactly one under the caller's
 * short transaction. Callers cannot select or replace the persisted value.
 */
export const advanceScopeAuthorizationRevocationEpochInTransactionEffect =
  Effect.fn("ScopeClock.advanceAuthorizationRevocationEpochInTransaction")(
    function* (
      db: ScopeClockTransaction,
      scopeId: ScopeId,
    ): Effect.fn.Return<
      AdvanceScopeAuthorizationRevocationEpochResult,
      AdvanceScopeAuthorizationRevocationEpochError
    > {
      closeExactAttemptScopeClockObservation(db);
      const row = yield* lockScopeClockRowForUpdateInTransactionEffect(
        db,
        scopeId,
      );
      const previous = yield* Effect.fromResult(
        decodeScopeAuthorizationRevocationEpochResult(
          row.scopeId,
          row.authorizationRevocationEpoch,
        ),
      );
      if (previous === MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH) {
        return yield* Effect.fail(
          new ScopeAuthorizationRevocationEpochExhaustedError(scopeId),
        );
      }
      const expectedCurrent =
        TransactionAuthorizationRevocationEpochSchema.make(previous + 1n);
      const updateQuery = db
        .update(fxSystemScopeExecutionAuthorities)
        .set({
          authorizationRevocationEpoch: expectedCurrent,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId))
        .returning({
          authorizationRevocationEpoch:
            fxSystemScopeExecutionAuthorities.authorizationRevocationEpoch,
        });
      const updatedRows =
        yield* runScopeAuthorizationRevocationEpochQueryEffect(
          "update",
          updateQuery,
        );
      const updated = updatedRows[0];
      if (updated === undefined) {
        return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
      }
      const current = yield* Effect.fromResult(
        decodeScopeAuthorizationRevocationEpochResult(
          scopeId,
          updated.authorizationRevocationEpoch,
        ),
      );
      if (current !== expectedCurrent) {
        return yield* Effect.fail(
          new ScopeClockCorruptionError(
            scopeId,
            "authorization revocation epoch increment returned an unexpected value",
          ),
        );
      }
      return { previous, current };
    },
  );

/**
 * Scope-clock lock primitive. Callers must already be inside a short trusted
 * database transaction. This module is intentionally not exported from the
 * package root, and this helper does not mutate any clock authority.
 */
export type LockScopeClockForUpdateError =
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | ScopeAuthorizationRevocationEpochPersistenceError;

export type LockScopeClockForShareError = LockScopeClockForUpdateError;

export const lockScopeClockForShareInTransactionEffect = Effect.fn(
  "ScopeClock.lockForShareInTransaction",
)(function* (
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Effect.fn.Return<
  ScopeClockRecord,
  LockScopeClockForShareError
> {
  const observed = exactAttemptClockObservations.get(db);
  if (observed?.clock.scopeId === scopeId && observed.lock === "share") return copyScopeClockObservation(observed.clock);
  yield* lockScopeExecutionAuthorityInTransactionEffect(db, scopeId, "share");
  const query = selectScopeClockRows(db).where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1).for("share", { of: fxSystemScopeClocks });
  const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect(
    "readForShare",
    query,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
  }
  return yield* Effect.fromResult(decodeScopeClockRecordResult(row));
});

/** KEY SHARE lifecycle protection; callers own snapshot isolation, validated
 * command reads, or provisional selection revalidated in the accepting transaction.
 * Strong lifecycle writers retain FOR UPDATE. */
export const lockScopeClockForSnapshotReadInTransactionEffect = Effect.fn(
  "ScopeClock.lockForSnapshotRead",
)((db: ScopeClockTransaction, scopeId: ScopeId) => lockScopeClockForDataAccess(db, scopeId, "snapshotRead"));

/** Attempt/data writes and sequence publication; scope transitions require the strong helper. */
export const lockScopeClockForOrdinaryWriteInTransactionEffect = Effect.fn(
  "ScopeClock.lockForOrdinaryWrite",
)((db: ScopeClockTransaction, scopeId: ScopeId) => lockScopeClockForDataAccess(db, scopeId, "ordinaryWrite"));

const lockScopeClockForDataAccess = Effect.fn("ScopeClock.lockForDataAccess")(function* (
  db: ScopeClockTransaction, scopeId: ScopeId, access: "snapshotRead" | "ordinaryWrite",
) {
  const observed = exactAttemptClockObservations.get(db);
  if (observed?.clock.scopeId === scopeId &&
    (access === "snapshotRead" || observed.lock === "attempt")) return copyScopeClockObservation(observed.clock);
  if (access === "snapshotRead") yield* lockScopeExecutionAuthorityInTransactionEffect(db, scopeId, "key share");
  const rows = access === "ordinaryWrite"
    ? yield* lockScopeClockRowsForOrdinaryWriteInTransactionEffect(db, scopeId)
    : yield* runScopeAuthorizationRevocationEpochQueryEffect("lockForSnapshotRead",
      selectScopeClockRows(db).where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1).for("key share", { of: fxSystemScopeClocks }));
  const row = rows[0];
  if (row === undefined) return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
  return yield* Effect.fromResult(decodeScopeClockRecordResult(row));
});

export const lockScopeClockForUpdateInTransactionEffect = Effect.fn(
  "ScopeClock.lockForUpdateInTransaction",
)(function* (
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Effect.fn.Return<
  ScopeClockRecord,
  LockScopeClockForUpdateError
> {
  const row = yield* lockScopeClockRowForUpdateInTransactionEffect(db, scopeId);
  const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(row));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(clock.scopeId)).pipe(
    Effect.mapError(cause => new ScopeClockCorruptionError(scopeId, "scope identity does not project", { cause })));
  const epoch = yield* Effect.fromResult(projectScopeEpochUuidV1Result(clock.epoch)).pipe(
    Effect.mapError(cause => new ScopeClockCorruptionError(scopeId, "epoch identity does not project", { cause })));
  if (row.scopeUuid !== scope.scopeUuid || row.epochUuid !== epoch.epochUuid)
    return yield* Effect.fail(new ScopeClockCorruptionError(scopeId, "clock row identities disagree"));
  const revocation = yield* Effect.fromResult(decodeScopeAuthorizationRevocationEpochResult(scopeId, row.authorizationRevocationEpoch));
  // Only this public data-clock owner issues writer evidence. The private row
  // lock also serves revocation mutations and must keep prior evidence closed.
  openExactAttemptScopeClockObservation(db, clock, revocation, "attempt");
  return clock;
});

const lockScopeClockRowForUpdateInTransactionEffect = Effect.fn(
  "ScopeClock.lockRowForUpdateInTransaction",
)(function* (
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Effect.fn.Return<
  ScopeClockRow,
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | ScopeAuthorizationRevocationEpochPersistenceError
> {
  closeExactAttemptScopeClockObservation(db);
  yield* lockScopeExecutionAuthorityInTransactionEffect(db, scopeId, "update");
  const query = selectScopeClockRowForUpdate(db, scopeId);
  const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect(
    "lockForUpdate",
    query,
  );
  const clock = rows[0];
  if (clock === undefined) {
    return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
  }
  return clock;
});

function selectScopeClockRowForUpdate(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
) {
  return selectScopeClockRows(db).where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1).for("update", { of: fxSystemScopeClocks });
}

const runScopeAuthorizationRevocationEpochQueryEffect = Effect.fn(<Row>(
  operation: ScopeAuthorizationRevocationEpochPersistenceError["operation"],
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  ScopeAuthorizationRevocationEpochPersistenceError
> => Effect.uninterruptible(Effect.tryPromise({
  try: () => query,
  catch: (cause) => new ScopeAuthorizationRevocationEpochPersistenceError({
    operation,
    cause,
  }),
})));

type ScopeClockTransaction = FlarexMetadataTransaction;

export type ScopeClockRow = typeof fxSystemScopeClocks.$inferSelect & Omit<typeof fxSystemScopeExecutionAuthorities.$inferSelect, "scopeId" | "updatedAt">;

interface ScopeClockRecordRow {
  readonly scopeId: unknown;
  readonly storageGeneration: unknown;
  readonly storageGenerationFence: unknown;
  readonly lastCommitSeq: unknown;
  readonly lastMetadataSequence: unknown;
  readonly oldestAvailableCommitSeq: unknown;
  readonly epoch: unknown;
  readonly updatedAt: unknown;
}

export function decodeScopeClockRecordResult(
  row: ScopeClockRecordRow,
): Result.Result<ScopeClockRecord, ScopeClockCorruptionError> {
  return Result.gen(function* () {
    const rawScopeId = row.scopeId;
    const diagnosticScopeId = typeof rawScopeId === "string"
      ? rawScopeId
      : "<invalid-scope-id>";
    if (typeof rawScopeId !== "string") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "scope ID is invalid",
      ));
    }
    if (!isNonBlankString(rawScopeId)) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "scope ID is empty",
      ));
    }

    const rawEpoch = row.epoch;
    if (typeof rawEpoch !== "string") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "epoch is invalid",
      ));
    }
    if (!isNonBlankString(rawEpoch)) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "epoch is empty",
      ));
    }

    const rawStorageGenerationFence = row.storageGenerationFence;
    if (typeof rawStorageGenerationFence !== "bigint") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "storage generation fence is invalid",
      ));
    }
    if (rawStorageGenerationFence < 1n) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "storage generation fence is not positive",
      ));
    }

    const rawLastCommitSeq = row.lastCommitSeq;
    if (typeof rawLastCommitSeq !== "bigint") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "last commit sequence is invalid",
      ));
    }
    if (rawLastCommitSeq < 0n) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "last commit sequence is negative",
      ));
    }

    const rawOldestAvailableCommitSeq = row.oldestAvailableCommitSeq;
    if (typeof rawOldestAvailableCommitSeq !== "bigint") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "oldest available commit sequence is invalid",
      ));
    }
    if (
      rawOldestAvailableCommitSeq < 0n ||
      rawOldestAvailableCommitSeq > rawLastCommitSeq
    ) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "oldest available commit sequence is outside the retained range",
      ));
    }

    const updatedAt = copyFiniteDate(row.updatedAt);
    if (updatedAt === undefined) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "updated timestamp is invalid",
      ));
    }

    const scopeId = yield* decodeScopeClockFieldResult(
      decodeScopeIdResult(rawScopeId),
      diagnosticScopeId,
      "scope ID is invalid",
    );
    const storageGeneration = yield* decodeScopeClockFieldResult(
      decodeStorageGenerationResult(row.storageGeneration),
      diagnosticScopeId,
      "storage generation is unsupported",
    );
    const storageGenerationFence = yield* decodeScopeClockFieldResult(
      decodeStorageGenerationFenceResult(rawStorageGenerationFence),
      diagnosticScopeId,
      "storage generation fence is outside the signed-bigint range",
    );
    const lastCommitSeq = yield* decodeScopeClockFieldResult(
      decodeCommitSeqResult(rawLastCommitSeq),
      diagnosticScopeId,
      "last commit sequence is outside the signed-bigint range",
    );
    const oldestAvailableCommitSeq = yield* decodeScopeClockFieldResult(
      decodeCommitSeqResult(rawOldestAvailableCommitSeq),
      diagnosticScopeId,
      "oldest available commit sequence is outside the signed-bigint range",
    );
    const epoch = yield* decodeScopeClockFieldResult(
      decodeScopeEpochResult(rawEpoch),
      diagnosticScopeId,
      "epoch is invalid",
    );

    const lastMetadataSequence = yield* decodeScopeClockFieldResult(decodeMetadataSequenceResult(row.lastMetadataSequence), diagnosticScopeId, "metadata sequence is invalid");
    return {
      scopeId,
      storageGeneration,
      storageGenerationFence,
      lastCommitSeq,
      lastMetadataSequence,
      oldestAvailableCommitSeq,
      epoch,
      updatedAt,
    } satisfies ScopeClockRecord;
  });
}

/**
 * Temporary unchecked compatibility projection for Promise transaction and
 * repository consumers. Delete it after those callers consume the Result or
 * an Effect-native scope-clock operation directly.
 */
export function decodeScopeClockRecord(
  row: ScopeClockRecordRow,
): ScopeClockRecord {
  return Result.getOrThrow(decodeScopeClockRecordResult(row));
}

function decodeScopeClockFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  scopeId: string,
  reason: string,
): Result.Result<Value, ScopeClockCorruptionError> {
  return result.pipe(Result.mapError((cause) =>
    new ScopeClockCorruptionError(scopeId, reason, { cause })
  ));
}

export function decodeScopeAuthorizationRevocationEpochResult(
  scopeId: string,
  value: unknown,
): Result.Result<
  TransactionAuthorizationRevocationEpoch,
  ScopeClockCorruptionError
> {
  if (
    typeof value !== "bigint" ||
    value < 0n ||
    value > MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH
  ) {
    return Result.fail(new ScopeClockCorruptionError(
      scopeId,
      "authorization revocation epoch is outside the signed-bigint range",
    ));
  }
  return Result.succeed(
    TransactionAuthorizationRevocationEpochSchema.make(value),
  );
}
