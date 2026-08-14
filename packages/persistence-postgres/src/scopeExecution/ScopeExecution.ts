import { copyFiniteDate } from "@flarex/utils/dates";
import { Context, Effect, Layer } from "effect";

import { runLocatedReadCommittedEffect } from
  "../locatedReadCommittedEffect";
import {
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
} from "../scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "../scopeClock";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "../scopePhysicalLocator";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../transactionSessionAttemptKernel";
import { ScopeExecutionAuthorityError } from "./Errors";
import {
  closeScopedTransaction,
  issueScopedTransaction,
  runScopedTransactionOperationEffect,
  type ScopedReadOperation,
  type ScopedTransaction,
  type ScopedTransactionContext,
  type ScopedWriteOperation,
} from "./ScopedTransaction";

export interface ScopeExecutionSettlementOptions {
  readonly rollbackMessage: string;
  readonly cleanupDefect: (
    failure: LocatedReadCommittedTransactionFailureV1,
  ) => unknown;
}

export type ScopeExecutionError =
  | ScopeExecutionAuthorityError
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError
  | LocatedReadCommittedTransactionFailureV1;

export interface ScopeExecutionApi {
  readonly runRead: <Input, Value, Failure>(
    located: LocatedTrustedScopeAuthority<
      LocatedReadCommittedAttemptTargetV1
    >,
    settlement: ScopeExecutionSettlementOptions,
    operation: ScopedReadOperation<Input, Value, Failure>,
    input: Input,
  ) => Effect.Effect<Value, Failure | ScopeExecutionError>;
  readonly runWrite: <Input, Value, Failure>(
    located: LocatedTrustedScopeAuthority<
      LocatedReadCommittedAttemptTargetV1
    >,
    settlement: ScopeExecutionSettlementOptions,
    operation: ScopedWriteOperation<Input, Value, Failure>,
    input: Input,
  ) => Effect.Effect<Value, Failure | ScopeExecutionError>;
}

export class ScopeExecution extends Context.Service<
  ScopeExecution,
  ScopeExecutionApi
>()("flarex/persistence-postgres/ScopeExecution") {}

const runRead: ScopeExecutionApi["runRead"] = Effect.fn(
  "ScopeExecution.runRead",
)((located, settlement, operation, input) =>
  runLocated("read", located, settlement, operation, input));

const runWrite: ScopeExecutionApi["runWrite"] = Effect.fn(
  "ScopeExecution.runWrite",
)((located, settlement, operation, input) =>
  runLocated("write", located, settlement, operation, input));

/** Fixed, lifecycle-free package capability; request authority stays per call. */
export const liveScopeExecution = ScopeExecution.of(Object.freeze({
  runRead,
  runWrite,
}));

export const ScopeExecutionLive = Layer.succeed(
  ScopeExecution,
  liveScopeExecution,
);

const runLocated = Effect.fn("ScopeExecution.runLocated")(function* <
  Mode extends "read" | "write",
  Input,
  Value,
  Failure,
>(
  mode: Mode,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  settlement: ScopeExecutionSettlementOptions,
  operation: Mode extends "read"
    ? ScopedReadOperation<Input, Value, Failure>
    : ScopedWriteOperation<Input, Value, Failure>,
  input: Input,
): Effect.fn.Return<Value, Failure | ScopeExecutionError> {
  const authority = captureAuthority(located.authority);
  const target = located.target;
  const capturedSettlement = Object.freeze({
    rollbackMessage: settlement.rollbackMessage,
    cleanupDefect: settlement.cleanupDefect,
  });
  const targetLocator = captureScopePhysicalLocator(target.physicalLocator);
  if (!scopePhysicalLocatorsEqual(authority.physicalLocator, targetLocator)) {
    return yield* new ScopeExecutionAuthorityError({
      scopeId: authority.scopeId,
      reason: "targetPlacementMismatch",
    });
  }

  return yield* runLocatedReadCommittedEffect(
    target,
    capturedSettlement,
    tx => Effect.gen(function* () {
      const clock = mode === "read"
        ? yield* lockScopeClockForShareInTransactionEffect(tx, authority.scopeId)
        : yield* lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId);
      yield* requireStableAuthority(authority, clock);
      const context = scopedContext(mode, authority, clock);
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => issueScopedTransaction(tx, context)),
        capability => runOperation(capability, operation, input),
        capability => Effect.sync(() => closeScopedTransaction(capability)),
      );
    }),
  );
});

function runOperation<Input, Value, Failure>(
  capability: ScopedTransaction,
  operation:
    | ScopedReadOperation<Input, Value, Failure>
    | ScopedWriteOperation<Input, Value, Failure>,
  input: Input,
): Effect.Effect<Value, Failure> {
  return runScopedTransactionOperationEffect(capability, operation, input);
}

function requireStableAuthority(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, ScopeExecutionAuthorityError> {
  const reason = clock.scopeId !== authority.scopeId
    ? "scopeMismatch"
    : clock.storageGeneration !== "flarexdb_v1" ||
        authority.storageGeneration !== "flarexdb_v1"
    ? "unsupportedStorageGeneration"
    : clock.storageGeneration !== authority.storageGeneration
    ? "storageGenerationChanged"
    : clock.storageGenerationFence !== authority.storageGenerationFence
    ? "storageGenerationFenceChanged"
    : clock.epoch !== authority.epoch
    ? "scopeEpochChanged"
    : undefined;
  return reason === undefined
    ? Effect.void
    : Effect.fail(new ScopeExecutionAuthorityError({
        scopeId: authority.scopeId,
        reason,
      }));
}

function captureAuthority(
  authority: TrustedScopeAuthority,
): TrustedScopeAuthority {
  return Object.freeze({
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    physicalLocator: captureScopePhysicalLocator(authority.physicalLocator),
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
    lastCommitSeq: authority.lastCommitSeq,
    lastOutboxSeq: authority.lastOutboxSeq,
  });
}

function scopedContext(
  mode: "read" | "write",
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): ScopedTransactionContext {
  const updatedAt = copyFiniteDate(clock.updatedAt);
  if (updatedAt === undefined) {
    throw new Error("Decoded scope-clock time must remain finite.");
  }
  return Object.freeze({
    mode,
    authority,
    clock: Object.freeze({
      scopeId: clock.scopeId,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      lastCommitSeq: clock.lastCommitSeq,
      lastOutboxSeq: clock.lastOutboxSeq,
      epoch: clock.epoch,
      updatedAt,
    }),
  });
}
