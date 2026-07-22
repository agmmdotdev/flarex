import {
  captureDeploymentProjectScopeLookupBudgetV1,
  decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1,
  decodeDeploymentProjectScopeLookupResponseV1,
  deploymentProjectScopeLookupBudgetFailureHeaderV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  deploymentProjectScopeLookupPathV1,
  encodeDeploymentProjectScopeLookupBudgetHeaderV1,
  encodeDeploymentProjectScopeLookupRequestV1,
  type DeploymentProjectScopeLookupBudgetV1,
  type DeploymentProjectScopeLookupUsageV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Cause, Clock, Data, Effect, Result } from "effect";

import {
  executorRequestUrl,
  fetchExecutorRequest,
  type ExecutorHttpEnv,
} from "./executorHttp";
import { readBackendBoundedBody } from "./boundedBody";

export interface DeploymentProjectScopeLookupInputV1 {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly budget: DeploymentProjectScopeLookupBudgetV1;
}

export interface DeploymentProjectScopeLookupMatchV1 {
  readonly deploymentId: string;
  readonly projectId: string;
  readonly deploymentCreatedAt: string;
  readonly usage: DeploymentProjectScopeLookupUsageV1;
}

export interface DeploymentProjectScopeLookupClientV1 {
  readonly lookup: (
    input: DeploymentProjectScopeLookupInputV1,
  ) => Effect.Effect<
    DeploymentProjectScopeLookupMatchV1,
    | DeploymentProjectScopeLookupNotFoundV1Error
    | DeploymentProjectScopeLookupProjectMismatchV1Error
    | DeploymentProjectScopeLookupResourceV1Error
    | DeploymentProjectScopeLookupCorruptionV1Error
    | DeploymentProjectScopeLookupBudgetV1Error,
    never
  >;
}

export class DeploymentProjectScopeLookupConfigurationV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupConfigurationV1Error",
)<{
  readonly reason:
    | "missingExecutor"
    | "missingExecutorServiceBinding"
    | "missingExecutorToken"
    | "invalidExecutorUrl";
}> {}

export class DeploymentProjectScopeLookupNotFoundV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupNotFoundV1Error",
)<{
  readonly deploymentId: string;
}> {}

export class DeploymentProjectScopeLookupProjectMismatchV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupProjectMismatchV1Error",
)<{
  readonly deploymentId: string;
}> {}

export class DeploymentProjectScopeLookupResourceV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupResourceV1Error",
)<{
  readonly operation: "fetch" | "readBody" | "executor";
}> {}

export class DeploymentProjectScopeLookupCorruptionV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupCorruptionV1Error",
)<{
  readonly reason:
    | "invalidContentType"
    | "invalidContentLength"
    | "malformedResponse"
    | "statusMismatch"
    | "identityMismatch";
}> {}

export class DeploymentProjectScopeLookupBudgetV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupBudgetV1Error",
)<{
  readonly field: keyof DeploymentProjectScopeLookupUsageV1;
}> {}

const resourceCauseByError = new WeakMap<
  DeploymentProjectScopeLookupResourceV1Error,
  unknown
>();

export function makeDeploymentProjectScopeLookupClientV1(
  env: ExecutorHttpEnv,
): Result.Result<
  DeploymentProjectScopeLookupClientV1,
  DeploymentProjectScopeLookupConfigurationV1Error
