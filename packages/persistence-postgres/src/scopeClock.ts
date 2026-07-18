import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type OutboxSeq,
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
import { fxSystemScopeClocks } from "./schema";

export interface ScopeClockRecord {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
  readonly lastOutboxSeq: OutboxSeq;
  readonly epoch: ScopeEpoch;
  readonly updatedAt: Date;
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
  ) {
    super(`Scope clock ${scopeId} is invalid: ${reason}`);
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
    readonly operation: "readForShare" | "lockForUpdate" | "update";
    readonly cause: unknown;
  }> {}

export type AdvanceScopeAuthorizationRevocationEpochError =
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | ScopeAuthorizationRevocationEpochExhaustedError
  | ScopeAuthorizationRevocationEpochPersistenceError;

export async function getScopeClock(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<ScopeClockRecord | null> {
  const rows = await db
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const clock = rows[0];
  return clock === undefined ? null : decodeScopeClockRecord(clock);
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
      const query = selectScopeAuthorizationRevocationEpochForShare(
        db,
        scopeId,
      );
      const rows = yield* runScopeAuthorizationRevocationEpochQueryEffect(
        "readForShare",
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

function selectScopeAuthorizationRevocationEpochForShare(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
) {
  return db
    .select({
      scopeId: fxSystemScopeClocks.scopeId,
      authorizationRevocationEpoch:
        fxSystemScopeClocks.authorizationRevocationEpoch,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("share");
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
        .update(fxSystemScopeClocks)
        .set({
          authorizationRevocationEpoch: expectedCurrent,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(fxSystemScopeClocks.scopeId, scopeId))
        .returning({
          authorizationRevocationEpoch:
            fxSystemScopeClocks.authorizationRevocationEpoch,
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
export async function lockScopeClockForUpdateInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<ScopeClockRecord> {
  return decodeScopeClockRecord(
    await lockScopeClockRowForUpdateInTransaction(db, scopeId),
  );
}

async function lockScopeClockRowForUpdateInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<ScopeClockRow> {
  const rows = await selectScopeClockRowForUpdate(db, scopeId);
  const clock = rows[0];
  if (clock === undefined) {
    throw new ScopeClockNotFoundError(scopeId);
  }
  return clock;
}

const lockScopeClockRowForUpdateInTransactionEffect = Effect.fn(
  "ScopeClock.lockRowForUpdateInTransaction",
)(function* (
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Effect.fn.Return<
  ScopeClockRow,
  | ScopeClockNotFoundError
  | ScopeAuthorizationRevocationEpochPersistenceError
> {
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
  return db
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("update");
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

export type ScopeClockRow = typeof fxSystemScopeClocks.$inferSelect;

type ScopeClockRecordRow = Pick<
  ScopeClockRow,
  | "scopeId"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "lastOutboxSeq"
  | "epoch"
  | "updatedAt"
>;

export function decodeScopeClockRecord(
  row: ScopeClockRecordRow,
): ScopeClockRecord {
  if (!isNonBlankString(row.scopeId)) {
    throw new ScopeClockCorruptionError(row.scopeId, "scope ID is empty");
  }
  if (!isNonBlankString(row.epoch)) {
    throw new ScopeClockCorruptionError(row.scopeId, "epoch is empty");
  }
  if (row.storageGenerationFence < 1n) {
    throw new ScopeClockCorruptionError(
      row.scopeId,
      "storage generation fence is not positive",
    );
  }
  if (row.lastCommitSeq < 0n) {
    throw new ScopeClockCorruptionError(
      row.scopeId,
      "last commit sequence is negative",
    );
  }
  if (row.lastOutboxSeq < 0n) {
    throw new ScopeClockCorruptionError(
      row.scopeId,
      "last outbox sequence is negative",
    );
  }
  const updatedAt = copyFiniteDate(row.updatedAt);
  if (updatedAt === undefined) {
    throw new ScopeClockCorruptionError(
      row.scopeId,
      "updated timestamp is invalid",
    );
  }

  return {
    scopeId: ScopeIdSchema.make(row.scopeId),
    storageGeneration: decodeStorageGeneration(
      row.storageGeneration,
      row.scopeId,
    ),
    storageGenerationFence: StorageGenerationFenceSchema.make(
      row.storageGenerationFence,
    ),
    lastCommitSeq: CommitSeqSchema.make(row.lastCommitSeq),
    lastOutboxSeq: OutboxSeqSchema.make(row.lastOutboxSeq),
    epoch: ScopeEpochSchema.make(row.epoch),
    updatedAt,
  } satisfies ScopeClockRecord;
}

function decodeScopeAuthorizationRevocationEpochResult(
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

function decodeStorageGeneration(
  value: StorageGeneration,
  scopeId: string,
): StorageGeneration {
  switch (value) {
    case "legacy_v1":
      return LegacyV1StorageGenerationSchema.make(value);
    case "flarexdb_v1":
      return FlarexDbV1StorageGenerationSchema.make(value);
    default:
      throw new ScopeClockCorruptionError(
        scopeId,
        "storage generation is unsupported",
      );
  }
}
