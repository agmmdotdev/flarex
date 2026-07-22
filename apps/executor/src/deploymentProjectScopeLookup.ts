import {
  captureDeploymentProjectScopeLookupBudgetV1,
  decodeDeploymentProjectScopeLookupBudgetHeaderV1,
  decodeDeploymentProjectScopeLookupRequestV1,
  deploymentProjectScopeLookupBudgetFailureHeaderV1,
  deploymentProjectScopeLookupBudgetHeaderV1,
  deploymentProjectScopeLookupMediaTypeV1,
  encodeDeploymentProjectScopeLookupResponseV1,
  encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1,
  type DeploymentProjectScopeLookupBudgetV1,
  type DeploymentProjectScopeLookupResponseV1,
  type DeploymentProjectScopeLookupUsageV1,
} from "@flarex/executor-http/internal-deployment-project-scope-lookup-v1";
import type { PostgresClientFlarexPersistence } from "@flarex/persistence-postgres/postgres-client";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Cause, Clock, Data, Effect, Result } from "effect";

type DeploymentLookupPersistence = Pick<
  PostgresClientFlarexPersistence,
  "getDeploymentMetadata"
>;

type HostOperation = "request" | "lookup" | "response";

export interface DeploymentProjectScopeLookupHostResourceFailureV1 {
  readonly operation: HostOperation;
  readonly cause: unknown;
}

export interface DeploymentProjectScopeLookupHostOptionsV1 {
  readonly reportResourceFailure?: (
    failure: DeploymentProjectScopeLookupHostResourceFailureV1,
  ) => Effect.Effect<void, never, never>;
}

class DeploymentProjectScopeLookupHostInputV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupHostInputV1Error",
)<{
  readonly operation: HostOperation;
  readonly reason:
    | "methodNotAllowed"
    | "invalidContentType"
    | "invalidContentLength"
    | "bodyTooLarge"
    | "invalidBudget"
    | "invalidBody";
}> {}

class DeploymentProjectScopeLookupHostBudgetV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupHostBudgetV1Error",
)<{
  readonly operation: HostOperation;
  readonly field: keyof DeploymentProjectScopeLookupUsageV1;
}> {}

class DeploymentProjectScopeLookupHostResourceV1Error extends Data.TaggedError(
  "DeploymentProjectScopeLookupHostResourceV1Error",
)<{
  readonly operation: HostOperation;
}> {}

type DeploymentProjectScopeLookupHostV1Error =
  | DeploymentProjectScopeLookupHostInputV1Error
  | DeploymentProjectScopeLookupHostBudgetV1Error
  | DeploymentProjectScopeLookupHostResourceV1Error;

const resourceCauseByError = new WeakMap<
  DeploymentProjectScopeLookupHostResourceV1Error,
  unknown
>();

