import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CommitSeqSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  StorageGenerationSchema,
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

const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeOutboxSeqResult = Schema.decodeUnknownResult(
  Schema.toType(OutboxSeqSchema),
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
  readonly oldestAvailableCommitSeq: CommitSeq;
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
    readonly operation: "readForShare" | "lockForUpdate" | "update";
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
    .select()
    .from(fxSystemScopeClocks)
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
  const query = db
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("share");
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
  return yield* Effect.fromResult(decodeScopeClockRecordResult(row));
});

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

interface ScopeClockRecordRow {
  readonly scopeId: unknown;
  readonly storageGeneration: unknown;
  readonly storageGenerationFence: unknown;
  readonly lastCommitSeq: unknown;
  readonly oldestAvailableCommitSeq: unknown;
  readonly lastOutboxSeq: unknown;
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

    const rawLastOutboxSeq = row.lastOutboxSeq;
    if (typeof rawLastOutboxSeq !== "bigint") {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "last outbox sequence is invalid",
      ));
    }
    if (rawLastOutboxSeq < 0n) {
      return yield* Result.fail(new ScopeClockCorruptionError(
        diagnosticScopeId,
        "last outbox sequence is negative",
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
    const lastOutboxSeq = yield* decodeScopeClockFieldResult(
      decodeOutboxSeqResult(rawLastOutboxSeq),
      diagnosticScopeId,
      "last outbox sequence is outside the signed-bigint range",
    );
    const epoch = yield* decodeScopeClockFieldResult(
      decodeScopeEpochResult(rawEpoch),
      diagnosticScopeId,
      "epoch is invalid",
    );

    return {
      scopeId,
      storageGeneration,
      storageGenerationFence,
      lastCommitSeq,
      oldestAvailableCommitSeq,
      lastOutboxSeq,
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
