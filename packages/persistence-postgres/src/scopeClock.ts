import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq, sql } from "drizzle-orm";
import { Result } from "effect";
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
  | ScopeClockCorruptionError;

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
export async function requireScopeAuthorizationRevocationEpochInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<
  Result.Result<
    TransactionAuthorizationRevocationEpoch,
    ScopeAuthorizationRevocationEpochReadError
  >
> {
  const row = await lockScopeAuthorizationRevocationEpochForShareInTransaction(
    db,
    scopeId,
  );
  if (row === undefined) {
    return Result.fail(new ScopeClockNotFoundError(scopeId));
  }
  return decodeScopeAuthorizationRevocationEpochResult(
    row.scopeId,
    row.authorizationRevocationEpoch,
  );
}

async function lockScopeAuthorizationRevocationEpochForShareInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<
  Pick<ScopeClockRow, "scopeId" | "authorizationRevocationEpoch"> | undefined
> {
  const rows = await db
    .select({
      scopeId: fxSystemScopeClocks.scopeId,
      authorizationRevocationEpoch:
        fxSystemScopeClocks.authorizationRevocationEpoch,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("share");
  return rows[0];
}

/**
 * Advances the current scope authority by exactly one under the caller's
 * short transaction. Callers cannot select or replace the persisted value.
 */
export async function advanceScopeAuthorizationRevocationEpochInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<AdvanceScopeAuthorizationRevocationEpochResult> {
  const row = await lockScopeClockRowForUpdateInTransaction(db, scopeId);
  const previous = decodeScopeAuthorizationRevocationEpoch(
    row.scopeId,
    row.authorizationRevocationEpoch,
  );
  if (previous === MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH) {
    throw new ScopeAuthorizationRevocationEpochExhaustedError(scopeId);
  }
  const expectedCurrent = TransactionAuthorizationRevocationEpochSchema.make(
    previous + 1n,
  );
  const updatedRows = await db
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
  const updated = updatedRows[0];
  if (updated === undefined) {
    throw new ScopeClockNotFoundError(scopeId);
  }
  const current = decodeScopeAuthorizationRevocationEpoch(
    scopeId,
    updated.authorizationRevocationEpoch,
  );
  if (current !== expectedCurrent) {
    throw new ScopeClockCorruptionError(
      scopeId,
      "authorization revocation epoch increment returned an unexpected value",
    );
  }
  return { previous, current };
}

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
  const rows = await db
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("update");
  const clock = rows[0];
  if (clock === undefined) {
    throw new ScopeClockNotFoundError(scopeId);
  }
  return clock;
}

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

function decodeScopeAuthorizationRevocationEpoch(
  scopeId: string,
  value: unknown,
): TransactionAuthorizationRevocationEpoch {
  // Temporary throwing projection for the still-Promise epoch-advance path.
  // Delete it when advanceScopeAuthorizationRevocationEpochInTransaction owns
  // an Effect/Result failure channel.
  return Result.getOrThrow(
    decodeScopeAuthorizationRevocationEpochResult(scopeId, value),
  );
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
