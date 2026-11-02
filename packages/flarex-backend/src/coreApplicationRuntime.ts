import { Cause, Data, Effect, Schema } from "effect";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import {
  coreApplicationArgumentsFromJson,
  coreApplicationValueToJson,
  type CoreApplicationControl,
  type CoreApplicationCoreProfile,
} from "flarex-protocol/internal/core-application";
import type { CoreActiveDeploymentStatus } from "flarex-protocol/deployment";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import {
  CoreApplicationTransportError,
  lookupCoreApplicationControl,
  makeCoreApplicationClient,
  makeCoreApplicationDeploymentClient,
} from "@flarex/executor-http/internal/core-application";
import { HttpError } from "./http";
import { BackendCoreApplicationMetadataError } from "./publicCoreApplicationMetadata";
import type { Env, InvokeRequest } from "./types";

type CoreApplicationEnv = Pick<Env,
  "FLAREX_EXECUTOR" | "FLAREX_EXECUTOR_TOKEN" | "FLAREX_EXECUTOR_TRANSPORT">;

class BackendCoreApplicationError extends Data.TaggedError("BackendCoreApplicationError")<{
  readonly reason: "configuration" | "sourceMismatch" | "functionUnavailable" | "unsupportedKind" | "unsupportedPartition"
    | "invalidArguments" | "invalidRequestKey" | "invalidFunctionPath" | "subscriptionsUnsupported";
  readonly cause?: unknown;
}> {}

const decodeFunctionPath = Schema.decodeUnknownEffect(TransactionFunctionPathV1Schema);
const decodeRequestKey = Schema.decodeUnknownEffect(TransactionRequestKeyV1Schema);

function transportFor(env: CoreApplicationEnv) {
  const binding = env.FLAREX_EXECUTOR;
  const capabilityToken = env.FLAREX_EXECUTOR_TOKEN;
  if (binding === undefined || capabilityToken === undefined || capabilityToken.trim().length === 0)
    return Effect.fail(new BackendCoreApplicationError({ reason: "configuration" }));
  return Effect.succeed({
    transport: { fetch: (request: Request) => binding.fetch(request) },
    capabilityToken,
  });
}

/** Transport capability is explicit; a failed Core lookup never selects legacy execution. */
export const lookupBackendCoreApplication = Effect.fn("BackendCoreApplication.lookup")(function* (
  env: CoreApplicationEnv,
  deploymentId: string,
) {
  if (env.FLAREX_EXECUTOR_TRANSPORT === undefined || env.FLAREX_EXECUTOR_TRANSPORT === "legacy_session")
    return undefined;
  if (env.FLAREX_EXECUTOR_TRANSPORT !== "core_application")
    return yield* new BackendCoreApplicationError({ reason: "configuration" });
  const options = yield* transportFor(env);
  const control = yield* lookupCoreApplicationControl({ ...options, deploymentId });
  return control.kind === "core" ? control : undefined;
});

export const makeBackendCoreApplicationDeploymentClient = Effect.fn("BackendCoreApplication.deploymentClient")(function* (
  env: CoreApplicationEnv,
  control: Extract<CoreApplicationControl, { readonly kind: "core" }>,
) {
  return makeCoreApplicationDeploymentClient({ ...(yield* transportFor(env)), deploymentId: control.route.deploymentId,
    expectedRoute: control.route });
});