> {
  if (env.FLAREX_EXECUTOR === undefined && !isNonBlankString(env.FLAREX_EXECUTOR_URL)) {
    return Result.fail(new DeploymentProjectScopeLookupConfigurationV1Error({
      reason: "missingExecutor",
    }));
  }
  if (!isNonBlankString(env.FLAREX_EXECUTOR_TOKEN)) {
    return Result.fail(new DeploymentProjectScopeLookupConfigurationV1Error({
      reason: "missingExecutorToken",
    }));
  }
  let url: string;
  try {
    url = executorRequestUrl(
      env.FLAREX_EXECUTOR_URL,
      deploymentProjectScopeLookupPathV1,
    );
  } catch {
    return Result.fail(new DeploymentProjectScopeLookupConfigurationV1Error({
      reason: "invalidExecutorUrl",
    }));
  }
  const token = env.FLAREX_EXECUTOR_TOKEN;
  const capturedEnv = Object.freeze({
    ...(env.FLAREX_EXECUTOR === undefined ? {} : { FLAREX_EXECUTOR: env.FLAREX_EXECUTOR }),
    ...(env.FLAREX_EXECUTOR_URL === undefined
      ? {}
      : { FLAREX_EXECUTOR_URL: env.FLAREX_EXECUTOR_URL }),
    FLAREX_EXECUTOR_TOKEN: token,
  }) satisfies ExecutorHttpEnv;

  const lookup = Effect.fn("DeploymentProjectScopeLookupClient.lookup")(
    function* (
      input: DeploymentProjectScopeLookupInputV1,
    ): Effect.fn.Return<
      DeploymentProjectScopeLookupMatchV1,
      | DeploymentProjectScopeLookupNotFoundV1Error
      | DeploymentProjectScopeLookupProjectMismatchV1Error
      | DeploymentProjectScopeLookupResourceV1Error
      | DeploymentProjectScopeLookupCorruptionV1Error
      | DeploymentProjectScopeLookupBudgetV1Error
    > {
      const budget = yield* Effect.fromResult(
        captureDeploymentProjectScopeLookupBudgetV1(input.budget),
      ).pipe(
        Effect.mapError(() => new DeploymentProjectScopeLookupBudgetV1Error({
          field: "inputBytes",
        })),
      );
      const startedAt = yield* Clock.currentTimeNanos;
      const encodedRequest = yield* Effect.fromResult(
        encodeDeploymentProjectScopeLookupRequestV1({
          codecVersion: 1,
          deploymentId: input.deploymentId,
          projectId: input.projectId,
        }, budget),
      ).pipe(
        Effect.mapError((error) => new DeploymentProjectScopeLookupBudgetV1Error({
          field: codecBudgetField(error.field),
        })),
      );
      if (budget.maximumLookupCalls < 1) {
        return yield* new DeploymentProjectScopeLookupBudgetV1Error({
          field: "lookupCalls",
        });
      }
      const usageBeforeResponse = Object.freeze({
        ...encodedRequest.usage,
        lookupCalls: 1,
      }) satisfies DeploymentProjectScopeLookupUsageV1;
      const remaining = yield* remainingBudget(budget, usageBeforeResponse);
      const budgetHeader = yield* Effect.fromResult(
        encodeDeploymentProjectScopeLookupBudgetHeaderV1(budget),
      ).pipe(
        Effect.mapError(() => new DeploymentProjectScopeLookupBudgetV1Error({
          field: "bodyBytes",
        })),
      );
      const request = new Request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": deploymentProjectScopeLookupMediaTypeV1,
          [deploymentProjectScopeLookupBudgetHeaderV1]: budgetHeader,
        },
        body: copyBytesToArrayBuffer(encodedRequest.bytes),
      });
      yield* requireElapsed(startedAt, budget);
      const fetchDeadline = yield* remainingElapsedMilliseconds(startedAt, budget);
      const response = yield* Effect.tryPromise({
        try: (signal) => fetchExecutorRequest(
          capturedEnv,
          new Request(request, { signal }),
        ),
        catch: (cause) => resourceFailure("fetch", cause),
      }).pipe(
        Effect.timeout(`${fetchDeadline} millis`),
        Effect.mapError((error) => Cause.isTimeoutError(error)
          ? new DeploymentProjectScopeLookupBudgetV1Error({
              field: "elapsedMilliseconds",
            })
          : error),
      );
      if (response.status === 422) {
        const exhaustedField = decodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(
          response.headers.get(deploymentProjectScopeLookupBudgetFailureHeaderV1),
        );
        if (Result.isFailure(exhaustedField)) {
          return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
            reason: "malformedResponse",
          });
        }
        return yield* new DeploymentProjectScopeLookupBudgetV1Error({
          field: exhaustedField.success,
        });
      }
      if ([401, 500, 502, 503, 504].includes(response.status)) {
        return yield* resourceFailure("executor", response.status);
      }
      if (response.status === 400 || response.status === 405) {
        return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
          reason: "malformedResponse",
        });
      }
      if (response.headers.get("content-type") !== deploymentProjectScopeLookupMediaTypeV1) {
        return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
          reason: "invalidContentType",
        });
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
          return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
            reason: "invalidContentLength",
          });
        }
        const parsed = Number(contentLength);
        if (!Number.isSafeInteger(parsed) || parsed > remaining.maximumBodyBytes) {
          return yield* new DeploymentProjectScopeLookupBudgetV1Error({
            field: "bodyBytes",
          });
        }
      }
      const bodyDeadline = yield* remainingElapsedMilliseconds(startedAt, budget);
      const responseBytes = yield* readBackendBoundedBody(
        response.body,
        remaining.maximumBodyBytes,
        {
          limitExceeded: () => new DeploymentProjectScopeLookupBudgetV1Error({
            field: "bodyBytes",
          }),
          resourceFailure: cause => resourceFailure("readBody", cause),
        },
      ).pipe(
        Effect.timeout(`${bodyDeadline} millis`),
        Effect.mapError((error) => Cause.isTimeoutError(error)
          ? new DeploymentProjectScopeLookupBudgetV1Error({
              field: "elapsedMilliseconds",
            })
          : error),
      );
      const decoded = yield* Effect.fromResult(
        decodeDeploymentProjectScopeLookupResponseV1(responseBytes, remaining),
      ).pipe(
        Effect.mapError((error) => error.reason === "budgetExhausted"
          ? new DeploymentProjectScopeLookupBudgetV1Error({
              field: codecBudgetField(error.field),
            })
          : new DeploymentProjectScopeLookupCorruptionV1Error({
              reason: "malformedResponse",
            })),
      );
      yield* requireStatus(response.status, decoded.value.kind);
      if (decoded.value.deploymentId !== input.deploymentId) {
        return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
          reason: "identityMismatch",
        });
      }
      const elapsedMilliseconds = elapsed(
        startedAt,
        yield* Clock.currentTimeNanos,
      );
      const usage = yield* combineUsage(
        usageBeforeResponse,
        decoded.usage,
        elapsedMilliseconds,
        budget,
      );
      switch (decoded.value.kind) {
        case "notFound":
          return yield* new DeploymentProjectScopeLookupNotFoundV1Error({
            deploymentId: input.deploymentId,
          });
        case "projectMismatch":
          return yield* new DeploymentProjectScopeLookupProjectMismatchV1Error({
            deploymentId: input.deploymentId,
          });
        case "resourceFailure":
          return yield* resourceFailure("executor", decoded.value.kind);
        case "matched":
          if (decoded.value.projectId !== input.projectId) {
            return yield* new DeploymentProjectScopeLookupCorruptionV1Error({
              reason: "identityMismatch",
            });
          }
          return Object.freeze({
            deploymentId: decoded.value.deploymentId,
            projectId: decoded.value.projectId,
            deploymentCreatedAt: decoded.value.deploymentCreatedAt,
            usage,
          });
      }
    },
  );

  return Result.succeed(Object.freeze({ lookup }));
}

