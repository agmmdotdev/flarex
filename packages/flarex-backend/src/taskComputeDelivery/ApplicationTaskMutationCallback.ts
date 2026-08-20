import { RpcTarget } from "cloudflare:workers";
import { Cause, Data, Deferred, Effect, Exit, Option, Result } from "effect";
import type { TaskComputeExecutionIdV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
  MAX_APPLICATION_TASK_MUTATION_CALLS_V1,
  MAX_APPLICATION_TASK_MUTATION_CALL_ID_LENGTH_V1,
  MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1,
  decodeApplicationTaskMutationCallbackRequestV1,
  normalizeApplicationTaskMutationCallbackValueV1,
  type ApplicationTaskMutationCallbackCapabilityV1,
  type ApplicationTaskMutationCallbackFailureReasonV1,
  type ApplicationTaskMutationCallbackResultV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import type { ApplicationTaskRuntimeLaunchSubject } from
  "../taskRuntimeLaunch/Model";

export interface ApplicationTaskMutationCallbackSession {
  /**
   * Bound for revoking this launch and settling every admitted mutation.
   * The concrete authority owns the database cancellation/disposition proof.
   */
  readonly maximumCloseMilliseconds: number;
  readonly runMutation: (
    ordinal: bigint,
    functionPath: string,
    argumentsValue: CanonicalFlarexRuntimeValueV1,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationTaskMutationCallbackSessionFailure
  >;
  readonly close: Effect.Effect<
    void,
    ApplicationTaskMutationCallbackSessionFailure
  >;
}

export interface ApplicationTaskMutationCallbackSessionFailure {
  readonly reason:
    | "invalidInput"
    | "staleLaunch"
    | "sequenceMismatch"
    | "replayConflict"
    | "mutationFailed"
    | "outcomeUncertain"
    | "invalidResult"
    | "resourceExceeded";
}

export interface ApplicationTaskMutationCallbackAuthority {
  readonly bindLaunch: (
    subject: Pick<
      ApplicationTaskRuntimeLaunchSubject,
      "request" | "creationAuthority" | "runtimeTarget" | "executionIdentity"
    >,
  ) => Effect.Effect<
    ApplicationTaskMutationCallbackSession,
    ApplicationTaskMutationCallbackBindError
  >;
}

export class ApplicationTaskMutationCallbackBindError extends Data.TaggedError(
  "ApplicationTaskMutationCallbackBindError",
)<{
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "staleLaunch"
    | "integrationFailure";
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskMutationCallbackLease {
  readonly capability: ApplicationTaskMutationCallbackCapabilityV1;
  readonly maximumCloseMilliseconds: number;
  readonly close: Effect.Effect<
    void,
    ApplicationTaskMutationCallbackSessionFailure
  >;
}

export interface ApplicationTaskMutationCallbackOptions {
  readonly executionId: TaskComputeExecutionIdV1;
  readonly absoluteTaskDeadlineMs: number;
  readonly maximumOperationMilliseconds?: number;
  readonly maximumCalls?: number;
  readonly now?: () => number;
}

class MutationCallbackTimeout {
  readonly _tag = "MutationCallbackTimeout";
}

export function makeApplicationTaskMutationCallbackCapability(
  session: ApplicationTaskMutationCallbackSession,
  options: ApplicationTaskMutationCallbackOptions,
): ApplicationTaskMutationCallbackLease {
  const sessionOwner = session;
  const runMutation = session.runMutation;
  const closeSession = session.close;
  const maximumOperationMilliseconds = options.maximumOperationMilliseconds ??
    MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1;
  const maximumCalls = options.maximumCalls ??
    MAX_APPLICATION_TASK_MUTATION_CALLS_V1;
  const maximumConcurrentCalls = 1;
  const maximumCloseMilliseconds = session.maximumCloseMilliseconds;
  const now = options.now ?? Date.now;
  if (!isPositiveSafeInteger(maximumOperationMilliseconds) ||
    maximumOperationMilliseconds >
      MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1 ||
    !isPositiveSafeInteger(maximumCalls) ||
    maximumCalls > MAX_APPLICATION_TASK_MUTATION_CALLS_V1 ||
    !isPositiveSafeInteger(maximumCloseMilliseconds) ||
    maximumCloseMilliseconds >
      MAX_APPLICATION_TASK_MUTATION_MILLISECONDS_V1 ||
    !isPositiveSafeInteger(options.absoluteTaskDeadlineMs) ||
    !/^[\x21-\x7e]{1,255}$/.test(options.executionId) ||
    `${options.executionId}:mutation:${maximumCalls}`.length >
      MAX_APPLICATION_TASK_MUTATION_CALL_ID_LENGTH_V1) {
    throw new Error("Application Task mutation callback options are invalid.");
  }
  let closed = false;
  let invocationOrdinal = 0;
  let inFlight = 0;
  const pending = new Set<AbortController>();
  const pendingOperations = new Set<Promise<unknown>>();
  let closeStarted = false;
  const closeCompletion = Deferred.makeUnsafe<
    void,
    ApplicationTaskMutationCallbackSessionFailure
  >();

  class ApplicationTaskMutationCallbackTarget extends RpcTarget
    implements ApplicationTaskMutationCallbackCapabilityV1
  {
    async invoke(input: unknown): Promise<ApplicationTaskMutationCallbackResultV1> {
      invocationOrdinal += 1;
      const callId = `${options.executionId}:mutation:${invocationOrdinal}`;
      const observedNow = Math.floor(now());
      const deadlineMs = Math.min(
        options.absoluteTaskDeadlineMs,
        observedNow + maximumOperationMilliseconds,
      );
      if (closed || invocationOrdinal > maximumCalls || deadlineMs <= observedNow) {
        return failureResult(
          callId,
          Math.max(1, deadlineMs),
          closed ? "interrupted" : invocationOrdinal > maximumCalls
            ? "resource_exceeded"
            : "timed_out",
        );
      }
      if (inFlight >= maximumConcurrentCalls) {
        return failureResult(callId, deadlineMs, "resource_exceeded");
      }
      inFlight += 1;
      let controller: AbortController | undefined;
      let trackedOperation: Promise<unknown> | undefined;
      try {
        const request = decodeApplicationTaskMutationCallbackRequestV1(input);
        if (Result.isFailure(request)) {
          return failureResult(
            callId,
            deadlineMs,
            request.failure.reason === "resource_exceeded"
              ? "resource_exceeded"
              : "invalid_request",
          );
        }
        if (request.success.ordinal !== BigInt(invocationOrdinal)) {
          return failureResult(callId, deadlineMs, "sequence_mismatch");
        }
        const mutationStartedAt = Math.floor(now());
        if (deadlineMs <= mutationStartedAt) {
          return failureResult(callId, deadlineMs, "timed_out");
        }
        controller = new AbortController();
        pending.add(controller);
        const operation = Effect.runPromiseExit(
          runMutation.call(
            sessionOwner,
            request.success.ordinal,
            request.success.functionPath,
            request.success.arguments,
          ).pipe(Effect.timeoutOrElse({
            duration: `${deadlineMs - mutationStartedAt} millis`,
            orElse: () => Effect.fail(new MutationCallbackTimeout()),
          })),
          { signal: controller.signal },
        );
        trackedOperation = operation;
        pendingOperations.add(operation);
        const result = await operation;
        if (Exit.isFailure(result)) {
          return failureResult(
            callId,
            deadlineMs,
            mapFailureReason(result.cause),
          );
        }
        return normalizeApplicationTaskMutationCallbackValueV1(
          result.value,
          "result",
        ).pipe(Result.match({
          onFailure: cause => failureResult(
            callId,
            deadlineMs,
            cause.reason === "resource_exceeded"
              ? "resource_exceeded"
              : "invalid_result",
          ),
          onSuccess: normalized => deadlineMs <= Math.floor(now())
            ? failureResult(callId, deadlineMs, "timed_out")
            : Object.freeze({
                format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
                version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
                kind: "success" as const,
                callId,
                deadlineMs,
                value: normalized.value,
                valueSemanticBytes: normalized.semanticSizeBytes,
              }),
        }));
      } finally {
        if (controller !== undefined) pending.delete(controller);
        if (trackedOperation !== undefined) {
          pendingOperations.delete(trackedOperation);
        }
        inFlight -= 1;
      }
    }
  }

  const target = new ApplicationTaskMutationCallbackTarget();
  const close = Effect.uninterruptibleMask(restore => Effect.suspend(() => {
    if (closeStarted) return restore(Deferred.await(closeCompletion));
    closeStarted = true;
    closed = true;
    for (const controller of pending) controller.abort();
    pending.clear();
    const settle = Effect.all([
      Effect.exit(closeSession),
      Effect.promise(() => Promise.all(Array.from(pendingOperations))).pipe(
        Effect.asVoid,
      ),
    ], { concurrency: "unbounded" }).pipe(
      Effect.flatMap(([sessionClose]) => Exit.match(sessionClose, {
        onFailure: Effect.failCause,
        onSuccess: () => Effect.void,
      })),
      Effect.onExit(exit => Deferred.done(closeCompletion, exit)),
      Effect.interruptible,
    );
    return Effect.forkDetach(settle, {
      startImmediately: true,
      uninterruptible: false,
    }).pipe(
      Effect.andThen(restore(Deferred.await(closeCompletion))),
    );
  }));
  return Object.freeze({
    capability: target,
    maximumCloseMilliseconds,
    close,
  });
}

function mapFailureReason(
  cause: Cause.Cause<
    ApplicationTaskMutationCallbackSessionFailure | MutationCallbackTimeout
  >,
): ApplicationTaskMutationCallbackFailureReasonV1 {
  if (Cause.hasInterruptsOnly(cause)) return "interrupted";
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    if (error.value instanceof MutationCallbackTimeout) return "timed_out";
    return mapSessionFailureReason(error.value.reason);
  }
  return "mutation_failed";
}

function mapSessionFailureReason(
  reason: ApplicationTaskMutationCallbackSessionFailure["reason"],
): ApplicationTaskMutationCallbackFailureReasonV1 {
  switch (reason) {
    case "invalidInput": return "invalid_request";
    case "staleLaunch": return "stale_launch";
    case "sequenceMismatch": return "sequence_mismatch";
    case "replayConflict": return "replay_conflict";
    case "mutationFailed": return "mutation_failed";
    case "outcomeUncertain": return "outcome_uncertain";
    case "invalidResult": return "invalid_result";
    case "resourceExceeded": return "resource_exceeded";
    default: return absurdSessionFailureReason(reason);
  }
}

function absurdSessionFailureReason(reason: never): never {
  throw new Error(`Unhandled Application Task mutation failure: ${String(reason)}`);
}

function failureResult(
  callId: string,
  deadlineMs: number,
  reason: ApplicationTaskMutationCallbackFailureReasonV1,
): ApplicationTaskMutationCallbackResultV1 {
  return Object.freeze({
    format: APPLICATION_TASK_MUTATION_CALLBACK_FORMAT_V1,
    version: APPLICATION_TASK_MUTATION_CALLBACK_VERSION_V1,
    kind: "failure",
    callId,
    deadlineMs,
    reason,
  });
}