/** The public caller has already resolved deployment and bearer/trusted identity. */
export const invokeBackendCoreApplication = Effect.fn("BackendCoreApplication.invoke")(function* (
  env: CoreApplicationEnv,
  profile: CoreApplicationCoreProfile,
  deployment: CoreActiveDeploymentStatus,
  request: InvokeRequest,
  argumentsJson: unknown,
  auth: ExecutionIdentity,
) {
  if (profile.sourcePackageHash !== deployment.sourcePackageHash)
    return yield* new BackendCoreApplicationError({ reason: "sourceMismatch" });
  if (request.partitionKey !== undefined)
    return yield* new BackendCoreApplicationError({ reason: "unsupportedPartition" });
  const metadata = deployment.analysis.functions.functions.find(fn => fn.path === request.path);
  // Core resolves durable mutation correlation before inferring current kind.
  // A keyed query without an explicit kind retains ordinary query behavior.
  const kind = request.kind ?? (request.idempotencyKey === undefined ? metadata?.kind : "infer");
  if (kind === undefined)
    return yield* new BackendCoreApplicationError({ reason: "functionUnavailable" });
  if (kind !== "query" && kind !== "mutation" && kind !== "infer")
    return yield* new BackendCoreApplicationError({ reason: "unsupportedKind" });
  const functionPath = yield* decodeFunctionPath(request.path).pipe(
    Effect.mapError(cause => new BackendCoreApplicationError({ reason: "invalidFunctionPath", cause })),
  );
  // One outer key survives the complete call; Core alone owns replay and retries.
  const keyInput = request.idempotencyKey ?? (yield* Effect.sync(() => crypto.randomUUID()));
  const requestKey = yield* decodeRequestKey(keyInput).pipe(
    Effect.mapError(cause => new BackendCoreApplicationError({ reason: "invalidRequestKey", cause })),
  );
  const args = yield* Effect.fromResult(coreApplicationArgumentsFromJson(argumentsJson)).pipe(
    Effect.mapError(cause => new BackendCoreApplicationError({ reason: "invalidArguments", cause })),
  );
  const options = yield* transportFor(env);
  const result = yield* makeCoreApplicationClient({ ...options, profile }).invoke({
    kind, functionPath, args, auth, requestKey,
  });
  const value = yield* Effect.fromResult(coreApplicationValueToJson(result.value));
  // Direct HTTP invocation needs the value. Exact Core evaluation remains with
  // its own protocol; do not manufacture legacy readSet/readTs/committedTs.
  return { value };
});

/** A registered Core app cannot evaluate subscriptions against the legacy store. */
export const assertLegacySubscriptionApplication = Effect.fn("BackendCoreApplication.assertLegacySubscription")(function* (
  env: CoreApplicationEnv,
  deploymentId: string,
) {
  if ((yield* lookupBackendCoreApplication(env, deploymentId)) !== undefined)
    return yield* new BackendCoreApplicationError({ reason: "subscriptionsUnsupported" });
});

export const projectBackendCoreApplicationErrors = <Value, Failure>(
  effect: Effect.Effect<Value, Failure | BackendCoreApplicationError | BackendCoreApplicationMetadataError | CoreApplicationTransportError>,
) => effect.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error => {
  if (error instanceof CoreApplicationTransportError) {
    const status = error.reason === "httpFailure" && error.status !== undefined && error.status >= 400 && error.status <= 599
      ? error.status : 503;
    return Object.assign(new HttpError(status, error.message || "Core application executor request failed."), { cause: error });
  }
  if (error instanceof BackendCoreApplicationMetadataError)
    return Object.assign(new HttpError(503, "Core application deployment metadata is unavailable."), { cause: error });
  if (!(error instanceof BackendCoreApplicationError)) return error;
  switch (error.reason) {
    case "configuration": return new HttpError(503, "Core application executor is not configured.");
    case "sourceMismatch": return new HttpError(409, "Active application source does not match its Core registration.");
    case "functionUnavailable": return new HttpError(404, "Core application function is unavailable.");
    case "unsupportedKind": return new HttpError(400, "Core application execution supports queries and mutations.");
    case "unsupportedPartition": return new HttpError(400, "Core application execution does not admit partition routing.");
    case "invalidArguments": return new HttpError(400, "Invalid Core application arguments.");
    case "invalidRequestKey": return new HttpError(400, "Invalid Core application request key.");
    case "invalidFunctionPath": return new HttpError(400, "Invalid Core application function path.");
    case "subscriptionsUnsupported": return new HttpError(409, "Core application subscriptions require the Core evaluation transport.");
  }
}))));
