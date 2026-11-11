import { Cause, Data, Effect, Result, Schema } from "effect";
import {
  coreApplicationInvocationPath, coreApplicationProfilePath, coreApplicationControlPath,
  coreApplicationDeploymentPath, coreApplicationPushStartPath, coreApplicationPushPath,
  decodeCoreApplicationFailure, decodeCoreApplicationInvocationRequest,
  decodeCoreApplicationInvocationSuccess, decodeCoreApplicationProfile,
  encodeCoreApplicationInvocationRequest, encodeCoreApplicationInvocationSuccess,
  type CoreApplicationCoreProfile, type CoreApplicationInvocationRequest,
  type CoreApplicationInvocationResult, type CoreApplicationInvocationSuccess,
  type CoreApplicationProfile, type CoreApplicationRouteIdentity,
  decodeCoreApplicationControl, decodeCoreApplicationCandidate, decodeCoreApplicationStartRequest,
  decodeCoreApplicationFinishRequest, decodeCoreApplicationAbandonRequest,
  type CoreApplicationControl, type CoreApplicationCandidate, type CoreApplicationStartRequest,
  type CoreApplicationFinishRequest, type CoreApplicationAbandonRequest,
} from "flarex-protocol/internal/core-application";

export class CoreApplicationTransportError extends Data.TaggedError("CoreApplicationTransportError")<{
  readonly reason: "invalidRequest" | "invalidResponse" | "bodyTooLarge" | "responseTooLarge" | "bodyReadFailed" | "requestFailed" | "httpFailure";
  readonly status?: number;
  readonly code?: string;
  readonly message?: string;
  readonly cause?: unknown;
}> {}
const error = (reason: CoreApplicationTransportError["reason"], cause?: unknown) => new CoreApplicationTransportError({ reason, cause });
const PositiveBytes = Schema.Int.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value > 0 ? undefined : "Expected a positive byte bound"));
const decodePositiveBytes = Schema.decodeUnknownSync(PositiveBytes);
const decodeCapabilityToken = Schema.decodeUnknownSync(Schema.String.check(Schema.isMinLength(1)));
const limits = Schema.decodeUnknownSync(Schema.Struct({ maximumRequestBytes: PositiveBytes, maximumResponseBytes: PositiveBytes }));
export const captureCoreApplicationHttpBounds = limits;
const defaultMaximumBytes = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Service-binding transport only; this owner never retries a function call. */
export interface CoreApplicationTransport {
  readonly fetch: (request: Request) => Promise<Response>;
}
interface ClientConfiguration {
  readonly transport: CoreApplicationTransport;
  readonly capabilityToken: string;
  readonly baseUrl?: string;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes?: number;
}
export type CoreApplicationClientInvocation = Pick<CoreApplicationInvocationRequest,
  "kind" | "functionPath" | "args" | "auth" | "requestKey">;

function sameRoute(left: CoreApplicationRouteIdentity, right: CoreApplicationRouteIdentity): boolean {
  return left.deploymentId === right.deploymentId && left.scopeUuid === right.scopeUuid && left.epochUuid === right.epochUuid;
}
const failure = (code: string, message: string, status: number) => Response.json({
  format: "flarex.core-application.failure", version: 1, error: { code, message },
}, { status });

