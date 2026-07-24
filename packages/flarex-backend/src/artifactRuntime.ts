import type { BackendExecutionArtifactStore } from "./artifactStore.ts";
import {
  ExecutionArtifactInvokePayloadError,
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
import {
  executionArtifactRuntimeOperationErrorFromUnknown,
} from "./artifactRuntime/OperationError.ts";
export {
  generatedExecutionWorkerSource,
  generatedProjectWorkerExecutorBridgeSource,
  type GeneratedExecutionWorkerSourceOptions,
  type GeneratedProjectWorkerExecutorBridgeSourceOptions,
} from "./artifactRuntime/GeneratedWorkerSource.ts";
export {
  loadPointMutationExactRuntimeWorkerDefinitionV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_MAIN_MODULE_V1,
  PointMutationExactRuntimeHostV1Error,
  pointMutationExactRuntimeWorkerCodeIdentityV1,
  type LoadPointMutationExactRuntimeWorkerDefinitionV1Input,
  type PointMutationExactRuntimeHostV1Issue,
  type PointMutationExactRuntimeWorkerCodeIdentityV1Input,
  type PointMutationExactRuntimeWorkerDefinitionV1,
  type PointMutationExactRuntimeWorkerEnvV1,
} from "./artifactRuntime/PointMutationExactRuntimeHost.ts";
export {
  pointMutationExactRuntimeWorkerSource,
  type PointMutationExactRuntimeWorkerSourceOptions,
} from "./artifactRuntime/PointMutationExactRuntimeWorkerSource.ts";
export {
  executionArtifactInternalInvokeRequest,
  executionArtifactInternalRequestHeaders,
  executorIdentity,
  executionArtifactWorkerDefinition,
  executionArtifactWorkerEnv,
  executionArtifactWorkerModules,
  executionArtifactRuntimeWorkerSource,
  internalAuthIdentity,
  type ExecutorIdentityOptions,
  ExecutionArtifactWorkerDuplicateModulePathError,
  ExecutionArtifactWorkerReservedModulePathError,
  ExecutionArtifactWorkerSourceModuleMissingError,
  type ExecutionArtifactInternalInvokeRequestOptions,
  type ExecutionArtifactInternalInvokeRequestPayload,
  type ExecutionArtifactInternalRequestHeadersOptions,
  type ExecutionArtifactInternalRequestRef,
  type ExecutionArtifactWorkerDefinition,
  type ExecutionArtifactWorkerDefinitionOptions,
  type ExecutionArtifactWorkerEnv,
  type ExecutionArtifactWorkerEnvOptions,
  type ExecutionArtifactWorkerExecutorTransport,
  type ExecutionArtifactWorkerModulesOptions,
  type ExecutionArtifactRuntimeWorkerSourceOptions,
  type ExecutionArtifactRuntimeWorkerSourceProfile,
  type InternalAuthIdentityOptions,
} from "./artifactRuntime/HostKit.ts";
import { Data, Effect, Schema } from "effect";
import {
  executionArtifactHttpErrorMessage,
  executionArtifactInvokePayload,
  type ExecutionArtifactInvokePayloadFor,
  materializedExecutionArtifactInvokePayload,
  type MaterializedExecutionArtifactInvokePayloadFor,
} from "flarex-protocol/artifact-runtime";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import { InvokeResponseSchema, type InvokeResponse as ProtocolInvokeResponse } from "flarex-protocol/invoke";
import {
  badRequestErrorToHttpError,
  HttpError,
  readResponseJsonOrNullEffect,
  RequestJsonError,
} from "./http.ts";
import type {
  ActiveDeploymentStatus,
  CommittedWrite,
  InvokeRequest,
  InvokeResponse,
  Json,
  PushSourcePackage,
  ReadSet,
} from "./types.ts";
import { backendJson } from "./execution/JsonRouteBoundary.ts";

export type ExecutionArtifactInvokePayload = ExecutionArtifactInvokePayloadFor<
  ActiveDeploymentStatus["executionArtifactRef"],
  InvokeRequest,
  PushSourcePackage
>;

export type MaterializedExecutionArtifactPayload =
  MaterializedExecutionArtifactInvokePayloadFor<
    ActiveDeploymentStatus["executionArtifactRef"],
    InvokeRequest,
    PushSourcePackage
  >;

export type ExecutionArtifactQuerySessionRequest = {
  deploymentId: string;
  projectId?: string;
  identity: ExecutionIdentity;
  path: string;
  args: Json;
  partitionKey?: string;
  sessionId: string;
};

export interface BackendExecutionArtifactRuntime {
  invoke(
    deployment: ActiveDeploymentStatus,
    request: InvokeRequest,
    identity: ExecutionIdentity,
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
const decodeUnknownInvokeResponse = Schema.decodeUnknownEffect(InvokeResponseSchema);

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

export class MaterializedExecutionArtifactInvokeResponseError extends Data.TaggedError(
  "MaterializedExecutionArtifactInvokeResponseError",
)<{
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

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
    // Deliberate runtime bridge: Fetcher.fetch implementations return Promises.
    Effect.runPromise(
      routeExecutionArtifactRuntimeInvoke(input, init, options, cache).pipe(
        Effect.catch(executionArtifactRuntimeRouteErrorToResponseEffect),
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
    identity: ExecutionIdentity,
  ): Promise<InvokeResponse> {
    // Deliberate runtime bridge: service-binding runtime invokes by Promise.
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
        identity,
      ).pipe(
        Effect.catch(serviceBindingExecutionArtifactRuntimeErrorToHttpErrorEffect),
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
    identity: ExecutionIdentity = { kind: "anonymous" },
  ) {
    const payload = yield* serviceBindingExecutionArtifactInvokePayloadEffect(
      options,
      deployment,
      request,
      identity,
    );
    const response = yield* fetchServiceBindingExecutionArtifactRuntime(options, deployment, payload);
    return yield* decodeServiceBindingExecutionArtifactRuntimeResponse(response);
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
  identity: ExecutionIdentity,
): Effect.Effect<ExecutionArtifactInvokePayload, ExecutionArtifactRuntimeOperationError> {
  if (options.sendSourcePackage === false) {
    return Effect.succeed(executionArtifactInvokePayload({
      deploymentId: options.deploymentId,
      identity,
      ref: deployment.executionArtifactRef,
      request,
    }));
  }
  return Effect.tryPromise({
    try: async () => materializedExecutionArtifactInvokePayload({
      deploymentId: options.deploymentId,
      identity,
      ref: deployment.executionArtifactRef,
      sourcePackage: await options.store.get(deployment.executionArtifactRef),
      request,
    }),
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "loadSourcePackage",
      cause,
    ),
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
    catch: cause => executionArtifactRuntimeOperationErrorFromUnknown(
      "runtimeFetch",
      cause,
    ),
  });
}

export const decodeServiceBindingExecutionArtifactRuntimeResponse = Effect.fn(
  "ServiceBindingExecutionArtifactRuntime.decodeResponse",
)(
  function* (response: ExecutionArtifactRuntimeHttpResponse) {
    const body = yield* readServiceBindingExecutionArtifactRuntimeResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new ServiceBindingExecutionArtifactRuntimeResponseError({
        status: response.status,
        message: serviceBindingExecutionArtifactRuntimeErrorMessage(body, response.status),
        body,
      }));
    }
    return yield* decodeServiceBindingExecutionArtifactRuntimeInvokeResponse(body);
  },
);

export const decodeServiceBindingExecutionArtifactRuntimeInvokeResponse = Effect.fn(
  "ServiceBindingExecutionArtifactRuntime.decodeInvokeResponse",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<InvokeResponse, ServiceBindingExecutionArtifactRuntimeResponseError> {
    const decoded = yield* decodeUnknownInvokeResponse(value).pipe(
      Effect.mapError(() => new ServiceBindingExecutionArtifactRuntimeResponseError({
        status: 500,
        message: "Invalid execution artifact runtime invoke response.",
        body: value,
      })),
    );
    return backendInvokeResponseFromProtocol(decoded);
  },
);

export const decodeMaterializedExecutionArtifactInvokeResponse = Effect.fn(
  "MaterializedExecutionArtifact.decodeInvokeResponse",
)(
  function* (
    response: ExecutionArtifactRuntimeHttpResponse,
    fallbackMessage: string,
  ): Effect.fn.Return<InvokeResponse, MaterializedExecutionArtifactInvokeResponseError> {
    const body = yield* readServiceBindingExecutionArtifactRuntimeResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new MaterializedExecutionArtifactInvokeResponseError({
        status: response.status,
        message: materializedExecutionArtifactInvokeErrorMessage(body, fallbackMessage, response.status),
        body,
      }));
    }
    return yield* decodeServiceBindingExecutionArtifactRuntimeInvokeResponse(body).pipe(
      Effect.mapError(error => new MaterializedExecutionArtifactInvokeResponseError({
        status: error.status,
        message: error.message,
        body: error.body,
      })),
    );
  },
);

