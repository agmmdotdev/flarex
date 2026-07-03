import {
  createExecutionArtifactRuntimeService,
  decodeServiceBindingExecutionArtifactRuntimeInvokeResponse,
  executionArtifactWorkerEnv,
  executionArtifactWorkerModules,
  executionArtifactRuntimeWorkerSource,
  type ExecutionArtifactMaterializer,
  type ExecutionArtifactRuntimeService,
  type ExecutionArtifactWorkerExecutorTransport,
  type MaterializedExecutionArtifact,
  type MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import { Effect } from "effect";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";
import type { InvokeResponse, PushSourcePackage } from "flarex-backend/types";

type ExecutorTransport = ExecutionArtifactWorkerExecutorTransport;

export type ArtifactRuntimeEnv = {
  readonly ARTIFACTS: R2BucketLike;
  readonly LOADER?: WorkerLoader;
  readonly FLAREX_EXECUTOR?: Fetcher;
  readonly FLAREX_ARTIFACT_RUNTIME_TOKEN?: string;
  readonly FLAREX_EXECUTOR_TOKEN?: string;
  readonly FLAREX_EXECUTOR_TOKEN_VERSION?: string;
  readonly FLAREX_EXECUTOR_TRANSPORT?: string;
  readonly FLAREX_PROJECT_ID?: string;
  readonly FLAREX_INVOKE_MAX_ATTEMPTS?: string;
  readonly FLAREX_INTERNAL_TOKEN?: string;
  readonly FLAREX_INTERNAL_TOKEN_VERSION?: string;
  readonly FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE?: string;
};

export type ArtifactRuntimeWorker = {
  fetch(request: Request, env: ArtifactRuntimeEnv): Promise<Response>;
};

export class HostedArtifactRuntimeMissingCapabilityTokenError extends Error {
  readonly status = 500;

  constructor() {
    super("FLAREX_ARTIFACT_RUNTIME_TOKEN is required for hosted artifact runtime requests.");
    this.name = "HostedArtifactRuntimeMissingCapabilityTokenError";
  }
}

export class HostedArtifactRuntimeMissingWorkerLoaderError extends Error {
  readonly status = 500;

  constructor() {
    super("LOADER worker loader binding is required for hosted artifact runtime requests.");
    this.name = "HostedArtifactRuntimeMissingWorkerLoaderError";
  }
}

export class HostedArtifactRuntimeMissingExecutorBindingError extends Error {
  readonly status = 500;

  constructor() {
    super("FLAREX_EXECUTOR service binding is required for hosted Dynamic Worker execution.");
    this.name = "HostedArtifactRuntimeMissingExecutorBindingError";
  }
}

export class HostedArtifactRuntimeInvalidExecutorTransportError extends Error {
  readonly status = 500;

  constructor(transport: string) {
    super(`Unsupported Flarex executor transport: ${transport}`);
    this.name = "HostedArtifactRuntimeInvalidExecutorTransportError";
  }
}

export class HostedDynamicWorkerResponseError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HostedDynamicWorkerResponseError";
    this.status = status;
  }
}

export type HostedDynamicWorkerMaterializerOptions = {
  readonly loader: WorkerLoader;
  readonly executor: Fetcher;
  readonly compatibilityDate?: string;
  readonly executorToken?: string;
  readonly executorTokenVersion?: string;
  readonly executorTransport?: ExecutorTransport;
  readonly invokeMaxAttempts?: string;
  readonly projectId?: string;
  readonly internalToken?: string;
  readonly internalTokenVersion?: string;
};

export class HostedDynamicWorkerExecutionArtifactMaterializer implements ExecutionArtifactMaterializer {
  private readonly loader: WorkerLoader;
  private readonly executor: Fetcher;
  private readonly compatibilityDate: string;
  private readonly executorToken: string | undefined;
  private readonly executorTransport: ExecutorTransport | undefined;
  private readonly invokeMaxAttempts: string | undefined;
  private readonly projectId: string | undefined;
  private readonly internalToken: string | undefined;
  private readonly executorIdentity: string;
  private readonly internalAuthIdentity: string;

  constructor(options: HostedDynamicWorkerMaterializerOptions) {
    this.loader = options.loader;
    this.executor = options.executor;
    this.compatibilityDate = options.compatibilityDate ?? DEFAULT_DYNAMIC_WORKER_COMPATIBILITY_DATE;
    this.executorToken = options.executorToken;
    this.executorTransport = options.executorTransport;
    this.invokeMaxAttempts = options.invokeMaxAttempts;
    this.projectId = options.projectId;
    this.internalToken = options.internalToken;
    this.executorIdentity = executorIdentity(options);
    this.internalAuthIdentity = internalAuthIdentity(options.internalToken, options.internalTokenVersion);
  }

