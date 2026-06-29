import type { BackendExecutionArtifactStore } from "./artifactStore.ts";
import {
  decodeExecutionArtifactInvokePayload,
  ExecutionArtifactInvokePayloadError,
  executionArtifactInvokeRouteErrorToHttpError,
  type ExecutionArtifactInvokeRouteError,
} from "./artifactRuntime/RouteBoundary.ts";
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

export class ExecutionArtifactRuntimeMissingSourcePackageError extends Data.TaggedError(
  "ExecutionArtifactRuntimeMissingSourcePackageError",
)<{
  readonly message: string;
}> {}

export class ExecutionArtifactRuntimeOperationError extends Data.TaggedError(
  "ExecutionArtifactRuntimeOperationError",
)<{
  readonly operation: "normalizeRequest" | "loadSourcePackage" | "materialize" | "invoke";
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

type ExecutionArtifactRuntimeHttpResponse = Pick<Response, "json" | "ok" | "status">;

export class ServiceBindingExecutionArtifactRuntimeResponseError extends Data.TaggedError(
  "ServiceBindingExecutionArtifactRuntimeResponseError",
)<{
  readonly status: number;
  readonly message: string;
  readonly body: unknown;
}> {}

type ExecutionArtifactRuntimeError =
  | ExecutionArtifactInvokeRouteError
  | ExecutionArtifactRuntimeMissingSourcePackageError
  | ExecutionArtifactRuntimeOperationError;

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

const routeExecutionArtifactRuntimeInvoke = Effect.fn("ExecutionArtifactRuntime.routeInvoke")(
  function* (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    options: {
      readonly store?: BackendExecutionArtifactStore;
      readonly capabilityToken?: string;
    },
    cache: CachedExecutionArtifactMaterializer,
  ) {
    const request = yield* normalizeRuntimeRequestEffect(input, init);
    if (new URL(request.url).pathname !== "/invoke" || request.method !== "POST") {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    const unauthorized = authorizeRuntimeRequest(request, options.capabilityToken);
    if (unauthorized !== null) return unauthorized;

    const payload = yield* decodeExecutionArtifactInvokePayload(request);
    const headerError = validateArtifactHeaders(request, payload);
    if (headerError !== null) return headerError;

    const materializedPayload = yield* resolveSourcePackageEffect(payload, options.store);
    const artifact = yield* getMaterializedArtifactEffect(cache, materializedPayload);
    const response = yield* invokeMaterializedArtifactEffect(artifact, materializedPayload);
    return Response.json(response);
  },
);

function normalizeRuntimeRequestEffect(
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Request, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => normalizeRuntimeRequest(input, init),
    catch: cause => executionArtifactRuntimeOperationError("normalizeRequest", cause),
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
    const payload: ExecutionArtifactInvokePayload = {
      deploymentId: this.deploymentId,
      ref: deployment.executionArtifactRef,
      request,
      ...(this.sendSourcePackage
        ? { sourcePackage: await this.store.get(deployment.executionArtifactRef) }
        : {}),
    };
    const response = await this.runtime.fetch("https://flarex-artifact-runtime.internal/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": deployment.executionArtifactRef.artifactId,
        "x-flarex-source-package-hash": deployment.executionArtifactRef.sourcePackageHash,
        ...(this.capabilityToken === undefined
          ? {}
          : { authorization: `Bearer ${this.capabilityToken}` }),
      },
      body: JSON.stringify(payload),
    });
    return await Effect.runPromise(
      decodeServiceBindingExecutionArtifactRuntimeResponse<InvokeResponse>(response).pipe(
        Effect.mapError(serviceBindingExecutionArtifactRuntimeResponseErrorToHttpError),
      ),
    );
  }
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

function serviceBindingExecutionArtifactRuntimeResponseErrorToHttpError(
  error: ServiceBindingExecutionArtifactRuntimeResponseError,
): HttpError {
  return new HttpError(error.status, error.message);
}