export function deploymentProjectScopeLookupResourceCauseV1(
  error: DeploymentProjectScopeLookupResourceV1Error,
): unknown {
  return resourceCauseByError.get(error);
}

function remainingBudget(
  budget: DeploymentProjectScopeLookupBudgetV1,
  usage: DeploymentProjectScopeLookupUsageV1,
): Effect.Effect<
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupBudgetV1Error
> {
  const remaining = {
    maximumLookupCalls: budget.maximumLookupCalls - usage.lookupCalls,
    maximumInputBytes: budget.maximumInputBytes - usage.inputBytes,
    maximumBodyBytes: budget.maximumBodyBytes - usage.bodyBytes,
    maximumCanonicalBytes: budget.maximumCanonicalBytes - usage.canonicalBytes,
    maximumFrameBytes: budget.maximumFrameBytes - usage.frameBytes,
    maximumElapsedMilliseconds:
      budget.maximumElapsedMilliseconds - usage.elapsedMilliseconds,
  };
  const captured = captureDeploymentProjectScopeLookupBudgetV1(remaining);
  return Result.isSuccess(captured)
    ? Effect.succeed(captured.success)
    : Effect.fail(new DeploymentProjectScopeLookupBudgetV1Error({ field: "bodyBytes" }));
}

function combineUsage(
  request: DeploymentProjectScopeLookupUsageV1,
  response: DeploymentProjectScopeLookupUsageV1,
  elapsedMilliseconds: number,
  budget: DeploymentProjectScopeLookupBudgetV1,
): Effect.Effect<
  DeploymentProjectScopeLookupUsageV1,
  DeploymentProjectScopeLookupBudgetV1Error