export function makeDeploymentProjectScopeLookupHostV1(
  persistence: DeploymentLookupPersistence,
  options: DeploymentProjectScopeLookupHostOptionsV1 = {},
): (request: Request) => Promise<Response> {
  const route = Effect.fn("DeploymentProjectScopeLookupHost.route")(
    function* (
      request: Request,
    ): Effect.fn.Return<Response, DeploymentProjectScopeLookupHostV1Error> {
      if (request.method !== "POST") {
        return yield* new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "methodNotAllowed",
        });
      }
      if (request.headers.get("content-type") !== deploymentProjectScopeLookupMediaTypeV1) {
        return yield* new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "invalidContentType",
        });
      }
      const budget = yield* Effect.fromResult(
        decodeDeploymentProjectScopeLookupBudgetHeaderV1(
          request.headers.get(deploymentProjectScopeLookupBudgetHeaderV1),
        ),
      ).pipe(
        Effect.mapError(() => new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "invalidBudget",
        })),
      );
      const startedAt = yield* Clock.currentTimeNanos;
      yield* requireElapsedBudget(startedAt, budget, "request");
      const contentLength = yield* decodeContentLength(request.headers.get("content-length"));
      if (contentLength !== null && contentLength > budget.maximumBodyBytes) {
        return yield* new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "bodyTooLarge",
        });
      }
      const bodyDeadline = yield* remainingElapsedBudget(startedAt, budget, "request");
      const requestBytes = yield* readBoundedBody(
        request.body,
        budget.maximumBodyBytes,
      ).pipe(
        Effect.timeout(`${bodyDeadline} millis`),
        Effect.mapError((error) => Cause.isTimeoutError(error)
          ? new DeploymentProjectScopeLookupHostBudgetV1Error({
              operation: "request",
              field: "elapsedMilliseconds",
            })
          : error),
      );
      const decodedRequest = yield* Effect.fromResult(
        decodeDeploymentProjectScopeLookupRequestV1(requestBytes, budget),
      ).pipe(
        Effect.mapError(() => new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "invalidBody",
        })),
      );
      const usageBeforeLookup = decodedRequest.usage;
      yield* requireAvailableLookup(usageBeforeLookup, budget);
      yield* requireElapsedBudget(startedAt, budget, "lookup");
      const lookupDeadline = yield* remainingElapsedBudget(startedAt, budget, "lookup");
      const deployment = yield* Effect.tryPromise({
        try: () => persistence.getDeploymentMetadata(decodedRequest.value.deploymentId),
        catch: (cause) => resourceFailure("lookup", cause),
      }).pipe(
        Effect.timeout(`${lookupDeadline} millis`),
        Effect.mapError((error) => Cause.isTimeoutError(error)
          ? new DeploymentProjectScopeLookupHostBudgetV1Error({
              operation: "lookup",
              field: "elapsedMilliseconds",
            })
          : error),
      );
      const usageAfterLookup = addUsage(usageBeforeLookup, {
        lookupCalls: 1,
        inputBytes: 0,
        bodyBytes: 0,
        canonicalBytes: 0,
        frameBytes: 0,
        elapsedMilliseconds: 0,
      });
      const responseValue: DeploymentProjectScopeLookupResponseV1 = deployment === null
        ? Object.freeze({
            codecVersion: 1,
            kind: "notFound",
            deploymentId: decodedRequest.value.deploymentId,
          })
        : deployment.projectId !== decodedRequest.value.projectId
          ? Object.freeze({
              codecVersion: 1,
              kind: "projectMismatch",
              deploymentId: decodedRequest.value.deploymentId,
            })
          : Object.freeze({
              codecVersion: 1,
              kind: "matched",
              deploymentId: deployment.deploymentId,
              projectId: deployment.projectId,
              deploymentCreatedAt: deployment.createdAt.toISOString(),
            });
      yield* requireElapsedBudget(startedAt, budget, "response");
      const remaining = yield* remainingBudget(budget, usageAfterLookup, "response");
      const encoded = yield* Effect.fromResult(
        encodeDeploymentProjectScopeLookupResponseV1(responseValue, remaining),
      ).pipe(
        Effect.mapError((error) => new DeploymentProjectScopeLookupHostBudgetV1Error({
          operation: "response",
          field: codecBudgetField(error.field),
        })),
      );
      const finalElapsed = elapsedMilliseconds(startedAt, yield* Clock.currentTimeNanos);
      yield* requireUsageWithin(
        addUsage(usageAfterLookup, {
          ...encoded.usage,
          elapsedMilliseconds: finalElapsed,
        }),
        budget,
        "response",
      );
      return new Response(copyBytesToArrayBuffer(encoded.bytes), {
        status: responseStatus(responseValue),
        headers: {
          "content-type": deploymentProjectScopeLookupMediaTypeV1,
        },
      });
    },
  );

  return (request) => Effect.runPromise(
    route(request).pipe(
      Effect.catch((error) => Effect.gen(function* () {
        if (error instanceof DeploymentProjectScopeLookupHostResourceV1Error) {
          const reporter = options.reportResourceFailure;
          if (reporter !== undefined) {
            yield* reporter(Object.freeze({
              operation: error.operation,
              cause: resourceCauseByError.get(error),
            }));
          }
        }
        return hostErrorResponse(error);
      })),
    ),
  );
}

