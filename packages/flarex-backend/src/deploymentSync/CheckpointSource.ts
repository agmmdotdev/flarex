import { CheckpointError, type CheckpointSource } from "@flarex/query-sync/internal/checkpoint";
import { Effect, Result, Schema } from "effect";
import { decodeCoreApplicationFailure, type CoreApplicationRouteIdentity } from "flarex-protocol/internal/core-application";
import { coreQueryCheckpointPath, decodeCoreQueryCheckpointResponse, encodeCoreQueryCheckpointRequest,
  CORE_QUERY_CHECKPOINT_MAXIMUM_RESPONSE_BYTES } from "flarex-protocol/internal/core-query-checkpoint";
import { readBackendBoundedBody } from "../boundedBody";
import { executorRequestUrl, fetchExecutorRequest, type ExecutorHttpEnv } from "../executorHttp";

const failure = (reason: CheckpointError["reason"], cause?: unknown) => new CheckpointError({ reason, cause });
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decoder = new TextDecoder("utf-8", { fatal: true });

export function makeDeploymentCheckpointSource(env: ExecutorHttpEnv, suppliedRoute: CoreApplicationRouteIdentity): CheckpointSource {
  const route = Object.freeze({ ...suppliedRoute });
  const selectedEnv: ExecutorHttpEnv = Object.freeze({
    ...(env.FLAREX_EXECUTOR === undefined ? {} : { FLAREX_EXECUTOR: env.FLAREX_EXECUTOR }),
    ...(env.FLAREX_EXECUTOR_URL === undefined ? {} : { FLAREX_EXECUTOR_URL: env.FLAREX_EXECUTOR_URL }),
    ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { FLAREX_EXECUTOR_TOKEN: env.FLAREX_EXECUTOR_TOKEN }),
  });
  return Object.freeze({ certify: Effect.fn("DeploymentCheckpointSource.certify")(function* (
    input: Parameters<CheckpointSource["certify"]>[0],
  ) {
    const token = selectedEnv.FLAREX_EXECUTOR_TOKEN;
    if (token === undefined || token.length === 0 || selectedEnv.FLAREX_EXECUTOR === undefined && selectedEnv.FLAREX_EXECUTOR_URL === undefined)
      return yield* failure("sourceUnavailable");
    const url = yield* Effect.try({ try: () => executorRequestUrl(selectedEnv.FLAREX_EXECUTOR_URL, coreQueryCheckpointPath(route.deploymentId)),
      catch: cause => failure("sourceUnavailable", cause) });
    const request = yield* Effect.fromResult(encodeCoreQueryCheckpointRequest({
      format: "flarex.core-query-checkpoint.request", version: 1, route,
      after: input.checkpoint?.position.toString() ?? null, sourceId: input.checkpoint?.sourceId ?? null,
      maximumElapsedMilliseconds: input.maximumElapsedMilliseconds,
    })).pipe(Effect.mapError(cause => failure("invalidCheckpoint", cause)));
    // Acquisition owns the pending request immediately, even before headers arrive.
    const acquire = Effect.try({ try: () => {
      const controller = new AbortController();
      const pending: Promise<Result.Result<Response, unknown>> = fetchExecutorRequest(selectedEnv, new Request(url, { method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(request), signal: controller.signal }))
        .then(value => Result.succeed(value), (cause: unknown) => Result.fail(cause));
      return { controller, pending, observedFailure: false };
    }, catch: cause => failure("sourceUnavailable", cause) });
    return yield* Effect.acquireUseRelease(acquire, owned => Effect.gen(function* () {
      const acquired = yield* Effect.promise(() => owned.pending);
      const response = yield* Effect.fromResult(acquired.pipe(Result.mapError(cause => {
        owned.observedFailure = true;
        return failure("sourceUnavailable", cause);
      })));
      const bytes = yield* readBackendBoundedBody(response.body, CORE_QUERY_CHECKPOINT_MAXIMUM_RESPONSE_BYTES, {
        limitExceeded: () => failure("invalidEvidence"), resourceFailure: cause => failure("sourceUnavailable", cause),
      });
      if (!response.ok && response.status !== 409) return yield* failure("sourceUnavailable");
      const text = yield* Effect.try({ try: () => decoder.decode(bytes), catch: cause => failure("invalidEvidence", cause) });
      const json = yield* decodeJson(text).pipe(Effect.mapError(cause => failure("invalidEvidence", cause)));
      if (!response.ok) {
        const refused = decodeCoreApplicationFailure(json);
        return yield* failure(Result.isSuccess(refused) && refused.success.error.code === "invalid_checkpoint"
          ? "invalidCheckpoint" : "sourceUnavailable");
      }
      const value = yield* Effect.fromResult(decodeCoreQueryCheckpointResponse(json))
        .pipe(Effect.mapError(cause => failure("invalidEvidence", cause)));
      if (value.route.deploymentId !== route.deploymentId || value.route.scopeUuid !== route.scopeUuid
        || value.after !== request.after) return yield* failure("invalidEvidence");
      if (value.kind === "sourceReplaced") {
        if (value.route.epochUuid === route.epochUuid && (request.sourceId === null || value.sourceId === request.sourceId))
          return yield* failure("invalidEvidence");
        return { kind: "resetRequired" as const, reason: "sourceReplaced" as const };
      }
      if (value.route.epochUuid !== route.epochUuid || request.sourceId !== null && value.sourceId !== request.sourceId)
        return yield* failure("invalidEvidence");
      if (value.kind === "historyUnavailable") return { kind: "resetRequired" as const, reason: "historyUnavailable" as const };
      return { kind: "certified" as const, certificate: Object.freeze({ namespaceId: route.scopeUuid,
        sourceId: value.sourceId, after: value.after === null ? null : BigInt(value.after),
        retainedFrom: BigInt(value.retainedFrom), through: BigInt(value.through) }) };
    }), owned => Effect.gen(function* () {
      // One lifetime signals and drains the same Fetch. Its intentional abort
      // rejection is cancellation; a distinct late provider failure is retained.
      owned.controller.abort();
      const settled = yield* Effect.promise(() => owned.pending);
      if (Result.isFailure(settled)) {
        if (!owned.observedFailure && settled.failure !== owned.controller.signal.reason)
          return yield* failure("sourceUnavailable", settled.failure);
        return;
      }
      const response = settled.success;
      const body = response.body;
      // The shared reader owns every disturbed body, including its failed exit.
      // Only an unused late response remains this acquisition's responsibility.
      if (!response.bodyUsed && body !== null)
        yield* Effect.tryPromise({ try: () => body.cancel(), catch: cause => failure("sourceUnavailable", cause) });
    }));
  }) });
}