function backendInvokeResponseFromProtocol(response: ProtocolInvokeResponse): InvokeResponse {
  return {
    value: backendJson(response.value),
    ...(response.readSet === undefined ? {} : { readSet: backendReadSetFromProtocol(response.readSet) }),
    ...(response.readTs === undefined ? {} : { readTs: response.readTs }),
    ...(response.committedTs === undefined ? {} : { committedTs: response.committedTs }),
    ...(response.writes === undefined ? {} : { writes: response.writes.map(backendWriteFromProtocol) }),
  };
}

function backendReadSetFromProtocol(readSet: NonNullable<ProtocolInvokeResponse["readSet"]>): ReadSet {
  return {
    ...(readSet.documents === undefined
      ? {}
      : {
          documents: readSet.documents.map(read => ({
            tableId: read.tableId,
            id: read.id,
            ...(read.observedTs === undefined ? {} : { observedTs: read.observedTs }),
          })),
        }),
    ...(readSet.tables === undefined
      ? {}
      : {
          tables: readSet.tables.map(read => ({
            tableId: read.tableId,
            ...(read.observedTs === undefined ? {} : { observedTs: read.observedTs }),
          })),
        }),
    ...(readSet.indexes === undefined
      ? {}
      : {
          indexes: readSet.indexes.map(read => ({
            indexId: read.indexId,
            ...(read.observedTs === undefined ? {} : { observedTs: read.observedTs }),
            ...(read.lower === undefined ? {} : { lower: read.lower }),
            ...(read.upper === undefined ? {} : { upper: read.upper }),
          })),
        }),
  };
}