function decodeContentLength(
  value: string | null,
): Effect.Effect<number | null, DeploymentProjectScopeLookupHostInputV1Error> {
  if (value === null) return Effect.succeed(null);
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    return Effect.fail(new DeploymentProjectScopeLookupHostInputV1Error({
      operation: "request",
      reason: "invalidContentLength",
    }));
  }
  const decoded = Number(value);
  return isNonNegativeSafeInteger(decoded)
    ? Effect.succeed(decoded)
    : Effect.fail(new DeploymentProjectScopeLookupHostInputV1Error({
        operation: "request",
        reason: "invalidContentLength",
      }));
}

function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBodyBytes: number,
): Effect.Effect<Uint8Array, DeploymentProjectScopeLookupHostV1Error> {
  return Effect.tryPromise({
    try: (signal) => readBoundedBodyPromise(body, maximumBodyBytes, signal),
    catch: (cause) => cause instanceof BodyTooLargeError
      ? new DeploymentProjectScopeLookupHostInputV1Error({
          operation: "request",
          reason: "bodyTooLarge",
        })
      : resourceFailure("request", cause),
  });
}

async function readBoundedBodyPromise(
  body: ReadableStream<Uint8Array> | null,
  maximumBodyBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reads = 0;
  const maximumReads = maximumBodyBytes === Number.MAX_SAFE_INTEGER
    ? Number.MAX_SAFE_INTEGER
    : maximumBodyBytes + 1;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      reads += 1;
      if (reads > maximumReads) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      const chunk = new Uint8Array(next.value);
      const candidate = total + chunk.byteLength;
      if (!Number.isSafeInteger(candidate) || candidate > maximumBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      if (chunk.byteLength > 0) chunks.push(chunk);
      total = candidate;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

class BodyTooLargeError extends Error {}

function requireAvailableLookup(
  usage: DeploymentProjectScopeLookupUsageV1,
  budget: DeploymentProjectScopeLookupBudgetV1,
): Effect.Effect<void, DeploymentProjectScopeLookupHostBudgetV1Error> {
  return usage.lookupCalls < budget.maximumLookupCalls
    ? Effect.succeed(undefined)
    : Effect.fail(new DeploymentProjectScopeLookupHostBudgetV1Error({
        operation: "lookup",
        field: "lookupCalls",
      }));
}

function remainingBudget(
  budget: DeploymentProjectScopeLookupBudgetV1,
  usage: DeploymentProjectScopeLookupUsageV1,
  operation: HostOperation,
): Effect.Effect<
  DeploymentProjectScopeLookupBudgetV1,
  DeploymentProjectScopeLookupHostBudgetV1Error
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
  const result = captureDeploymentProjectScopeLookupBudgetV1(remaining);
  return Result.isSuccess(result)
    ? Effect.succeed(result.success)
    : Effect.fail(new DeploymentProjectScopeLookupHostBudgetV1Error({
        operation,
        field: "bodyBytes",
      }));
}

function requireElapsedBudget(
  startedAt: bigint,
  budget: DeploymentProjectScopeLookupBudgetV1,
  operation: HostOperation,
): Effect.Effect<void, DeploymentProjectScopeLookupHostBudgetV1Error> {
  return Effect.gen(function* () {
    const elapsed = elapsedMilliseconds(startedAt, yield* Clock.currentTimeNanos);
    if (elapsed > budget.maximumElapsedMilliseconds) {
      return yield* new DeploymentProjectScopeLookupHostBudgetV1Error({
        operation,
        field: "elapsedMilliseconds",
      });
    }
  });
}

function remainingElapsedBudget(
  startedAt: bigint,
  budget: DeploymentProjectScopeLookupBudgetV1,
  operation: HostOperation,
): Effect.Effect<number, DeploymentProjectScopeLookupHostBudgetV1Error> {
  return Effect.gen(function* () {
    const remaining = budget.maximumElapsedMilliseconds - elapsedMilliseconds(
      startedAt,
      yield* Clock.currentTimeNanos,
    );
    if (remaining < 1) {
      return yield* new DeploymentProjectScopeLookupHostBudgetV1Error({
        operation,
        field: "elapsedMilliseconds",
      });
    }
    return remaining;
  });
}

function elapsedMilliseconds(startedAt: bigint, endedAt: bigint): number {
  const elapsed = endedAt - startedAt;
  if (elapsed <= 0n) return 0;
  const milliseconds = elapsed / 1_000_000n;
  return milliseconds > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(milliseconds);
}

function addUsage(
  left: DeploymentProjectScopeLookupUsageV1,
  right: DeploymentProjectScopeLookupUsageV1,
): DeploymentProjectScopeLookupUsageV1 {
  const added = {
    lookupCalls: checkedAdd(left.lookupCalls, right.lookupCalls),
    inputBytes: checkedAdd(left.inputBytes, right.inputBytes),
    bodyBytes: checkedAdd(left.bodyBytes, right.bodyBytes),
    canonicalBytes: checkedAdd(left.canonicalBytes, right.canonicalBytes),
    frameBytes: checkedAdd(left.frameBytes, right.frameBytes),
    elapsedMilliseconds: checkedAdd(
      left.elapsedMilliseconds,
      right.elapsedMilliseconds,
    ),
  };
  return Object.freeze(added);
}

function checkedAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error("Deployment-scope lookup usage overflowed.");
  }
  return sum;
}

