import { RpcTarget } from "cloudflare:workers";
import { Cause, Effect, Exit, Option, Result } from "effect";
import type { TaskComputeExecutionIdV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";
import {
  APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
  APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
  MAX_APPLICATION_TASK_QUERY_CALLS_V1,
  MAX_APPLICATION_TASK_QUERY_CALL_ID_LENGTH_V1,
  MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1,
  decodeApplicationTaskQueryCallbackRequestV1,
  normalizeApplicationTaskQueryCallbackValueV1,
  type ApplicationTaskQueryCallbackCapabilityV1,
  type ApplicationTaskQueryCallbackFailureReasonV1,
  type ApplicationTaskQueryCallbackResultV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import type { ApplicationTaskRuntimeLaunchSubject } from
  "../taskRuntimeLaunch/Model";

export interface ApplicationTaskQueryCallbackSession {
  readonly runQuery: (
    functionPath: string,
    argumentsValue: CanonicalFlarexRuntimeValueV1,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    ApplicationTaskQueryCallbackSessionFailure
  >;
}

export interface ApplicationTaskQueryCallbackSessionFailure {
  readonly reason:
    | "invalidInput"
    | "activationUnavailable"
    | "invalidComposition"
    | "staleLaunch"
    | "queryFailed"
    | "invalidResult";
}

export interface ApplicationTaskQueryCallbackAuthority {
  readonly bindLaunch: (
    subject: Pick<
      ApplicationTaskRuntimeLaunchSubject,
      "creationAuthority" | "runtimeTarget" | "executionIdentity"
    >,
  ) => Result.Result<ApplicationTaskQueryCallbackSession, unknown>;
}

export interface ApplicationTaskQueryCallbackLease {
  readonly capability: ApplicationTaskQueryCallbackCapabilityV1;
  readonly close: () => void;
}

export interface ApplicationTaskQueryCallbackOptions {
  readonly executionId: TaskComputeExecutionIdV1;
  readonly absoluteTaskDeadlineMs: number;
  readonly maximumOperationMilliseconds?: number;
  readonly maximumCalls?: number;
  readonly maximumConcurrentCalls?: number;
  readonly now?: () => number;
}

class QueryCallbackTimeout {
  readonly _tag = "QueryCallbackTimeout";
}

export function makeApplicationTaskQueryCallbackCapability(
  session: ApplicationTaskQueryCallbackSession,
  options: ApplicationTaskQueryCallbackOptions,
): ApplicationTaskQueryCallbackLease {
  const maximumOperationMilliseconds = options.maximumOperationMilliseconds ??
    MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1;
  const maximumCalls = options.maximumCalls ?? MAX_APPLICATION_TASK_QUERY_CALLS_V1;
  const maximumConcurrentCalls = options.maximumConcurrentCalls ?? 1;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(maximumOperationMilliseconds) ||
    maximumOperationMilliseconds <= 0 || maximumOperationMilliseconds >
      MAX_APPLICATION_TASK_QUERY_MILLISECONDS_V1 ||
    !Number.isSafeInteger(maximumCalls) || maximumCalls <= 0 ||
    maximumCalls > MAX_APPLICATION_TASK_QUERY_CALLS_V1 ||
    !Number.isSafeInteger(maximumConcurrentCalls) ||
    maximumConcurrentCalls <= 0 || maximumConcurrentCalls > maximumCalls ||
    !Number.isSafeInteger(options.absoluteTaskDeadlineMs) ||
    options.absoluteTaskDeadlineMs <= 0 ||
    !/^[\x21-\x7e]{1,255}$/.test(options.executionId) ||
    `${options.executionId}:query:${maximumCalls}`.length >
      MAX_APPLICATION_TASK_QUERY_CALL_ID_LENGTH_V1) {
    throw new Error("Application Task query callback options are invalid.");
  }
  let closed = false;
  let ordinal = 0;
  let inFlight = 0;
  const pending = new Set<AbortController>();

  class ApplicationTaskQueryCallbackTarget extends RpcTarget
    implements ApplicationTaskQueryCallbackCapabilityV1
  {
    async invoke(input: unknown): Promise<ApplicationTaskQueryCallbackResultV1> {
      ordinal += 1;
      const callId = `${options.executionId}:query:${ordinal}`;
      const observedNow = Math.floor(now());
      const deadlineMs = Math.min(
        options.absoluteTaskDeadlineMs,
        observedNow + maximumOperationMilliseconds,
      );
      if (closed || ordinal > maximumCalls || deadlineMs <= observedNow) {
        return failureResult(
          callId,
          Math.max(1, deadlineMs),
          closed ? "interrupted" : ordinal > maximumCalls
            ? "resource_exceeded"
            : "timed_out",
        );
      }
      if (inFlight >= maximumConcurrentCalls) {
        return failureResult(callId, deadlineMs, "resource_exceeded");
      }
      inFlight += 1;
      let controller: AbortController | undefined;
      try {
        const request = decodeApplicationTaskQueryCallbackRequestV1(input);
        if (Result.isFailure(request)) {
          return failureResult(callId, deadlineMs, request.failure.reason ===
              "resource_exceeded"
            ? "resource_exceeded"
            : "invalid_request");
        }
        const queryStartedAt = Math.floor(now());
        if (deadlineMs <= queryStartedAt) {
          return failureResult(callId, deadlineMs, "timed_out");
        }
        controller = new AbortController();
        pending.add(controller);
        const result = await Effect.runPromiseExit(
          session.runQuery(request.success.functionPath, request.success.arguments).pipe(
            Effect.timeoutOrElse({
              duration: `${deadlineMs - queryStartedAt} millis`,
              orElse: () => Effect.fail(new QueryCallbackTimeout()),
            }),
          ),
          { signal: controller.signal },
        );
        if (Exit.isFailure(result)) {
          return failureResult(
            callId,
            deadlineMs,
            mapFailureReason(result.cause, closed),
          );
        }
        return normalizeApplicationTaskQueryCallbackValueV1(
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
                format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
                version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
                kind: "success" as const,
                callId,
                deadlineMs,
                value: normalized.value,
                valueSemanticBytes: normalized.semanticSizeBytes,
              }),
        }));
      } finally {
        if (controller !== undefined) pending.delete(controller);
        inFlight -= 1;
      }
    }

  }

  const target = new ApplicationTaskQueryCallbackTarget();
  return Object.freeze({
    capability: target,
    close: () => {
      if (closed) return;
      closed = true;
      for (const controller of pending) controller.abort();
      pending.clear();
    },
  });
}