/** The outer app owner owns authentication, runtime lifetime and failure projection. */
export function makeCoreApplicationHttpHandler<Failure, Requirements>(configuration: Readonly<{
  route: CoreApplicationRouteIdentity;
  authorize: (request: Request) => Effect.Effect<boolean, Failure, Requirements>;
  execute: (request: CoreApplicationInvocationRequest) => Effect.Effect<CoreApplicationInvocationResult, Failure, Requirements>;
  maximumRequestBytes: number;
  maximumResponseBytes: number;
  failureResponse?: (cause: Cause.Cause<Failure | CoreApplicationTransportError>) => Response;
}>) {
  const bounds = limits(configuration);
  const route = Object.freeze({ ...configuration.route });
  const handle = Effect.fn("CoreApplicationHttp.handle")(function* (request: Request) {
    if (!(yield* configuration.authorize(request))) return failure("unauthorized", "Executor capability is required.", 401);
    if (new URL(request.url).pathname !== coreApplicationInvocationPath(route.deploymentId))
      return failure("not_found", "Unknown application invocation route.", 404);
    if (request.method !== "POST") return failure("method_not_allowed", "Application invocation requires POST.", 405);
    const json = yield* readCoreApplicationJsonBody(request, bounds.maximumRequestBytes);
    const input = yield* Effect.fromResult(decodeCoreApplicationInvocationRequest(json)).pipe(
      Effect.mapError(cause => error("invalidRequest", cause)));
    const result = yield* configuration.execute(input);
    if (input.kind !== "infer" && result.kind !== input.kind) return yield* error("invalidResponse");
    const output = yield* Effect.fromResult(encodeCoreApplicationInvocationSuccess({ ...result,
      format: "flarex.core-application.response", version: 1, route,
      functionPath: input.functionPath, requestKey: input.requestKey })).pipe(
      Effect.mapError(cause => error("invalidResponse", cause)));
    const body = JSON.stringify(output);
    if (encoder.encode(body).byteLength > bounds.maximumResponseBytes) return yield* error("responseTooLarge");
    return new Response(body, { headers: { "content-type": "application/json" } });
  });
  return (request: Request): Effect.Effect<Response, Failure | CoreApplicationTransportError, Requirements> => {
    return handle(request).pipe(Effect.catchCause(cause => {
      const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
      if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreApplicationTransportError
        && (reason.error.reason === "invalidRequest" || reason.error.reason === "bodyTooLarge"))
        return Effect.succeed(failure(reason.error.reason === "bodyTooLarge" ? "body_too_large" : "invalid_request",
          "Application request body is invalid.", reason.error.reason === "bodyTooLarge" ? 413 : 400));
      return configuration.failureResponse === undefined ? Effect.failCause(cause)
        : Effect.succeed(configuration.failureResponse(cause));
    }));
  };
}

/** Reads actual streamed bytes; Content-Length is never an allocation authority. */
export const readCoreApplicationBodyBytes = Effect.fn("CoreApplicationHttp.readBodyBytes")(function* (
  message: Request | Response, maximumBytes: number,
) {
  const maximum = decodePositiveBytes(maximumBytes);
  const body = message.body;
  if (body === null) return new Uint8Array();
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    reader => Effect.gen(function* () {
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const item = yield* Effect.tryPromise({ try: () => reader.read(), catch: cause => error("bodyReadFailed", cause) });
        if (item.done) break;
        length += item.value.byteLength;
        if (length > maximum) return yield* error("bodyTooLarge");
        chunks.push(item.value);
      }
      const output = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
      return output;
    }),
    reader => Effect.tryPromise({ try: () => reader.cancel(),
      catch: cause => error("bodyReadFailed", cause) }).pipe(Effect.ensuring(Effect.sync(() => reader.releaseLock()))),
  );
});

/** Decode captured bytes without changing their representation for a forwarding owner. */
export function decodeCoreApplicationJsonBody(bytes: Uint8Array): Result.Result<unknown, CoreApplicationTransportError> {
  return Result.try({ try: (): unknown => JSON.parse(decoder.decode(bytes)), catch: cause => error("invalidRequest", cause) });
}

export const readCoreApplicationJsonBody = Effect.fn("CoreApplicationHttp.readJsonBody")(function* (
  message: Request | Response, maximumBytes: number,
) {
  return yield* Effect.fromResult(decodeCoreApplicationJsonBody(yield* readCoreApplicationBodyBytes(message, maximumBytes)));
});