function authorizeRuntimeRequest(request: Request, capabilityToken: string | undefined): Response | null {
  if (capabilityToken === undefined) return null;
  const expected = `Bearer ${capabilityToken}`;
  if (request.headers.get("authorization") === expected) return null;
  return Response.json({ error: "Unauthorized execution artifact runtime request." }, { status: 401 });
}

function validateArtifactHeaders(
  request: Request,
  payload: ExecutionArtifactInvokePayload,
): Response | null {
  if (request.headers.get("x-flarex-artifact-id") !== payload.ref.artifactId) {
    return Response.json({ error: "Execution artifact ID header mismatch." }, { status: 400 });
  }
  if (request.headers.get("x-flarex-source-package-hash") !== payload.ref.sourcePackageHash) {
    return Response.json({ error: "Execution artifact source package hash header mismatch." }, { status: 400 });
  }
  return null;
}

function resolveSourcePackageEffect(
  payload: ExecutionArtifactInvokePayload,
  store: BackendExecutionArtifactStore | undefined,
): Effect.Effect<
  MaterializedExecutionArtifactPayload,
  ExecutionArtifactRuntimeMissingSourcePackageError | ExecutionArtifactRuntimeOperationError
> {
  if (payload.sourcePackage !== undefined) {
    return Effect.succeed(payload as MaterializedExecutionArtifactPayload);
  }
  if (store === undefined) {
    return Effect.fail(new ExecutionArtifactRuntimeMissingSourcePackageError({
      message: "Execution artifact invoke payload missing sourcePackage.",
    }));
  }
  return Effect.tryPromise({
    try: async () => ({
      ...payload,
      sourcePackage: await store.get(payload.ref),
    }),
    catch: cause => executionArtifactRuntimeOperationError("loadSourcePackage", cause),
  });
}

function getMaterializedArtifactEffect(
  cache: CachedExecutionArtifactMaterializer,
  payload: MaterializedExecutionArtifactPayload,
): Effect.Effect<MaterializedExecutionArtifact, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => cache.get(payload),
    catch: cause => executionArtifactRuntimeOperationError("materialize", cause),
  });
}

function invokeMaterializedArtifactEffect(
  artifact: MaterializedExecutionArtifact,
  payload: MaterializedExecutionArtifactPayload,
): Effect.Effect<InvokeResponse, ExecutionArtifactRuntimeOperationError> {
  return Effect.tryPromise({
    try: () => artifact.invoke(payload),
    catch: cause => executionArtifactRuntimeOperationError("invoke", cause),
  });
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

function executionArtifactRuntimeErrorResponse(error: ExecutionArtifactRuntimeError): Response {
  if (error instanceof RequestJsonError || error instanceof ExecutionArtifactInvokePayloadError) {
    const httpError = executionArtifactInvokeRouteErrorToHttpError(error);
    return Response.json({ error: httpError.message }, { status: httpError.status });
  }
  if (error instanceof ExecutionArtifactRuntimeMissingSourcePackageError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: error.message }, { status: error.status });
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

async function normalizeRuntimeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Request> {
  if (isRequestLike(input) && !(input instanceof Request)) {
    return requestFromRequestLike(input);
  }
  if (init !== undefined || typeof input === "string" || input instanceof URL || input instanceof Request) {
    return new Request(input, init);
  }
  return new Request(input, init);
}

type RequestLike = {
  url: string;
  method: string;
  headers: HeadersInit;
  text(): Promise<string>;
};

function isRequestLike(value: unknown): value is RequestLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RequestLike>;
  return (
    typeof candidate.url === "string" &&
    typeof candidate.method === "string" &&
    candidate.headers !== undefined &&
    typeof candidate.text === "function"
  );
}

async function requestFromRequestLike(request: RequestLike): Promise<Request> {
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.text() }),
  };
  return new Request(request.url, init);
}
