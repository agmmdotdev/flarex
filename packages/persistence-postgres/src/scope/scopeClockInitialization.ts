import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { Result } from "effect";
import {
  CommitSeqSchema,
  LegacyV1StorageGenerationSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "../application/deployments";
import {
  getScopeClockResult,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  type ScopeClockCorruptionError,
} from "./scopeClockErrors";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../database/schema";

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
      lastCommitSeq: initialCommitSeq,
      lastMetadataSequence: MetadataSequenceSchema.make(0n),
    })
    .onConflictDoNothing({ target: fxSystemScopeClocks.scopeId })
    .returning({ scopeId: fxSystemScopeClocks.scopeId });
  if (inserted.length > 0) await tx.insert(fxSystemScopeExecutionAuthorities).values({
    scopeId: input.scopeId, storageGeneration: initialStorageGeneration,
    storageGenerationFence: initialStorageGenerationFence, oldestAvailableCommitSeq: initialCommitSeq,
    authorizationRevocationEpoch: initialAuthorizationRevocationEpoch, epoch: input.initialEpoch,
  });
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
    clock.lastMetadataSequence === 0n &&
    clock.oldestAvailableCommitSeq === initialCommitSeq &&
    clock.epoch === input.initialEpoch
  );
}