> {
  const usage = Object.freeze({
    lookupCalls: request.lookupCalls,
    inputBytes: checkedAdd(request.inputBytes, response.inputBytes),
    bodyBytes: checkedAdd(request.bodyBytes, response.bodyBytes),
    canonicalBytes: checkedAdd(request.canonicalBytes, response.canonicalBytes),
    frameBytes: checkedAdd(request.frameBytes, response.frameBytes),
    elapsedMilliseconds,
  });
  const pairs = [
    ["lookupCalls", usage.lookupCalls, budget.maximumLookupCalls],
    ["inputBytes", usage.inputBytes, budget.maximumInputBytes],
    ["bodyBytes", usage.bodyBytes, budget.maximumBodyBytes],
    ["canonicalBytes", usage.canonicalBytes, budget.maximumCanonicalBytes],
    ["frameBytes", usage.frameBytes, budget.maximumFrameBytes],
    ["elapsedMilliseconds", usage.elapsedMilliseconds, budget.maximumElapsedMilliseconds],
  ] as const;
  for (const [field, used, maximum] of pairs) {
    if (used > maximum) {
      return Effect.fail(new DeploymentProjectScopeLookupBudgetV1Error({ field }));
    }
  }
  return Effect.succeed(usage);
}

function requireElapsed(
  startedAt: bigint,
  budget: DeploymentProjectScopeLookupBudgetV1,
): Effect.Effect<void, DeploymentProjectScopeLookupBudgetV1Error> {
  return Effect.gen(function* () {
    if (elapsed(startedAt, yield* Clock.currentTimeNanos) > budget.maximumElapsedMilliseconds) {
      return yield* new DeploymentProjectScopeLookupBudgetV1Error({
        field: "elapsedMilliseconds",
      });
    }
  });
}

function remainingElapsedMilliseconds(
  startedAt: bigint,
  budget: DeploymentProjectScopeLookupBudgetV1,
): Effect.Effect<number, DeploymentProjectScopeLookupBudgetV1Error> {
  return Effect.gen(function* () {
    const remaining = budget.maximumElapsedMilliseconds - elapsed(
      startedAt,
      yield* Clock.currentTimeNanos,
    );
    if (remaining < 1) {
      return yield* new DeploymentProjectScopeLookupBudgetV1Error({
        field: "elapsedMilliseconds",
      });
    }
    return remaining;
  });
}

function elapsed(startedAt: bigint, endedAt: bigint): number {
  const difference = endedAt - startedAt;
  if (difference <= 0n) return 0;
  const milliseconds = difference / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function requireStatus(
  status: number,
  kind: "matched" | "notFound" | "projectMismatch" | "resourceFailure",
): Effect.Effect<void, DeploymentProjectScopeLookupCorruptionV1Error> {
  const expected = kind === "matched"
    ? 200
    : kind === "notFound"
      ? 404
      : kind === "projectMismatch"
        ? 409
        : 503;
  return status === expected
    ? Effect.succeed(undefined)
    : Effect.fail(new DeploymentProjectScopeLookupCorruptionV1Error({
        reason: "statusMismatch",
      }));
}

function checkedAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("Deployment-project scope lookup usage overflowed.");
  }
  return sum;
}

function codecBudgetField(
  field: string,
): keyof DeploymentProjectScopeLookupUsageV1 {
  switch (field) {
    case "lookupCalls": return "lookupCalls";
    case "inputBytes": return "inputBytes";
    case "canonicalBytes": return "canonicalBytes";
    case "frameBytes": return "frameBytes";
    case "elapsedMilliseconds": return "elapsedMilliseconds";
    default: return "bodyBytes";
  }
}

function resourceFailure(
  operation: DeploymentProjectScopeLookupResourceV1Error["operation"],
  cause: unknown,
): DeploymentProjectScopeLookupResourceV1Error {
  const error = new DeploymentProjectScopeLookupResourceV1Error({ operation });
  resourceCauseByError.set(error, cause);
  return error;
}
