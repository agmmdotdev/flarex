import {
  CommitSeqSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { getScopeClock, type ScopeClockRecord } from "./scopeClock";
import { fxSystemScopeClocks } from "./schema";

export interface InitialScopeClockInput {
  readonly scopeId: ScopeId;
  readonly initialEpoch: ScopeEpoch;
}

export interface InsertInitialScopeClockResult {
  readonly clock: ScopeClockRecord;
  readonly created: boolean;
}

const initialStorageGeneration =
  LegacyV1StorageGenerationSchema.make("legacy_v1");
const initialStorageGenerationFence = StorageGenerationFenceSchema.make(1n);
const initialCommitSeq = CommitSeqSchema.make(0n);
const initialOutboxSeq = OutboxSeqSchema.make(0n);

export async function insertInitialScopeClockInTransaction(
  tx: FlarexMetadataDatabase,
  input: InitialScopeClockInput,
): Promise<InsertInitialScopeClockResult> {
  const inserted = await tx
    .insert(fxSystemScopeClocks)
    .values({
      scopeId: input.scopeId,
      storageGeneration: initialStorageGeneration,
      storageGenerationFence: initialStorageGenerationFence,
      lastCommitSeq: initialCommitSeq,
      lastOutboxSeq: initialOutboxSeq,
      epoch: input.initialEpoch,
    })
    .onConflictDoNothing({ target: fxSystemScopeClocks.scopeId })
    .returning({ scopeId: fxSystemScopeClocks.scopeId });
  const clock = await getScopeClock(tx, input.scopeId);
  if (clock === null) {
    throw new Error(
      `Scope clock disappeared during initialization: ${input.scopeId}`,
    );
  }
  return {
    clock,
    created: inserted.length > 0,
  };
}

export function isExactInitialScopeClock(
  clock: ScopeClockRecord,
  input: InitialScopeClockInput,
): boolean {
  return (
    clock.scopeId === input.scopeId &&
    clock.storageGeneration === initialStorageGeneration &&
    clock.storageGenerationFence === initialStorageGenerationFence &&
    clock.lastCommitSeq === initialCommitSeq &&
    clock.lastOutboxSeq === initialOutboxSeq &&
    clock.epoch === input.initialEpoch
  );
}
