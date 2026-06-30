import type { BackendExecutionArtifactStore } from "./artifactStore.ts";
import {
  ExecutionArtifactInvokePayloadError,
  executionArtifactInvokeRouteErrorToHttpError,
} from "./artifactRuntime/RouteBoundary.ts";
import {
  ExecutionArtifactRuntimeAuthorizationError,
  ExecutionArtifactRuntimeHeaderError,
  ExecutionArtifactRuntimeRouteNotFoundError,
  routeExecutionArtifactRuntimeInvoke,
  type ExecutionArtifactRuntimeRouteError,
} from "./artifactRuntime/RuntimeRoute.ts";
import {
  ExecutionArtifactRuntimeMissingSourcePackageError,
  ExecutionArtifactRuntimeOperationError,
} from "./artifactRuntime/Errors.ts";
import { Data, Effect } from "effect";
import { HttpError, readResponseJsonOrNullEffect, RequestJsonError } from "./http.ts";
import type {
  ActiveDeploymentStatus,
  InvokeRequest,
  InvokeResponse,
  Json,
  PushSourcePackage,
} from "./types.ts";

export type ExecutionArtifactInvokePayload = {
  deploymentId: string;
  ref: ActiveDeploymentStatus["executionArtifactRef"];
  sourcePackage?: PushSourcePackage;
  request: InvokeRequest;
};

export type MaterializedExecutionArtifactPayload =
  ExecutionArtifactInvokePayload & { sourcePackage: PushSourcePackage };

export type ExecutionArtifactQuerySessionRequest = {
  deploymentId: string;
  projectId?: string;
  path: string;
  args: Json;
  partitionKey?: string;
  sessionId: string;
};

export interface BackendExecutionArtifactRuntime {
  invoke(
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
  ): Promise<InvokeResponse>;
}

export interface MaterializedExecutionArtifact {
  invoke(payload: MaterializedExecutionArtifactPayload): Promise<InvokeResponse>;
  executeQuerySession?(
    payload: MaterializedExecutionArtifactPayload,
    request: ExecutionArtifactQuerySessionRequest,
  ): Promise<Json>;
  dispose?(): Promise<void> | void;
}

