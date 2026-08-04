import {
  createExecutionArtifactRuntimeService,
  decodeMaterializedExecutionArtifactInvokeResponse,
  executionArtifactInternalInvokeRequest,
  executorIdentity,
  executionArtifactWorkerDefinition,
  internalAuthIdentity,
  type ExecutionArtifactWorkerDefinition,
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
import type { InvokeResponse } from "flarex-backend/types";

export {
  FlarexPointMutationExactRuntimeArtifactHostV1,
} from "./pointMutationExactRuntimeEntrypoint";
export {
  FlarexEdgeActionExactRuntimeArtifactHostV1,
} from "./edgeActionExactRuntimeEntrypoint";

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
    this.internalAuthIdentity = internalAuthIdentity({
      token: options.internalToken,
      tokenVersion: options.internalTokenVersion,
    });
  }

  materialize(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact> {
    const definition = executionArtifactWorkerDefinition({
      sourcePackage: payload.sourcePackage,
      profile: "hosted-dynamic-worker",
      runtimeModulePath: DYNAMIC_WORKER_MAIN_MODULE,
      reservedBy: "hosted artifact runtime",
      env: {
        executorToken: this.executorToken,
        executorTransport: this.executorTransport,
        invokeMaxAttempts: this.invokeMaxAttempts,
        projectId: this.projectId,
        internalToken: this.internalToken,
      },
    });
    const worker = this.loader.get(
      dynamicWorkerId(payload, this.compatibilityDate, this.executorIdentity, this.internalAuthIdentity),
      () => dynamicWorkerCode(definition, {
        compatibilityDate: this.compatibilityDate,
        executor: this.executor,
      }),
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
      executionArtifactInternalInvokeRequest({
        url: "https://flarex-dynamic-worker.internal/__flarex_internal/invoke",
        payload,
        internalToken: this.internalToken,
      }),
    );
    return await decodeDynamicWorkerInvokeResponse(response);
  }
}

async function decodeDynamicWorkerInvokeResponse(response: Pick<Response, "json" | "ok" | "status">): Promise<InvokeResponse> {
  return await Effect.runPromise(
    decodeMaterializedExecutionArtifactInvokeResponse(
      response,
      "Dynamic Worker execution artifact failed",
    ).pipe(
      Effect.mapError(error => new HostedDynamicWorkerResponseError(error.status, error.message)),
    ),
  );
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

function dynamicWorkerCode(definition: ExecutionArtifactWorkerDefinition, options: {
  readonly compatibilityDate: string;
  readonly executor: Fetcher;
}): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: options.compatibilityDate,
    mainModule: definition.mainModule,
    modules: definition.modules,
    env: {
      FLAREX_EXECUTOR: options.executor,
      ...definition.env,
    },
    globalOutbound: null,
  };
}
export default createArtifactRuntimeWorker() satisfies ExportedHandler<ArtifactRuntimeEnv>;