function backendWriteFromProtocol(write: NonNullable<ProtocolInvokeResponse["writes"]>[number]): CommittedWrite {
  return {
    tableId: write.tableId,
    id: write.id,
    prevTs: write.prevTs,
    ts: write.ts,
    value: backendJson(write.value),
  };
}

function readServiceBindingExecutionArtifactRuntimeResponseJson(
  response: ExecutionArtifactRuntimeHttpResponse,
): Effect.Effect<unknown> {
  return readResponseJsonOrNullEffect(response);
}

function serviceBindingExecutionArtifactRuntimeErrorMessage(
  body: unknown,
  status: number,
): string {
  return executionArtifactHttpErrorMessage(
    body,
    "Execution artifact runtime failed",
    status,
  );
}

function materializedExecutionArtifactInvokeErrorMessage(
  body: unknown,
  fallbackMessage: string,
  status: number,
): string {
  return executionArtifactHttpErrorMessage(body, fallbackMessage, status);
}

function serviceBindingExecutionArtifactRuntimeErrorToHttpError(
  error: ServiceBindingExecutionArtifactRuntimeError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export const serviceBindingExecutionArtifactRuntimeErrorToHttpErrorEffect = Effect.fn(
  "ServiceBindingExecutionArtifactRuntime.errorToHttpError",
)(
  (
    error: ServiceBindingExecutionArtifactRuntimeError,
  ): Effect.Effect<never, HttpError> =>
    Effect.fail(serviceBindingExecutionArtifactRuntimeErrorToHttpError(error)),
);

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

function executionArtifactInvokeRouteErrorToHttpError(
  error: RequestJsonError | ExecutionArtifactInvokePayloadError,
): HttpError {
  return badRequestErrorToHttpError(error);
}

export const executionArtifactRuntimeRouteErrorToResponseEffect = Effect.fn(
  "ExecutionArtifactRuntime.routeErrorToResponse",
)(function* (
  error: ExecutionArtifactRuntimeRouteError,
): Effect.fn.Return<Response> {
  return yield* Effect.succeed(executionArtifactRuntimeErrorResponse(error));
});
