import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityResolutionError,
  type TrustedScopeAuthorityResolutionPorts,
} from "@flarex/persistence-postgres";
import {
  confirmTaskChildMutationEffect,
  declareTaskChildMutationDispatch,
  issueApplicationTaskExternalEffectSubject,
  prepareTaskChildMutationEffect,
  reconcileTaskChildMutationDisposition,
  revokeApplicationTaskExternalEffectSubject,
  InvalidApplicationTaskExternalEffectSubjectError,
  TaskExternalEffectAuthorityCorruptionError,
  TaskExternalEffectAuthorityInputError,
  TaskExternalEffectAuthorityStaleError,
  TaskExternalEffectLifecycleConflictError,
  TaskExternalEffectRequestConflictError,
  TaskExternalEffectSequenceConflictError,
  type LocatedTaskExternalEffectAuthorityTarget,
  type ReconcileTaskChildMutationDispositionInput,
  type ReconcileTaskChildMutationDispositionReceipt,
  type TaskChildMutationEffectInput,
  type TaskChildMutationEffectProjection,
  type TaskExternalEffectAuthorityHashContext,
  type TaskExternalEffectAuthoritySha256,
} from "@flarex/persistence-postgres/internal/task-external-effect-authority";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  ApplicationTaskMutationCallbackBindError,
  type ApplicationTaskMutationCallbackAuthority,
  type ApplicationTaskMutationCallbackSession,
  type ApplicationTaskMutationCallbackSessionFailure,
} from "flarex-backend/internal/task-compute-delivery";
import {
  decodeTaskRuntimeLaunchRequest,
  type ApplicationTaskRuntimeLaunchSubject,
} from "flarex-backend/internal/task-runtime-launch";
import { Cause, Data, Deferred, Effect, Exit, Result, Schema } from "effect";
import {
  applicationTaskMutationRequestKeyV1FromDigest,
  encodeApplicationTaskMutationRequestIdentityPreimageV1,
  encodeApplicationTaskMutationStableKeyPreimageV1,
  MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import {
  canonicalizeFlarexValueJsonV1Effect,
  canonicalizeFlarexValueV1Effect,
} from "flarex-protocol/value";

import {
  ApplicationTaskMutationLaunchError,
  inspectApplicationMutationAuthenticatedIdentity,
  prepareApplicationMutationAuthenticatedIdentity,
  type ApplicationMutationSystemApi,
} from "./ApplicationMutationSystem";
import {
  captureApplicationTaskLaunchEvidence,
} from "./ApplicationTaskQueryAuthority";

const decodeFunctionPath = Schema.decodeUnknownResult(
  Schema.toType(TransactionFunctionPathV1Schema),
);

interface MutationReconciliationProgress {
  input: ReconcileTaskChildMutationDispositionInput | null;
  outcome: Readonly<{
    readonly sha256: Uint8Array;
    readonly value: TaskMutationResult;
  }> | null;
}

type TaskMutationResult = Effect.Success<ReturnType<
  ApplicationTaskMutationCallbackSession["runMutation"]
>>;

export type ApplicationTaskMutationExternalEffectFailureReason =
  | "invalidInput"
  | "invalidComposition"
  | "staleLaunch"
  | "sequenceMismatch"
  | "replayConflict"
  | "integrationFailure";

export class ApplicationTaskMutationExternalEffectError extends Data.TaggedError(
  "ApplicationTaskMutationExternalEffectError",
)<{
  readonly operation:
    | "bind"
    | "prepare"
    | "declareDispatch"
    | "confirm"
    | "reconcile";
  readonly reason: ApplicationTaskMutationExternalEffectFailureReason;
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskMutationExternalEffectSession {
  readonly settlementBudgetMilliseconds: number;
  readonly prepare: (
    input: TaskChildMutationEffectInput,
  ) => Effect.Effect<
    TaskChildMutationEffectProjection,
    ApplicationTaskMutationExternalEffectError
  >;
  readonly declareDispatch: (
    ordinal: bigint,
  ) => Effect.Effect<
    TaskChildMutationEffectProjection,
    ApplicationTaskMutationExternalEffectError
  >;
  readonly confirm: (
    ordinal: bigint,
    outcomeSha256: Uint8Array,
  ) => Effect.Effect<
    TaskChildMutationEffectProjection,
    ApplicationTaskMutationExternalEffectError
  >;
  readonly reconcile: (
    input: ReconcileTaskChildMutationDispositionInput,
  ) => Effect.Effect<
    ReconcileTaskChildMutationDispositionReceipt,
    ApplicationTaskMutationExternalEffectError
  >;
  readonly close: Effect.Effect<void>;
}

export interface ApplicationTaskMutationExternalEffectAuthority {
  readonly bind: (
    dispatch: ApplicationTaskRuntimeLaunchSubject["request"],
  ) => Effect.Effect<
    ApplicationTaskMutationExternalEffectSession,
    ApplicationTaskMutationExternalEffectError
  >;
}

export interface ApplicationTaskMutationExternalEffectLive<HashError> {
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskExternalEffectAuthorityTarget
  >;
  readonly sha256: TaskExternalEffectAuthoritySha256<HashError>;
}

export interface ApplicationTaskMutationAuthorityLive<HashError> {
  readonly externalEffect: ApplicationTaskMutationExternalEffectAuthority;
  readonly mutation: Pick<
    ApplicationMutationSystemApi,
    "invokeAuthenticatedAtTaskLaunch"
  >;
  readonly sha256: TaskExternalEffectAuthoritySha256<HashError>;
  readonly maximumCloseMilliseconds: number;
}

export function makeApplicationTaskMutationExternalEffectAuthority<
  HashError,
>(
  live: ApplicationTaskMutationExternalEffectLive<HashError>,
): ApplicationTaskMutationExternalEffectAuthority {
  const deploymentId = live.deploymentId;
  const authorityPorts = live.authority;
  const sha256Owner = live.sha256;
  const hash = live.sha256.hash;
  const sha256 = Object.freeze({
    hash: (bytes: Uint8Array) => hash.call(sha256Owner, bytes),
  });
  const bind: ApplicationTaskMutationExternalEffectAuthority["bind"] =
    Effect.fn("ApplicationTaskMutationExternalEffect.bind")(function* (
      dispatch,
    ) {
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        deploymentId,
        authorityPorts,
      ).pipe(Effect.mapError(cause => externalEffectError(
        "bind",
        cause instanceof TrustedScopeAuthorityResolutionError
          ? "staleLaunch"
          : "integrationFailure",
        cause,
      )));
      const context: TaskExternalEffectAuthorityHashContext<HashError> =
        Object.freeze({
          target: located.target,
          authority: located.authority,
          sha256,
        });
      const subject = yield* issueApplicationTaskExternalEffectSubject(
        dispatch,
        context,
      ).pipe(Effect.mapError(cause => mapPersistenceFailure("bind", cause)));
      const project = <E>(
        effect: Effect.Effect<
          { readonly effect: TaskChildMutationEffectProjection },
          E
        >,
        operation: ApplicationTaskMutationExternalEffectError["operation"],
      ) => effect.pipe(
        Effect.map(receipt => receipt.effect),
        Effect.mapError(cause => mapPersistenceFailure(operation, cause)),
      );
      return Object.freeze({
        settlementBudgetMilliseconds:
          located.target.settlementBudgetMilliseconds,
        prepare: Effect.fn("ApplicationTaskMutationExternalEffect.prepare")(
          input => project(
            prepareTaskChildMutationEffect(subject, input, context),
            "prepare",
          ),
        ),
        declareDispatch: Effect.fn(
          "ApplicationTaskMutationExternalEffect.declareDispatch",
        )(ordinal => project(
          declareTaskChildMutationDispatch(subject, ordinal, context),
          "declareDispatch",
        )),
        confirm: Effect.fn("ApplicationTaskMutationExternalEffect.confirm")(
          (ordinal, outcomeSha256) => project(
            confirmTaskChildMutationEffect(
              subject,
              ordinal,
              outcomeSha256,
              context,
            ),
            "confirm",
          ),
        ),
        reconcile: Effect.fn(
          "ApplicationTaskMutationExternalEffect.reconcile",
        )(input => reconcileTaskChildMutationDisposition(
          subject,
          input,
          context,
        ).pipe(
          Effect.mapError(cause => mapPersistenceFailure("reconcile", cause)),
        )),
        close: Effect.sync(() =>
          revokeApplicationTaskExternalEffectSubject(subject)
        ),
      });
    });
  return Object.freeze({ bind });
}

export function makeApplicationTaskMutationAuthority<HashError>(
  live: ApplicationTaskMutationAuthorityLive<HashError>,
): ApplicationTaskMutationCallbackAuthority {
  if (
    !isPositiveSafeInteger(live.maximumCloseMilliseconds) ||
    live.maximumCloseMilliseconds > MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1
  ) {
    throw new Error("Application Task mutation close budget is invalid.");
  }
  const externalOwner = live.externalEffect;
  const bindExternal = live.externalEffect.bind;
  const mutationOwner = live.mutation;
  const invokeMutation = live.mutation.invokeAuthenticatedAtTaskLaunch;
  const sha256Owner = live.sha256;
  const hash = live.sha256.hash;
  const maximumCloseMilliseconds = live.maximumCloseMilliseconds;

  const bindLaunch: ApplicationTaskMutationCallbackAuthority["bindLaunch"] =
    Effect.fn("ApplicationTaskMutationAuthority.bindLaunch")(function* (
      subject,
    ) {
      const currentRequest = yield* Effect.fromResult(
        decodeTaskRuntimeLaunchRequest(subject.request),
      ).pipe(Effect.mapError(cause => bindError("invalidInput", cause)));
      if (currentRequest.taskDefinitionRevisionId !== undefined) {
        return yield* bindError("invalidInput");
      }
      const request = currentRequest;
      const launch = yield* Effect.fromResult(
        captureApplicationTaskLaunchEvidence({
          creationAuthority: subject.creationAuthority,
          runtimeTarget: subject.runtimeTarget,
          executionIdentity: subject.executionIdentity,
        }),
      ).pipe(Effect.mapError(cause => bindError(
        cause.reason === "invalidComposition"
          ? "invalidComposition"
          : "invalidInput",
        cause,
      )));
      if (
        launch.creationAuthority.scopeId !== request.identity.scopeId ||
        !bytesEqualFullScan(
          launch.creationAuthority.applicationTaskRuntimeTargetSha256,
          request.applicationTaskRuntimeTargetSha256,
        )
      ) return yield* bindError("invalidComposition");
      const identity = yield* prepareApplicationMutationAuthenticatedIdentity(
        launch.executionIdentity,
      ).pipe(Effect.mapError(cause => bindError("invalidInput", cause)));
      const identityEvidence = yield* Effect.fromResult(
        inspectApplicationMutationAuthenticatedIdentity(identity),
      ).pipe(Effect.mapError(cause => bindError("invalidComposition", cause)));
      const externalRequest = yield* Effect.try({
        try: () => structuredClone(request),
        catch: cause => bindError("invalidInput", cause),
      });
      const external = yield* bindExternal.call(
        externalOwner,
        externalRequest,
      ).pipe(Effect.mapError(mapBindExternalEffectFailure));
      const settlementBudgetMilliseconds =
        external.settlementBudgetMilliseconds;
      if (
        !isPositiveSafeInteger(settlementBudgetMilliseconds) ||
        settlementBudgetMilliseconds > maximumCloseMilliseconds
      ) {
        yield* external.close;
        return yield* bindError("invalidComposition");
      }
      let closed = false;
      let activeOperations = 0;
      let closeStarted = false;
      const drained = Deferred.makeUnsafe<void, never>();
      const closeCompletion = Deferred.makeUnsafe<void, never>();
      const executeMutation = Effect.fn(
        "ApplicationTaskMutationSession.executeMutation",
      )(function* (
        ordinal: Parameters<
          ApplicationTaskMutationCallbackSession["runMutation"]
        >[0],
        functionPath: Parameters<
          ApplicationTaskMutationCallbackSession["runMutation"]
        >[1],
        argumentsValue: Parameters<
          ApplicationTaskMutationCallbackSession["runMutation"]
        >[2],
        progress: MutationReconciliationProgress,
      ) {
          const functionRef = yield* Effect.fromResult(
            decodeFunctionPath(functionPath),
          ).pipe(Effect.mapError(cause => sessionFailureValue(
            "invalidInput",
            cause,
          )));
          const canonicalArguments = yield* canonicalizeFlarexValueV1Effect(
            argumentsValue,
          ).pipe(Effect.mapError(cause => sessionFailureValue(
            "invalidInput",
            cause,
          )));
          const stablePreimage = yield* Effect.fromResult(
            encodeApplicationTaskMutationStableKeyPreimageV1({
              scopeId: request.identity.scopeId,
              runId: request.identity.runId,
              operationOrdinal: ordinal,
            }),
          ).pipe(Effect.mapError(cause => sessionFailureValue(
            "invalidInput",
            cause,
          )));
          const stableDigest = yield* hash.call(
            sha256Owner,
            copyBytes(stablePreimage.canonicalBytes),
          ).pipe(
            Effect.mapError(cause => sessionFailureValue(
              "mutationFailed",
              cause,
            )),
            Effect.flatMap(value => Effect.fromResult(
              captureHashDigest(value),
            )),
          );
          const stableRequestKey = yield* Effect.fromResult(
            applicationTaskMutationRequestKeyV1FromDigest(stableDigest),
          ).pipe(Effect.mapError(cause => sessionFailureValue(
            "mutationFailed",
            cause,
          )));
          const requestPreimage = yield* Effect.fromResult(
            encodeApplicationTaskMutationRequestIdentityPreimageV1({
              stableRequestKey,
              applicationTaskRuntimeTargetSha256:
                request.applicationTaskRuntimeTargetSha256,
              functionPath: functionRef,
              argumentsSha256: canonicalArguments.sha256,
              identityAccessPolicySha256:
                identityEvidence.identityAccessPolicySha256,
            }),
          ).pipe(Effect.mapError(cause => sessionFailureValue(
            "invalidInput",
            cause,
          )));
          const requestIdentitySha256 = yield* hash.call(
            sha256Owner,
            copyBytes(requestPreimage.canonicalBytes),
          ).pipe(
            Effect.mapError(cause => sessionFailureValue(
              "mutationFailed",
              cause,
            )),
            Effect.flatMap(value => Effect.fromResult(
              captureHashDigest(value),
            )),
          );
          progress.input = Object.freeze({
            effectOrdinal: ordinal,
            stableRequestKey,
            requestIdentitySha256: copyBytes(requestIdentitySha256),
            functionPath: functionRef,
            argumentsSha256: copyBytes(canonicalArguments.sha256),
            outcomeSha256: null,
          });
          const prepared = yield* external.prepare({
            effectOrdinal: ordinal,
            requestIdentitySha256,
            functionPath: functionRef,
            argumentsSha256: canonicalArguments.sha256,
          }).pipe(
            Effect.mapError(mapSessionExternalEffectFailure),
            Effect.uninterruptible,
          );
          if (prepared.stableRequestKey !== stableRequestKey) {
            return yield* sessionFailure("replayConflict");
          }
          if (prepared.state === "failed_before_dispatch") {
            return yield* sessionFailure("mutationFailed");
          }
          if (prepared.state === "uncertain") {
            return yield* sessionFailure("outcomeUncertain");
          }
          const dispatching = prepared.state === "prepared"
            ? yield* external.declareDispatch(ordinal).pipe(
                Effect.mapError(mapSessionExternalEffectFailure),
                Effect.uninterruptible,
              )
            : prepared;
          if (
            dispatching.state !== "dispatching" &&
            dispatching.state !== "confirmed"
          ) return yield* sessionFailure("replayConflict");

          const invoked = Effect.scoped(invokeMutation.call(
            mutationOwner,
            functionRef,
            canonicalArguments.value,
            stableRequestKey,
            identity,
            launch,
          )).pipe(
            Effect.mapError(mapMutationFailure),
            Effect.flatMap(outcome =>
              canonicalizeFlarexValueJsonV1Effect(outcome.value).pipe(
                Effect.mapError(cause => sessionFailureValue(
                  "invalidResult",
                  cause,
                )),
              )
            ),
          );
          const canonicalOutcome = yield* invoked;
          progress.outcome = Object.freeze({
            sha256: copyBytes(canonicalOutcome.sha256),
            value: canonicalOutcome.value,
          });
          progress.input = Object.freeze({
            ...progress.input,
            outcomeSha256: copyBytes(canonicalOutcome.sha256),
          });
          yield* external.confirm(
            ordinal,
            canonicalOutcome.sha256,
          ).pipe(
            Effect.mapError(mapSessionExternalEffectFailure),
            Effect.uninterruptible,
          );
          return canonicalOutcome.value;
        });
      const releaseOperation = Effect.suspend(() => {
        activeOperations -= 1;
        return closed && activeOperations === 0
          ? Deferred.succeed(drained, undefined).pipe(Effect.asVoid)
          : Effect.void;
      });
      const runMutation: ApplicationTaskMutationCallbackSession["runMutation"] =
        Effect.fn("ApplicationTaskMutationSession.runMutation")(function* (
          ordinal,
          functionPath,
          argumentsValue,
        ) {
          if (closed) return yield* sessionFailure("staleLaunch");
          activeOperations += 1;
          const progress: MutationReconciliationProgress = {
            input: null,
            outcome: null,
          };
          return yield* Effect.uninterruptibleMask(restore =>
            Effect.gen(function* () {
              const exit = yield* restore(executeMutation(
                ordinal,
                functionPath,
                argumentsValue,
                progress,
              )).pipe(Effect.exit);
              if (Exit.isSuccess(exit)) return exit.value;
              return yield* reconcileMutationDisposition(
                external,
                progress,
                exit,
              );
            })
          ).pipe(Effect.ensuring(releaseOperation));
        });
      const close = Effect.uninterruptible(Effect.suspend(() => {
        if (closeStarted) return Deferred.await(closeCompletion);
        closeStarted = true;
        closed = true;
        const settle = (
          activeOperations === 0 ? Effect.void : Deferred.await(drained)
        ).pipe(
          Effect.andThen(external.close),
          Effect.onExit(exit => Deferred.done(closeCompletion, exit)),
        );
        return settle;
      }));
      return Object.freeze({
        maximumCloseMilliseconds,
        runMutation,
        close,
      });
    });
  return Object.freeze({ bindLaunch });
}

function mapPersistenceFailure(
  operation: ApplicationTaskMutationExternalEffectError["operation"],
  cause: unknown,
): ApplicationTaskMutationExternalEffectError {
  if (cause instanceof TaskExternalEffectAuthorityInputError) {
    return externalEffectError(operation, "invalidInput", cause);
  }
  if (cause instanceof TaskExternalEffectAuthorityStaleError) {
    return externalEffectError(operation, "staleLaunch", cause);
  }
  if (cause instanceof InvalidApplicationTaskExternalEffectSubjectError) {
    return externalEffectError(
      operation,
      cause.reason === "scope_mismatch" ? "staleLaunch" : "invalidComposition",
      cause,
    );
  }
  if (cause instanceof TaskExternalEffectSequenceConflictError) {
    return externalEffectError(operation, "sequenceMismatch", cause);
  }
  if (
    cause instanceof TaskExternalEffectRequestConflictError ||
    cause instanceof TaskExternalEffectLifecycleConflictError
  ) return externalEffectError(operation, "replayConflict", cause);
  if (cause instanceof TaskExternalEffectAuthorityCorruptionError) {
    return externalEffectError(operation, "invalidComposition", cause);
  }
  return externalEffectError(operation, "integrationFailure", cause);
}

function mapBindExternalEffectFailure(
  cause: ApplicationTaskMutationExternalEffectError,
) {
  switch (cause.reason) {
    case "invalidInput":
      return bindError("invalidInput", cause);
    case "staleLaunch":
      return bindError("staleLaunch", cause);
    case "invalidComposition":
    case "sequenceMismatch":
    case "replayConflict":
      return bindError("invalidComposition", cause);
    case "integrationFailure":
      return bindError("integrationFailure", cause);
  }
}

function mapSessionExternalEffectFailure(
  cause: ApplicationTaskMutationExternalEffectError,
): ApplicationTaskMutationCallbackSessionFailure {
  switch (cause.reason) {
    case "invalidInput":
    case "invalidComposition":
      return sessionFailureValue("invalidInput", cause);
    case "staleLaunch":
      return sessionFailureValue("staleLaunch", cause);
    case "sequenceMismatch":
      return sessionFailureValue("sequenceMismatch", cause);
    case "replayConflict":
      return sessionFailureValue("replayConflict", cause);
    case "integrationFailure":
      return sessionFailureValue("outcomeUncertain", cause);
  }
}

function mapMutationFailure(
  cause: Effect.Error<
    ReturnType<ApplicationMutationSystemApi["invokeAuthenticatedAtTaskLaunch"]>
  >,
): ApplicationTaskMutationCallbackSessionFailure {
  return cause instanceof ApplicationTaskMutationLaunchError
    ? sessionFailureValue(
        cause.reason === "staleLaunch" ? "staleLaunch" : "invalidInput",
        cause,
      )
    : sessionFailureValue("outcomeUncertain", cause);
}

function reconcileMutationDisposition(
  external: ApplicationTaskMutationExternalEffectSession,
  progress: MutationReconciliationProgress,
  exit: Exit.Exit<
    TaskMutationResult,
    ApplicationTaskMutationCallbackSessionFailure
  >,
): Effect.Effect<
  TaskMutationResult,
  ApplicationTaskMutationCallbackSessionFailure
> {
  if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
  const input = progress.input;
  if (input === null) return Effect.failCause(exit.cause);
  return external.reconcile(input).pipe(
    Effect.mapError(mapSessionExternalEffectFailure),
    Effect.catchCause(reconciliationCause =>
      Effect.failCause(Cause.combine(exit.cause, reconciliationCause))
    ),
    Effect.flatMap(receipt => {
      if (receipt.kind === "missing") return Effect.failCause(exit.cause);
      switch (receipt.effect.state) {
        case "failed_before_dispatch":
          return Effect.failCause(exit.cause);
        case "uncertain":
          return sessionFailure("outcomeUncertain");
        case "confirmed": {
          const outcome = progress.outcome;
          return outcome !== null &&
              receipt.effect.outcomeSha256 !== null &&
              bytesEqualFullScan(
                receipt.effect.outcomeSha256,
                outcome.sha256,
              )
            ? Effect.succeed(outcome.value)
            : sessionFailure("replayConflict");
        }
      }
    }),
  );
}

function captureHashDigest(
  input: unknown,
): Result.Result<
  Uint8Array,
  ApplicationTaskMutationCallbackSessionFailure
> {
  if (!isUint8ArrayWithByteLength(input, 32)) {
    return Result.fail(sessionFailureValue("mutationFailed"));
  }
  return Result.try({
    try: () => copyBytes(input),
    catch: cause => sessionFailureValue("mutationFailed", cause),
  });
}

function externalEffectError(
  operation: ApplicationTaskMutationExternalEffectError["operation"],
  reason: ApplicationTaskMutationExternalEffectFailureReason,
  cause?: unknown,
): ApplicationTaskMutationExternalEffectError {
  return new ApplicationTaskMutationExternalEffectError({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function bindError(
  reason: ApplicationTaskMutationCallbackBindError["reason"],
  cause?: unknown,
): ApplicationTaskMutationCallbackBindError {
  return new ApplicationTaskMutationCallbackBindError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function sessionFailure(
  reason: ApplicationTaskMutationCallbackSessionFailure["reason"],
): Effect.Effect<never, ApplicationTaskMutationCallbackSessionFailure> {
  return Effect.fail(sessionFailureValue(reason));
}

function sessionFailureValue(
  reason: ApplicationTaskMutationCallbackSessionFailure["reason"],
  _cause?: unknown,
): ApplicationTaskMutationCallbackSessionFailure {
  return Object.freeze({ reason });
}
