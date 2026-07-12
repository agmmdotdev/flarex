import { eq } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
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

import type { FlarexMetadataDatabase } from "./deployments";
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
  constructor(readonly scopeId: ScopeId) {
    super(`Scope clock does not exist: ${scopeId}`);
    this.name = "ScopeClockNotFoundError";
  }
}

export class ScopeClockCorruptionError extends Error {
  constructor(
    readonly scopeId: string,
    readonly reason: string,
  ) {
    super(`Scope clock ${scopeId} is invalid: ${reason}`);
    this.name = "ScopeClockCorruptionError";
  }
}

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
 * S02-B-only lock primitive. Callers must already be inside a short trusted
 * database transaction. This module is intentionally not exported from the
 * package root, and the helper cannot allocate or advance either counter.
 */
export async function lockScopeClockForUpdateInTransaction(
  db: ScopeClockTransaction,
  scopeId: ScopeId,
): Promise<ScopeClockRecord> {
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
  return decodeScopeClockRecord(clock);
}

type ScopeClockTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

export type ScopeClockRow = typeof fxSystemScopeClocks.$inferSelect;

export function decodeScopeClockRecord(row: ScopeClockRow): ScopeClockRecord {
  if (row.scopeId.trim().length === 0) {
    throw new ScopeClockCorruptionError(row.scopeId, "scope ID is empty");
  }
  if (row.epoch.trim().length === 0) {
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
  if (
    !(row.updatedAt instanceof Date) ||
    Number.isNaN(row.updatedAt.getTime())
  ) {
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
    updatedAt: row.updatedAt,
  } satisfies ScopeClockRecord;
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