  materialize(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact> {
    const code = dynamicWorkerCode(payload.sourcePackage, {
      compatibilityDate: this.compatibilityDate,
      executor: this.executor,
      ...(this.executorToken === undefined ? {} : { executorToken: this.executorToken }),
      ...(this.executorTransport === undefined ? {} : { executorTransport: this.executorTransport }),
      ...(this.internalToken === undefined ? {} : { internalToken: this.internalToken }),
      ...(this.invokeMaxAttempts === undefined ? {} : { invokeMaxAttempts: this.invokeMaxAttempts }),
      ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
    });
    const worker = this.loader.get(
      dynamicWorkerId(payload, this.compatibilityDate, this.executorIdentity, this.internalAuthIdentity),
      () => code,
    );
    return Promise.resolve(new HostedDynamicWorkerMaterializedExecutionArtifact(worker, this.internalToken));
  }
}

export function createArtifactRuntimeWorker(options: {
  readonly materializer?: ExecutionArtifactMaterializer;
} = {}): ArtifactRuntimeWorker {
  const services = new WeakMap<ArtifactRuntimeEnv, ExecutionArtifactRuntimeService>();

  function serviceForEnv(env: ArtifactRuntimeEnv): ExecutionArtifactRuntimeService {
    const cached = services.get(env);
    if (cached !== undefined) return cached;

    const capabilityToken = env.FLAREX_ARTIFACT_RUNTIME_TOKEN;
    const service = createExecutionArtifactRuntimeService({
      materializer: options.materializer ?? materializerForEnv(env),
      store: new R2BackendExecutionArtifactStore(env.ARTIFACTS),
      ...(capabilityToken === undefined ? {} : { capabilityToken }),
    });
    services.set(env, service);
    return service;
  }

  return {
    fetch: (request, env) => {
      if (env.FLAREX_ARTIFACT_RUNTIME_TOKEN === undefined) {
        return Promise.resolve(
          Response.json(
            { error: new HostedArtifactRuntimeMissingCapabilityTokenError().message },
            { status: 500 },
          ),
        );
      }
      if (options.materializer === undefined && env.LOADER === undefined) {
        return Promise.resolve(
          Response.json(
            { error: new HostedArtifactRuntimeMissingWorkerLoaderError().message },
            { status: 500 },
          ),
        );
      }
      if (options.materializer === undefined && env.FLAREX_EXECUTOR === undefined) {
        return Promise.resolve(
          Response.json(
            { error: new HostedArtifactRuntimeMissingExecutorBindingError().message },
            { status: 500 },
          ),
        );
      }
      const invalidExecutorTransport = invalidHostedExecutorTransport(env.FLAREX_EXECUTOR_TRANSPORT);
      if (options.materializer === undefined && invalidExecutorTransport !== null) {
        return Promise.resolve(
          Response.json(
            { error: new HostedArtifactRuntimeInvalidExecutorTransportError(invalidExecutorTransport).message },
            { status: 500 },
          ),
        );
      }
      return serviceForEnv(env)(request);
    },
  };
}

function materializerForEnv(env: ArtifactRuntimeEnv): ExecutionArtifactMaterializer {
  if (env.LOADER === undefined) {
    return {
      materialize: () => Promise.reject(new HostedArtifactRuntimeMissingWorkerLoaderError()),
    };
  }
  if (env.FLAREX_EXECUTOR === undefined) {
    return {
      materialize: () => Promise.reject(new HostedArtifactRuntimeMissingExecutorBindingError()),
    };
  }
  return new HostedDynamicWorkerExecutionArtifactMaterializer({
    loader: env.LOADER,
    executor: env.FLAREX_EXECUTOR,
    ...(env.FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE === undefined
      ? {}
      : { compatibilityDate: env.FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE }),
    ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
    ...(env.FLAREX_EXECUTOR_TOKEN_VERSION === undefined
      ? {}
      : { executorTokenVersion: env.FLAREX_EXECUTOR_TOKEN_VERSION }),
    ...(env.FLAREX_EXECUTOR_TRANSPORT === undefined
      ? {}
      : { executorTransport: parseHostedExecutorTransport(env.FLAREX_EXECUTOR_TRANSPORT) }),
    ...(env.FLAREX_INVOKE_MAX_ATTEMPTS === undefined
      ? {}
      : { invokeMaxAttempts: env.FLAREX_INVOKE_MAX_ATTEMPTS }),
    ...(env.FLAREX_PROJECT_ID === undefined ? {} : { projectId: env.FLAREX_PROJECT_ID }),
    ...(env.FLAREX_INTERNAL_TOKEN === undefined ? {} : { internalToken: env.FLAREX_INTERNAL_TOKEN }),
    ...(env.FLAREX_INTERNAL_TOKEN_VERSION === undefined
      ? {}
      : { internalTokenVersion: env.FLAREX_INTERNAL_TOKEN_VERSION }),
  });
}

class HostedDynamicWorkerMaterializedExecutionArtifact implements MaterializedExecutionArtifact {
  private readonly worker: WorkerStub;
  private readonly internalToken: string | undefined;

  constructor(worker: WorkerStub, internalToken: string | undefined) {
    this.worker = worker;
    this.internalToken = internalToken;
  }

