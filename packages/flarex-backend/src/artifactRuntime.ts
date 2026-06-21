import type { BackendExecutionArtifactStore } from "./artifactStore.ts";
import { HttpError } from "./http.ts";
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
  const fetch: Fetcher["fetch"] = async (input, init) => {
    try {
      const request = await normalizeRuntimeRequest(input, init);
      if (new URL(request.url).pathname !== "/invoke" || request.method !== "POST") {
        return Response.json({ error: "Not found." }, { status: 404 });
      }
      const unauthorized = authorizeRuntimeRequest(request, options.capabilityToken);
      if (unauthorized !== null) return unauthorized;

      const payload = await request.json().catch(() => null) as ExecutionArtifactInvokePayload | null;
      if (!isExecutionArtifactInvokePayload(payload)) {
        return Response.json({ error: "Invalid execution artifact invoke payload." }, { status: 400 });
      }
      const headerError = validateArtifactHeaders(request, payload);
      if (headerError !== null) return headerError;
      const materializedPayload = await resolveSourcePackage(payload, options.store);

      return Response.json(await (await cache.get(materializedPayload)).invoke(materializedPayload));
    } catch (error) {
      const status = errorStatus(error) ?? 500;
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status },
      );
    }
  };
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
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `Execution artifact runtime failed with status ${response.status}`;
      throw new HttpError(response.status, message);
    }
    return body as InvokeResponse;
  }
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

async function resolveSourcePackage(
  payload: ExecutionArtifactInvokePayload,
  store: BackendExecutionArtifactStore | undefined,
): Promise<MaterializedExecutionArtifactPayload> {
  if (payload.sourcePackage !== undefined) {
    return payload as MaterializedExecutionArtifactPayload;
  }
  if (store === undefined) {
    throw new HttpError(400, "Execution artifact invoke payload missing sourcePackage.");
  }
  return {
    ...payload,
    sourcePackage: await store.get(payload.ref),
  };
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function isExecutionArtifactInvokePayload(value: unknown): value is ExecutionArtifactInvokePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Partial<ExecutionArtifactInvokePayload>;
  return (
    typeof payload.deploymentId === "string" &&
    typeof payload.ref === "object" &&
    payload.ref !== null &&
    (payload.sourcePackage === undefined ||
      (typeof payload.sourcePackage === "object" && payload.sourcePackage !== null)) &&
    typeof payload.request === "object" &&
    payload.request !== null
  );
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