function mapFailureReason(
  cause: Cause.Cause<
    ApplicationTaskQueryCallbackSessionFailure | QueryCallbackTimeout
  >,
  closed: boolean,
): ApplicationTaskQueryCallbackFailureReasonV1 {
  if (closed || Cause.hasInterruptsOnly(cause)) return "interrupted";
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    if (error.value instanceof QueryCallbackTimeout) return "timed_out";
    return mapSessionFailureReason(error.value.reason);
  }
  return "query_failed";
}

function mapSessionFailureReason(
  reason: ApplicationTaskQueryCallbackSessionFailure["reason"],
): ApplicationTaskQueryCallbackFailureReasonV1 {
  switch (reason) {
    case "staleLaunch": return "stale_launch";
    case "invalidResult": return "invalid_result";
    case "invalidInput": return "invalid_request";
    case "activationUnavailable":
    case "invalidComposition":
    case "queryFailed": return "query_failed";
    default: return absurdSessionFailureReason(reason);
  }
}

function absurdSessionFailureReason(reason: never): never {
  throw new Error(`Unhandled Application Task query failure: ${String(reason)}`);
}

function failureResult(
  callId: string,
  deadlineMs: number,
  reason: ApplicationTaskQueryCallbackFailureReasonV1,
): ApplicationTaskQueryCallbackResultV1 {
  return Object.freeze({
    format: APPLICATION_TASK_QUERY_CALLBACK_FORMAT_V1,
    version: APPLICATION_TASK_QUERY_CALLBACK_VERSION_V1,
    kind: "failure",
    callId,
    deadlineMs,
    reason,
  });
}
