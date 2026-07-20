import { Result } from "effect";
import {
  CommitSeqSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  getScopeClockResult,
  type ScopeClockCorruptionError,
  type ScopeClockRecord,
} from "./scopeClock";
import { fxSystemScopeClocks } from "./schema";

export interface InitialScopeClockInput {
  readonly scopeId: ScopeId;
  readonly initialEpoch: ScopeEpoch;
}

export interface InsertInitialScopeClockResult {
  readonly clock: ScopeClockRecord;
  readonly created: boolean;
}

export class ScopeClockInitializationCorruptionError extends Error {
  readonly _tag = "ScopeClockInitializationCorruptionError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Scope clock disappeared during initialization: ${scopeId}`);
    this.name = "ScopeClockInitializationCorruptionError";
  }
}

export type InsertInitialScopeClockError =
  | ScopeClockCorruptionError
  | ScopeClockInitializationCorruptionError;

const initialStorageGeneration =
  LegacyV1StorageGenerationSchema.make("legacy_v1");
const initialStorageGenerationFence = StorageGenerationFenceSchema.make(1n);
const initialCommitSeq = CommitSeqSchema.make(0n);
const initialOutboxSeq = OutboxSeqSchema.make(0n);
const initialAuthorizationRevocationEpoch =
  TransactionAuthorizationRevocationEpochSchema.make(0n);

export async function insertInitialScopeClockInTransactionResult(
  tx: FlarexMetadataDatabase,
  input: InitialScopeClockInput,
): Promise<Result.Result<
  InsertInitialScopeClockResult,
  InsertInitialScopeClockError
>> {
  const inserted = await tx
    .insert(fxSystemScopeClocks)
    .values({
      scopeId: input.scopeId,
      storageGeneration: initialStorageGeneration,
      storageGenerationFence: initialStorageGenerationFence,
      lastCommitSeq: initialCommitSeq,
      lastOutboxSeq: initialOutboxSeq,
      authorizationRevocationEpoch: initialAuthorizationRevocationEpoch,
      epoch: input.initialEpoch,
    })
    .onConflictDoNothing({ target: fxSystemScopeClocks.scopeId })
    .returning({ scopeId: fxSystemScopeClocks.scopeId });
  const clockResult = await getScopeClockResult(tx, input.scopeId);
  return Result.gen(function* () {
    const clock = yield* clockResult;
    if (clock === null) {
      return yield* Result.fail(
        new ScopeClockInitializationCorruptionError(input.scopeId),
      );
    }
    return {
      clock,
      created: inserted.length > 0,
    } satisfies InsertInitialScopeClockResult;
  });
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
