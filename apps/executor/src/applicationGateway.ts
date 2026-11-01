import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import { CoreApplicationTransportError, decodeCoreApplicationJsonBody, readCoreApplicationBodyBytes } from
  "@flarex/executor-http/internal/core-application";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { encodeCoreApplicationProfile } from "flarex-protocol/internal/core-application";
import { readExecutorApplicationRegistry } from "./applicationConfiguration";
import { admitExecutorRequest, type ExecutorWorker, type ExecutorWorkerEnv } from "./requestLifecycle";

/** The gateway needs named routing and Fetch, not an app's database capabilities. */
export interface ExecutorApplicationGatewayEnv extends ExecutorWorkerEnv {
  readonly FLAREX_APPLICATION_PROFILES?: string;
  readonly APPLICATIONS?: Readonly<{
    getByName(name: string): Pick<Fetcher, "fetch">;
  }>;
}

const decodeLegacySelector = Schema.decodeUnknownResult(Schema.Struct({ deploymentId: Schema.String }));
const failure = (code: string, message: string, status: number) => Response.json({
  format: "flarex.core-application.failure", version: 1, error: { code, message },
}, { status });

/** The Fetch Promise edge retains failures, defects and cancellation as one Cause. */
export class ExecutorApplicationGatewayBodyError extends Data.TaggedError("ExecutorApplicationGatewayBodyError")<{
  readonly cause: Cause.Cause<CoreApplicationTransportError>;
}> {}

async function readExecutorLegacyRoutingBody(request: Request, maximumBytes: number) {
  const exit = await Effect.runPromiseExit(readCoreApplicationBodyBytes(request, maximumBytes).pipe(
    Effect.flatMap(bytes => Effect.fromResult(decodeCoreApplicationJsonBody(bytes)).pipe(
      Effect.map(json => ({ bytes, json })))),
  ), { signal: request.signal });
  if (Exit.isSuccess(exit)) return exit.value;
  const reason = exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined;
  if (reason !== undefined && Cause.isFailReason(reason) && reason.error instanceof CoreApplicationTransportError
    && (reason.error.reason === "invalidRequest" || reason.error.reason === "bodyTooLarge"))
    return failure(reason.error.reason === "bodyTooLarge" ? "body_too_large" : "invalid_request",
      "Invalid invocation body.", reason.error.reason === "bodyTooLarge" ? 413 : 400);
  throw new ExecutorApplicationGatewayBodyError({ cause: exit.cause });
}

/** Explicit Core/legacy routing is host admission, never a storage fallback. */
export function makeApplicationExecutorGateway(legacy: ExecutorWorker) {
  return {
    async fetch(request: Request, env: ExecutorApplicationGatewayEnv): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      const applicationRoute = pathname.startsWith("/applications/");
      const legacyInvocation = pathname.startsWith("/invoke/") && pathname !== "/invoke/abort-stale";
      if (!applicationRoute && !legacyInvocation) return legacy.fetch(request, env);

      const admission = admitExecutorRequest(request, env);
      if (Result.isFailure(admission)) return admission.failure;
      if (legacyInvocation && env.FLAREX_APPLICATION_PROFILES === undefined) return legacy.fetch(request, env);
      const registry = readExecutorApplicationRegistry(env);
      if (Result.isFailure(registry)) return failure("configuration", "Application routing is unavailable.", 503);

      if (legacyInvocation) {
        // Existing compatibility routes still decode their complete contracts.
        // This pre-resource check only prevents a Core app from entering them.
        const maximumBytes = registry.success.maximumLegacyRequestBytes;
        if (maximumBytes === undefined)
          return failure("storage_profile", "Session invocation is not admitted.", 409);
        const captured = await readExecutorLegacyRoutingBody(request, maximumBytes);
        if (captured instanceof Response) return captured;
        const selected = decodeLegacySelector(captured.json);
        if (Result.isFailure(selected)) return failure("invalid_request", "A deployment selector is required.", 400);
        const deploymentId = selected.success.deploymentId;
        if (registry.success.profiles.some(profile => profile.deploymentId === deploymentId))
          return failure("storage_profile", "This application requires whole-function invocation.", 409);
        if (!registry.success.legacyProfiles.some(profile => profile.deploymentId === deploymentId))
          return failure("application_unregistered", "The application storage profile is not registered.", 503);
        return legacy.fetch(new Request(request, { body: copyBytesToArrayBuffer(captured.bytes) }), env);
      }

      const matched = /^\/applications\/([^/]+)\/(profile|invoke|register)$/.exec(pathname);
      if (matched === null) return failure("not_found", "Unknown application route.", 404);
      let deploymentId: string;
      try { deploymentId = decodeURIComponent(matched[1] ?? ""); }
      catch (cause) {
        if (!(cause instanceof URIError)) throw cause;
        return failure("invalid_request", "Invalid application selector.", 400);
      }
      const operation = matched[2];
      const method = operation === "profile" ? "GET" : "POST";
      if (request.method !== method) return failure("method_not_allowed", "Unsupported application method.", 405);
      const profile = registry.success.profiles.find(candidate => candidate.deploymentId === deploymentId);
      if (profile === undefined) {
        const retained = registry.success.legacyProfiles.some(candidate => candidate.deploymentId === deploymentId);
        if (operation !== "profile" || !retained)
          return failure("application_unregistered", "The application storage profile is not registered.", 503);
        const encoded = encodeCoreApplicationProfile({ format: "flarex.core-application.profile", version: 1,
          kind: "legacy", deploymentId });
        return Result.isSuccess(encoded) ? Response.json(encoded.success)
          : failure("configuration", "Application routing is unavailable.", 503);
      }
      const namespace = env.APPLICATIONS;
      if (namespace === undefined) return failure("configuration", "Application routing is unavailable.", 503);
      // The DO checks the same canonical identity before constructing its owner.
      // Even profile reads enter that owner to authenticate persisted admission.
      return namespace.getByName(profile.canonicalName).fetch(request);
    },
  };
}
