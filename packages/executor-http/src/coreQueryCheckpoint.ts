import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import {
  CORE_QUERY_CHECKPOINT_MAXIMUM_REQUEST_BYTES, CORE_QUERY_CHECKPOINT_MAXIMUM_RESPONSE_BYTES,
  CORE_QUERY_CHECKPOINT_MAXIMUM_ELAPSED_MILLISECONDS,
  coreQueryCheckpointPath, decodeCoreQueryCheckpointRequest, encodeCoreQueryCheckpointResponse,
  type CoreQueryCheckpointRequest, type CoreQueryCheckpointResponse,
} from "flarex-protocol/internal/core-query-checkpoint";
import type { CoreApplicationRouteIdentity } from "flarex-protocol/internal/core-application";
import { CoreApplicationTransportError, captureCoreApplicationHttpBounds, readCoreApplicationJsonBody } from "./coreApplication";

const utf8 = new TextEncoder();
const failure = (code: string, message: string, status: number) => Response.json({
  format: "flarex.core-application.failure", version: 1, error: { code, message },
}, { status });

/** The body reader owns fallible cancellation. Race only its Exit waiter so
 * RC.112 loser cleanup cannot discard that completed reader Cause. */
const readCheckpointBody = Effect.fn("CoreQueryCheckpointHttp.readBody")((
  request: Request, maximumBytes: number,
): Effect.Effect<unknown, CoreApplicationTransportError> => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
  const body = yield* Effect.forkChild(restore(readCoreApplicationJsonBody(request, maximumBytes)));
  const waited = yield* Effect.exit(restore(Effect.raceFirst(
    Fiber.await(body).pipe(Effect.map(exit => ({ kind: "body" as const, exit }))),
    Effect.sleep(CORE_QUERY_CHECKPOINT_MAXIMUM_ELAPSED_MILLISECONDS).pipe(Effect.andThen(Effect.fiberId),
      Effect.map(interruptor => ({ kind: "deadline" as const, interruptor }))),
  )));
  if (Exit.isFailure(waited)) {
    yield* Fiber.interrupt(body);
    const completed = yield* Fiber.await(body);
    return yield* Effect.failCause(Exit.isFailure(completed)
      ? Cause.combine(waited.cause, completed.cause) : waited.cause);
  }
  if (waited.value.kind === "body") {
    const completed = waited.value.exit;
    if (Exit.isFailure(completed)) return yield* Effect.failCause(completed.cause);
    return completed.value;
  }
  const interruptor = waited.value.interruptor;
  yield* Fiber.interruptAs(body, interruptor);
  const completed = yield* Fiber.await(body);
  if (Exit.isFailure(completed)) {
    const ownExpiry = completed.cause.reasons.length > 0 && completed.cause.reasons.every(reason =>
      Cause.isInterruptReason(reason) && reason.fiberId === interruptor);
    if (!ownExpiry) return yield* Effect.failCause(completed.cause);
  }
  return yield* new CoreApplicationTransportError({ reason: "bodyReadFailed" });
})));

/** The canonical Application owner retains authorization, generation and result disclosure. */
export function makeCoreQueryCheckpointHttpHandler<Failure, Requirements>(configuration: Readonly<{
  route: CoreApplicationRouteIdentity;
  authorize: (request: Request) => Effect.Effect<boolean, Failure, Requirements>;
  execute: (request: CoreQueryCheckpointRequest) => Effect.Effect<CoreQueryCheckpointResponse, Failure, Requirements>;
  maximumRequestBytes: number;
  maximumResponseBytes: number;
}>) {
  const bounds = captureCoreApplicationHttpBounds(configuration);
  const path = coreQueryCheckpointPath(configuration.route.deploymentId);
  const maximumRequestBytes = Math.min(bounds.maximumRequestBytes, CORE_QUERY_CHECKPOINT_MAXIMUM_REQUEST_BYTES);
  const maximumResponseBytes = Math.min(bounds.maximumResponseBytes, CORE_QUERY_CHECKPOINT_MAXIMUM_RESPONSE_BYTES);
  const handle = Effect.fn("CoreQueryCheckpointHttp.handle")(function* (request: Request) {
    if (!(yield* configuration.authorize(request))) return failure("unauthorized", "Executor capability is required.", 401);
    if (new URL(request.url).pathname !== path) return failure("not_found", "Unknown checkpoint route.", 404);
    if (request.method !== "POST") return failure("method_not_allowed", "Checkpoint reads require POST.", 405);
    const started = yield* Clock.monotonicTimeNanos;
    const body = yield* readCheckpointBody(request, maximumRequestBytes);
    const input = yield* Effect.fromResult(decodeCoreQueryCheckpointRequest(body)).pipe(Effect.mapError(cause =>
      new CoreApplicationTransportError({ reason: "invalidRequest", cause })));
    if (input.route.deploymentId !== configuration.route.deploymentId || input.route.scopeUuid !== configuration.route.scopeUuid)
      return failure("scope_mismatch", "The checkpoint selector does not match this application.", 403);
    const elapsed = Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000;
    const remaining = Math.floor(input.maximumElapsedMilliseconds - elapsed);
    if (remaining < 1) return failure("checkpoint_timeout", "The checkpoint read deadline expired.", 503);
    const output = yield* Effect.fromResult(encodeCoreQueryCheckpointResponse(yield* configuration.execute({ ...input,
      maximumElapsedMilliseconds: remaining }))).pipe(
      Effect.mapError(cause => new CoreApplicationTransportError({ reason: "invalidResponse", cause })));
    const encoded = JSON.stringify(output);
    if (utf8.encode(encoded).byteLength > maximumResponseBytes)
      return yield* new CoreApplicationTransportError({ reason: "responseTooLarge" });
    if (Number((yield* Clock.monotonicTimeNanos) - started) / 1_000_000 >= input.maximumElapsedMilliseconds)
      return failure("checkpoint_timeout", "The checkpoint read deadline expired.", 503);
    return new Response(encoded, { headers: { "content-type": "application/json" } });
  });
  return (request: Request) => handle(request).pipe(Effect.catchCause(cause => {
    const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
    if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreApplicationTransportError
      && (reason.error.reason === "invalidRequest" || reason.error.reason === "bodyTooLarge"))
      return Effect.succeed(failure(reason.error.reason === "bodyTooLarge" ? "body_too_large" : "invalid_request",
        "Checkpoint request body is invalid.", reason.error.reason === "bodyTooLarge" ? 413 : 400));
    return Effect.failCause(cause);
  }));
}