function requireUsageWithin(
  usage: DeploymentProjectScopeLookupUsageV1,
  budget: DeploymentProjectScopeLookupBudgetV1,
  operation: HostOperation,
): Effect.Effect<void, DeploymentProjectScopeLookupHostBudgetV1Error> {
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
      return Effect.fail(new DeploymentProjectScopeLookupHostBudgetV1Error({
        operation,
        field,
      }));
    }
  }
  return Effect.succeed(undefined);
}

function responseStatus(value: DeploymentProjectScopeLookupResponseV1): number {
  switch (value.kind) {
    case "matched": return 200;
    case "notFound": return 404;
    case "projectMismatch": return 409;
    case "resourceFailure": return 503;
  }
}

function hostErrorResponse(error: DeploymentProjectScopeLookupHostV1Error): Response {
  if (error instanceof DeploymentProjectScopeLookupHostInputV1Error) {
    return Response.json(
      { error: "invalid_deployment_scope_lookup" },
      { status: error.reason === "methodNotAllowed" ? 405 : 400 },
    );
  }
  if (error instanceof DeploymentProjectScopeLookupHostBudgetV1Error) {
    const encodedField = encodeDeploymentProjectScopeLookupBudgetFailureHeaderV1(
      error.field,
    );
    if (Result.isFailure(encodedField)) {
      throw new Error("Validated deployment-scope budget field lost protocol membership.");
    }
    return Response.json(
      { error: "deployment_scope_lookup_budget_exhausted" },
      {
        status: 422,
        headers: {
          [deploymentProjectScopeLookupBudgetFailureHeaderV1]: encodedField.success,
        },
      },
    );
  }
  return Response.json({ error: "deployment_scope_lookup_unavailable" }, { status: 503 });
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
  operation: HostOperation,
  cause: unknown,
): DeploymentProjectScopeLookupHostResourceV1Error {
  const error = new DeploymentProjectScopeLookupHostResourceV1Error({ operation });
  resourceCauseByError.set(error, cause);
  return error;
}