export interface ExecutionArtifactMaterializer {
  materialize(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact>;
}

export {
  ExecutionArtifactRuntimeMissingSourcePackageError,
  ExecutionArtifactRuntimeOperationError,
};

type ExecutionArtifactRuntimeHttpResponse = Pick<Response, "json" | "ok" | "status">;

export class ServiceBindingExecutionArtifactRuntimeResponseError extends Data.TaggedError(
  "ServiceBindingExecutionArtifactRuntimeResponseError",
)<{
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

export type ServiceBindingExecutionArtifactRuntimeError =
  | ExecutionArtifactRuntimeOperationError
  | ServiceBindingExecutionArtifactRuntimeResponseError;

export class CachedExecutionArtifactMaterializer {
  private readonly materializer: ExecutionArtifactMaterializer;
  private readonly cache = new Map<string, {
    sourcePackageHash: string;
    artifact: MaterializedExecutionArtifact;
  }>();

  constructor(materializer: ExecutionArtifactMaterializer) {
    this.materializer = materializer;
  }

  async get(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact> {
    const cached = this.cache.get(payload.ref.artifactId);
    if (cached?.sourcePackageHash === payload.ref.sourcePackageHash) {
      return cached.artifact;
    }
    const artifact = await this.materializer.materialize(payload);
    if (cached !== undefined) {
      await disposeArtifact(cached.artifact);
    }
    this.cache.set(payload.ref.artifactId, {
      sourcePackageHash: payload.ref.sourcePackageHash,
      artifact,
    });
    return artifact;
  }

  size(): number {
    return this.cache.size;
  }

  async delete(artifactId: string): Promise<void> {
    const cached = this.cache.get(artifactId);
    this.cache.delete(artifactId);
    if (cached !== undefined) {
      await disposeArtifact(cached.artifact);
    }
  }

  async clear(): Promise<void> {
    const artifacts = Array.from(this.cache.values(), entry => entry.artifact);
    this.cache.clear();
    await Promise.all(artifacts.map(artifact => disposeArtifact(artifact)));
  }
}

export type ExecutionArtifactRuntimeService = Fetcher["fetch"] & {
  dispose(): Promise<void>;
  cacheSize(): number;
};

export function createExecutionArtifactRuntimeService(options: {
  materializer: ExecutionArtifactMaterializer;
  store?: BackendExecutionArtifactStore;
  capabilityToken?: string;
}): ExecutionArtifactRuntimeService {
  const cache = new CachedExecutionArtifactMaterializer(options.materializer);
  const fetch: Fetcher["fetch"] = (input, init) =>
    Effect.runPromise(
      routeExecutionArtifactRuntimeInvoke(input, init, options, cache).pipe(
        Effect.catch(error => Effect.succeed(executionArtifactRuntimeErrorResponse(error))),
      ),
    );
  return Object.assign(fetch, {
    dispose: () => cache.clear(),
    cacheSize: () => cache.size(),
  });
}

async function disposeArtifact(artifact: MaterializedExecutionArtifact): Promise<void> {
  await artifact.dispose?.();
}

export class ServiceBindingExecutionArtifactRuntime implements BackendExecutionArtifactRuntime {
  private readonly runtime: Fetcher;
  private readonly store: BackendExecutionArtifactStore;
  private readonly deploymentId: string;
  private readonly capabilityToken: string | undefined;
  private readonly sendSourcePackage: boolean;

  constructor(options: {
    runtime: Fetcher;
    store: BackendExecutionArtifactStore;
    deploymentId: string;
    capabilityToken?: string;
    sendSourcePackage?: boolean;
  }) {
    this.runtime = options.runtime;
    this.store = options.store;
    this.deploymentId = options.deploymentId;
    this.capabilityToken = options.capabilityToken;
    this.sendSourcePackage = options.sendSourcePackage ?? true;
  }

  async invoke(
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
  ): Promise<InvokeResponse> {
    return await Effect.runPromise(
      invokeServiceBindingExecutionArtifactRuntime(
        {
          runtime: this.runtime,
          store: this.store,
          deploymentId: this.deploymentId,
          capabilityToken: this.capabilityToken,
          sendSourcePackage: this.sendSourcePackage,
        },
        deployment,
        request,
      ).pipe(
        Effect.mapError(serviceBindingExecutionArtifactRuntimeErrorToHttpError),
      ),
    );
  }
}

export const invokeServiceBindingExecutionArtifactRuntime = Effect.fn(
  "ServiceBindingExecutionArtifactRuntime.invoke",
)(
  function* (
    options: {
      readonly runtime: Fetcher;
      readonly store: BackendExecutionArtifactStore;
      readonly deploymentId: string;
      readonly capabilityToken?: string | undefined;
      readonly sendSourcePackage?: boolean | undefined;
    },
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
  ) {
    const payload = yield* serviceBindingExecutionArtifactInvokePayloadEffect(
      options,
      deployment,
      request,
    );
    const response = yield* fetchServiceBindingExecutionArtifactRuntime(options, deployment, payload);
    return yield* decodeServiceBindingExecutionArtifactRuntimeResponse<InvokeResponse>(response);
  },
);

function serviceBindingExecutionArtifactInvokePayloadEffect(
  options: {
    readonly store: BackendExecutionArtifactStore;
    readonly deploymentId: string;
    readonly sendSourcePackage?: boolean | undefined;
  },
  deployment: ActiveDeploymentStatus,
  request: InvokeRequest,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactRuntimeOperationError> {
  if (options.sendSourcePackage === false) {
    return Effect.succeed({
      deploymentId: options.deploymentId,
      ref: deployment.executionArtifactRef,
      request,
    });
  }
  return Effect.tryPromise({
    try: async () => ({
      deploymentId: options.deploymentId,
      ref: deployment.executionArtifactRef,
      sourcePackage: await options.store.get(deployment.executionArtifactRef),
      request,
    }),
    catch: cause => executionArtifactRuntimeOperationError("loadSourcePackage", cause),
  });
}

function fetchServiceBindingExecutionArtifactRuntime(
  options: {
    readonly runtime: Fetcher;
    readonly capabilityToken?: string | undefined;
  },
  deployment: ActiveDeploymentStatus,
  payload: ExecutionArtifactInvokePayload,
): Effect.Effect<Response, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => options.runtime.fetch("https://flarex-artifact-runtime.internal/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": deployment.executionArtifactRef.artifactId,
        "x-flarex-source-package-hash": deployment.executionArtifactRef.sourcePackageHash,
        ...(options.capabilityToken === undefined
          ? {}
          : { authorization: `Bearer ${options.capabilityToken}` }),
      },
      body: JSON.stringify(payload),
    }),
    catch: cause => executionArtifactRuntimeOperationError("runtimeFetch", cause),
  });
}

export const decodeServiceBindingExecutionArtifactRuntimeResponse = Effect.fn(
  "ServiceBindingExecutionArtifactRuntime.decodeResponse",
)(
  function* <A>(response: ExecutionArtifactRuntimeHttpResponse) {
    const body = yield* readServiceBindingExecutionArtifactRuntimeResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new ServiceBindingExecutionArtifactRuntimeResponseError({
        status: response.status,
        message: serviceBindingExecutionArtifactRuntimeErrorMessage(body, response.status),
        body,
      }));
    }
    return body as A;
  },
);

function readServiceBindingExecutionArtifactRuntimeResponseJson(
  response: ExecutionArtifactRuntimeHttpResponse,
): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

function serviceBindingExecutionArtifactRuntimeErrorMessage(
  body: unknown,
  status: number,
): string {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : `Execution artifact runtime failed with status ${status}`;
}

function serviceBindingExecutionArtifactRuntimeErrorToHttpError(
  error: ServiceBindingExecutionArtifactRuntimeError,
): HttpError {
  return new HttpError(error.status, error.message);
}

function executionArtifactRuntimeOperationError(
  operation: ExecutionArtifactRuntimeOperationError["operation"],
  cause: unknown,
): ExecutionArtifactRuntimeOperationError {
  return new ExecutionArtifactRuntimeOperationError({
    operation,
    status: errorStatus(cause) ?? 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function executionArtifactRuntimeErrorResponse(error: ExecutionArtifactRuntimeRouteError): Response {
  if (error instanceof RequestJsonError || error instanceof ExecutionArtifactInvokePayloadError) {
    const httpError = executionArtifactInvokeRouteErrorToHttpError(error);
    return Response.json({ error: httpError.message }, { status: httpError.status });
  }
  if (error instanceof ExecutionArtifactRuntimeMissingSourcePackageError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (
    error instanceof ExecutionArtifactRuntimeRouteNotFoundError ||
    error instanceof ExecutionArtifactRuntimeAuthorizationError ||
    error instanceof ExecutionArtifactRuntimeHeaderError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: error.message }, { status: error.status });
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}
