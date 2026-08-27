import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
  type ScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
} from "flarex-protocol/storage-authority";

import {
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  type ApplicationActiveHeadStateError,
} from "./applicationActiveHeadRead";
import {
  ScopeExecution,
  type ScopeExecutionError,
} from "./scopeExecution/ScopeExecution";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  defineScopedReadOperation,
} from "./scopeExecution/ScopedTransaction";
import type { LocatedReadCommittedAttemptTargetV1 } from
  "./transactionSessionAttemptKernel";

const decodeActivationSequenceResult = Schema.decodeUnknownResult(
  Schema.toType(ApplicationActivationSequenceV1Schema),
);
const decodeActiveHeadSha256HexResult = Schema.decodeUnknownResult(
  Schema.toType(ApplicationActiveHeadSha256HexV1Schema),
);

export class ScopeSyncActiveHeadObservationError extends Data.TaggedError(
  "ScopeSyncActiveHeadObservationError",
)<{
  readonly reason: "activeHeadMissing" | "activeHeadInvalid";
  readonly deploymentId: string;
  readonly cause?: unknown;
}> {}

export interface ScopeSyncActiveHeadObservationContextV1 {
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

export type ObserveScopeSyncActiveHeadErrorV1 =
  | ScopeSyncActiveHeadObservationError
  | ApplicationActiveHeadStateError
  | TrustedScopeAuthorityError
  | ScopeExecutionError;

const observeActiveHeadScopedOperation = defineScopedReadOperation(
  (tx, scoped, deploymentId: string): Effect.Effect<
    ScopeSyncActiveHeadObservationV1,
    ScopeSyncActiveHeadObservationError | ApplicationActiveHeadStateError
  > => Effect.gen(function* () {
    if (scoped.clock.storageGeneration !== "flarexdb_v1") {
      return yield* Effect.die(
        new Error("ScopeExecution admitted a non-FlarexDB sync observation."),
      );
    }
    const scope = yield* Effect.fromResult(
      projectScopeIdUuidV1Result(scoped.clock.scopeId).pipe(
        Result.mapError(cause => invalidObservation(deploymentId, cause)),
      ),
    );
    const epoch = yield* Effect.fromResult(
      projectScopeEpochUuidV1Result(scoped.clock.epoch).pipe(
        Result.mapError(cause => invalidObservation(deploymentId, cause)),
      ),
    );
    const active = yield*
      readCoherentApplicationActiveHeadForShareInTransactionEffect(
        tx,
        scoped.clock.scopeId,
      );
    if (active === null) {
      return yield* Effect.fail(new ScopeSyncActiveHeadObservationError({
        reason: "activeHeadMissing",
        deploymentId,
      }));
    }
    const activationSequence = yield* Effect.fromResult(
      decodeActivationSequenceResult(active.head.activationSequence).pipe(
        Result.mapError(cause => invalidObservation(deploymentId, cause)),
      ),
    );
    const activeHeadSha256Hex = yield* Effect.fromResult(
      decodeActiveHeadSha256HexResult(
        encodeBytesToLowercaseHex(active.head.headSha256),
      ).pipe(
        Result.mapError(cause => invalidObservation(deploymentId, cause)),
      ),
    );
    return captureScopeSyncActiveHeadObservationV1({
      format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      scopeUuid: scope.scopeUuid,
      epochUuid: epoch.epochUuid,
      storageGeneration: scoped.clock.storageGeneration,
      storageGenerationFence: scoped.clock.storageGenerationFence,
      observedAtCommitSeq: scoped.clock.lastCommitSeq,
      activationSequence,
      activeHeadSha256Hex,
    });
  }),
);

export const observeScopeSyncActiveHeadV1Effect = Effect.fn(
  "ScopeSyncActiveHead.observeCurrent",
)(function* (
  context: ScopeSyncActiveHeadObservationContextV1,
): Effect.fn.Return<
  ScopeSyncActiveHeadObservationV1,
  ObserveScopeSyncActiveHeadErrorV1,
  ScopeExecution
> {
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  const scopeExecution = yield* ScopeExecution;
  return yield* scopeExecution.runRead(
    located,
    {
      rollbackMessage: "Scope sync active-head observation rolled back.",
      cleanupDefect: failure => failure,
    },
    observeActiveHeadScopedOperation,
    context.deploymentId,
  );
});

function invalidObservation(
  deploymentId: string,
  cause: unknown,
): ScopeSyncActiveHeadObservationError {
  return new ScopeSyncActiveHeadObservationError({
    reason: "activeHeadInvalid",
    deploymentId,
    cause,
  });
}