function captureClient(configuration: ClientConfiguration) {
  const capabilityToken = decodeCapabilityToken(configuration.capabilityToken);
  const bounds = limits({ maximumRequestBytes: configuration.maximumRequestBytes ?? defaultMaximumBytes,
    maximumResponseBytes: configuration.maximumResponseBytes ?? defaultMaximumBytes });
  return Object.freeze({ ...configuration, ...bounds, capabilityToken,
    baseUrl: configuration.baseUrl ?? "https://flarex-executor.internal" });
}
const send = Effect.fn("CoreApplicationHttp.send")(function* (configuration: ReturnType<typeof captureClient>, pathname: string,
  body?: string,
) {
  if (body !== undefined && encoder.encode(body).byteLength > configuration.maximumRequestBytes) return yield* error("bodyTooLarge");
  const response = yield* Effect.tryPromise({ try: signal => configuration.transport.fetch(new Request(
    new URL(pathname, configuration.baseUrl), { method: body === undefined ? "GET" : "POST", signal,
      headers: { authorization: `Bearer ${configuration.capabilityToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body }) })), catch: cause => error("requestFailed", cause) });
  const captured = yield* readCoreApplicationJsonBody(response, configuration.maximumResponseBytes).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, readFailure => new CoreApplicationTransportError({
      reason: response.ok ? "invalidResponse" : "httpFailure", status: response.status, cause: readFailure })))));
  if (!response.ok) {
    const projected = decodeCoreApplicationFailure(captured);
    return yield* new CoreApplicationTransportError({ reason: "httpFailure", status: response.status,
      ...(Result.isSuccess(projected) ? { code: projected.success.error.code, message: projected.success.error.message }
        : { message: "Core application request failed." }) });
  }
  return captured;
});

export const lookupCoreApplicationProfile = Effect.fn("CoreApplicationHttp.lookupProfile")(function* (
  configuration: ClientConfiguration & Readonly<{ deploymentId: string; expectedRoute?: CoreApplicationRouteIdentity }>,
): Effect.fn.Return<CoreApplicationProfile, CoreApplicationTransportError> {
  const client = captureClient(configuration);
  const wire = yield* send(client, coreApplicationProfilePath(configuration.deploymentId));
  const profile = yield* Effect.fromResult(decodeCoreApplicationProfile(wire)).pipe(Effect.mapError(cause => error("invalidResponse", cause)));
  const deploymentId = profile.kind === "core" ? profile.route.deploymentId : profile.deploymentId;
  if (deploymentId !== configuration.deploymentId || (configuration.expectedRoute !== undefined
    && (profile.kind !== "core" || !sameRoute(profile.route, configuration.expectedRoute)))) return yield* error("invalidResponse");
  return profile;
});

/** Control inventory admits a configured target without claiming source readiness. */
export const lookupCoreApplicationControl = Effect.fn("CoreApplicationHttp.lookupControl")(function* (
  configuration: ClientConfiguration & Readonly<{ deploymentId: string }>,
): Effect.fn.Return<CoreApplicationControl, CoreApplicationTransportError> {
  const client = captureClient(configuration);
  const wire = yield* send(client, coreApplicationControlPath(configuration.deploymentId));
  const control = yield* Effect.fromResult(decodeCoreApplicationControl(wire)).pipe(
    Effect.mapError(cause => error("invalidResponse", cause)));
  const deploymentId = control.kind === "core" ? control.route.deploymentId : control.deploymentId;
  if (deploymentId !== configuration.deploymentId) return yield* error("invalidResponse");
  return control;
});

/** Explicit candidate operations; no installation or transport retry is implicit. */
export function makeCoreApplicationDeploymentClient(configuration: ClientConfiguration & Readonly<{
  deploymentId: string; expectedRoute?: CoreApplicationRouteIdentity;
}>) {
  const client = captureClient(configuration);
  const deploymentId = configuration.deploymentId;
  const expectedRoute = configuration.expectedRoute === undefined ? undefined : Object.freeze({ ...configuration.expectedRoute });
  const readCandidate = Effect.fn("CoreApplicationHttp.readCandidate")(function* (
    pathname: string, body?: string, expectedPushId?: string,
  ): Effect.fn.Return<CoreApplicationCandidate | null, CoreApplicationTransportError> {
    const wire = yield* send(client, pathname, body);
    if (wire === null) return null;
    const candidate = yield* Effect.fromResult(decodeCoreApplicationCandidate(wire)).pipe(
      Effect.mapError(cause => error("invalidResponse", cause)));
    if (candidate.route.deploymentId !== deploymentId || expectedRoute !== undefined && !sameRoute(candidate.route, expectedRoute)
      || expectedPushId !== undefined && candidate.pushId !== expectedPushId) return yield* error("invalidResponse");
    return candidate;
  });
  const requireCandidate = Effect.fn("CoreApplicationHttp.requireCandidate")(function* (
    pathname: string, body: string, expectedPushId?: string,
  ) {
    const candidate = yield* readCandidate(pathname, body, expectedPushId);
    return candidate === null ? yield* error("invalidResponse") : candidate;
  });
  return Object.freeze({
    start: Effect.fn("CoreApplicationHttp.start")(function* (sourcePackage: CoreApplicationStartRequest["sourcePackage"]) {
      const input = yield* Effect.fromResult(decodeCoreApplicationStartRequest({ sourcePackage })).pipe(
        Effect.mapError(cause => error("invalidRequest", cause)));
      return yield* requireCandidate(coreApplicationPushStartPath(deploymentId), JSON.stringify(input));
    }),
    read: (pushId: string) => readCandidate(coreApplicationPushPath(deploymentId, pushId), undefined, pushId),
    finish: Effect.fn("CoreApplicationHttp.finish")(function* (pushId: string, body: CoreApplicationFinishRequest = {}) {
      const input = yield* Effect.fromResult(decodeCoreApplicationFinishRequest(body)).pipe(
        Effect.mapError(cause => error("invalidRequest", cause)));
      const candidate = yield* requireCandidate(`${coreApplicationPushPath(deploymentId, pushId)}/finish`, JSON.stringify(input), pushId);
      if (input.activate !== false && candidate.state !== "active") return yield* error("invalidResponse");
      return candidate;
    }),
    abandon: Effect.fn("CoreApplicationHttp.abandon")(function* (pushId: string, body: CoreApplicationAbandonRequest = {}) {
      const input = yield* Effect.fromResult(decodeCoreApplicationAbandonRequest(body)).pipe(
        Effect.mapError(cause => error("invalidRequest", cause)));
      const candidate = yield* requireCandidate(`${coreApplicationPushPath(deploymentId, pushId)}/abandon`, JSON.stringify(input), pushId);
      return candidate.state === "abandoned" ? candidate : yield* error("invalidResponse");
    }),
    active: Effect.fn("CoreApplicationHttp.active")(function* () {
      const candidate = yield* readCandidate(coreApplicationDeploymentPath(deploymentId));
      return candidate === null || candidate.state === "active" ? candidate : yield* error("invalidResponse");
    }),
  });
}

export function makeCoreApplicationClient(configuration: ClientConfiguration & Readonly<{ profile: CoreApplicationCoreProfile }>) {
  const client = captureClient(configuration);
  const profile = Object.freeze({ ...configuration.profile, route: Object.freeze({ ...configuration.profile.route }) });
  return Object.freeze({ invoke: Effect.fn("CoreApplicationHttp.invoke")(function* (
    input: CoreApplicationClientInvocation,
  ): Effect.fn.Return<CoreApplicationInvocationSuccess, CoreApplicationTransportError> {
    const encoded = yield* Effect.fromResult(encodeCoreApplicationInvocationRequest({ ...input,
      format: "flarex.core-application.request", version: 1, sourceArtifactRootSha256: profile.sourceArtifactRootSha256,
      sourcePackageHash: profile.sourcePackageHash })).pipe(
      Effect.mapError(cause => error("invalidRequest", cause)));
    const wire = yield* send(client, coreApplicationInvocationPath(profile.route.deploymentId), JSON.stringify(encoded));
    const result = yield* Effect.fromResult(decodeCoreApplicationInvocationSuccess(wire)).pipe(
      Effect.mapError(cause => error("invalidResponse", cause)));
    if (!sameRoute(result.route, profile.route) || (input.kind !== "infer" && result.kind !== input.kind) || result.functionPath !== input.functionPath
      || result.requestKey !== input.requestKey) return yield* error("invalidResponse");
    return result;
  }) });
}