  async invoke(payload: MaterializedExecutionArtifactPayload): Promise<InvokeResponse> {
    const response = await this.worker.getEntrypoint().fetch(
      new Request("https://flarex-dynamic-worker.internal/__flarex_internal/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-artifact-id": payload.ref.artifactId,
          "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
          ...(this.internalToken === undefined
            ? {}
            : { authorization: `Bearer ${this.internalToken}` }),
        },
        body: JSON.stringify({
          deploymentId: payload.deploymentId,
          ...payload.request,
        }),
      }),
    );
    return await decodeDynamicWorkerInvokeResponse(response);
  }
}

async function decodeDynamicWorkerInvokeResponse(response: Pick<Response, "json" | "ok" | "status">): Promise<InvokeResponse> {
  const body = await readResponseJsonOrNull(response);
  if (!response.ok) {
    throw new HostedDynamicWorkerResponseError(
      response.status,
      dynamicWorkerErrorMessage(body, response.status),
    );
  }
  return await Effect.runPromise(
    decodeServiceBindingExecutionArtifactRuntimeInvokeResponse(body).pipe(
      Effect.mapError(error => new HostedDynamicWorkerResponseError(error.status, error.message)),
    ),
  );
}

async function readResponseJsonOrNull(response: Pick<Response, "json">): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function dynamicWorkerErrorMessage(body: unknown, status: number): string {
  return hasErrorBody(body)
    ? String(body.error)
    : `Dynamic Worker execution artifact failed with status ${status}`;
}

function hasErrorBody(value: unknown): value is { readonly error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function parseHostedExecutorTransport(transport: string): ExecutorTransport {
  if (transport === "legacy" || transport === "postgres") return transport;
  throw new HostedArtifactRuntimeInvalidExecutorTransportError(transport);
}

function invalidHostedExecutorTransport(transport: string | undefined): string | null {
  if (transport === undefined || transport === "legacy" || transport === "postgres") return null;
  return transport;
}

const DEFAULT_DYNAMIC_WORKER_COMPATIBILITY_DATE = "2026-06-14";
const DYNAMIC_WORKER_MAIN_MODULE = "flarex-runtime-worker.js";

function dynamicWorkerId(
  payload: MaterializedExecutionArtifactPayload,
  compatibilityDate: string,
  executorIdentity: string,
  internalAuthIdentity: string,
): string {
  return [
    "v1",
    payload.ref.artifactId,
    payload.ref.sourcePackageHash,
    `compat=${compatibilityDate}`,
    `executor=${executorIdentity}`,
    `auth=${internalAuthIdentity}`,
  ].join(":");
}

function executorIdentity(options: {
  readonly executorToken?: string;
  readonly executorTokenVersion?: string;
  readonly executorTransport?: ExecutorTransport;
  readonly invokeMaxAttempts?: string;
  readonly projectId?: string;
}): string {
  return [
    `transport=${options.executorTransport ?? "legacy"}`,
    `project=${options.projectId ?? "none"}`,
    `attempts=${options.invokeMaxAttempts ?? "default"}`,
    `auth=${internalAuthIdentity(options.executorToken, options.executorTokenVersion)}`,
  ].join(",");
}

function internalAuthIdentity(
  internalToken: string | undefined,
  internalTokenVersion: string | undefined,
): string {
  if (internalToken === undefined) return "none";
  return internalTokenVersion === undefined ? "enabled-unversioned" : `version-${internalTokenVersion}`;
}

function dynamicWorkerCode(sourcePackage: PushSourcePackage, options: {
  readonly compatibilityDate: string;
  readonly executor: Fetcher;
  readonly executorToken?: string;
  readonly executorTransport?: ExecutorTransport;
  readonly internalToken?: string;
  readonly invokeMaxAttempts?: string;
  readonly projectId?: string;
}): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: options.compatibilityDate,
    mainModule: DYNAMIC_WORKER_MAIN_MODULE,
    modules: dynamicWorkerModules(sourcePackage),
    env: {
      FLAREX_EXECUTOR: options.executor,
      ...executionArtifactWorkerEnv({
        executorToken: options.executorToken,
        executorTransport: options.executorTransport,
        invokeMaxAttempts: options.invokeMaxAttempts,
        projectId: options.projectId,
        internalToken: options.internalToken,
      }),
    },
    globalOutbound: null,
  };
}

function dynamicWorkerModules(sourcePackage: PushSourcePackage): Record<string, string> {
  return executionArtifactWorkerModules({
    sourcePackage,
    runtimeModulePath: DYNAMIC_WORKER_MAIN_MODULE,
    runtimeWorkerSource: dynamicWorkerRuntimeSource(sourcePackage.execution),
    reservedBy: "hosted artifact runtime",
  });
}

function dynamicWorkerRuntimeSource(executionModule: string): string {
  return executionArtifactRuntimeWorkerSource({
    profile: "hosted-dynamic-worker",
    executionModule,
  });
}
export default createArtifactRuntimeWorker() satisfies ExportedHandler<ArtifactRuntimeEnv>;
