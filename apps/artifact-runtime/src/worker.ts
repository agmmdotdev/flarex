import {
  createExecutionArtifactRuntimeService,
  decodeServiceBindingExecutionArtifactRuntimeInvokeResponse,
  type ExecutionArtifactMaterializer,
  type ExecutionArtifactRuntimeService,
  type MaterializedExecutionArtifact,
  type MaterializedExecutionArtifactPayload,
} from "flarex-backend/artifact-runtime";
import { Effect } from "effect";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "flarex-backend/artifact-store";
import type { InvokeResponse, PushSourcePackage } from "flarex-backend/types";

export type ArtifactRuntimeEnv = {
  readonly ARTIFACTS: R2BucketLike;
  readonly LOADER?: WorkerLoader;
  readonly FLAREX_ARTIFACT_RUNTIME_TOKEN?: string;
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

export class HostedArtifactRuntimeSourceModuleMissingError extends Error {
  readonly status = 400;

  constructor(modulePath: string) {
    super(`Source package module ${modulePath} has no source.`);
    this.name = "HostedArtifactRuntimeSourceModuleMissingError";
  }
}

export class HostedArtifactRuntimeReservedModulePathError extends Error {
  readonly status = 400;

  constructor(modulePath: string) {
    super(`Source package module path ${modulePath} is reserved by the hosted artifact runtime.`);
    this.name = "HostedArtifactRuntimeReservedModulePathError";
  }
}

export class HostedArtifactRuntimeDuplicateModulePathError extends Error {
  readonly status = 400;

  constructor(modulePath: string) {
    super(`Source package contains duplicate module path ${modulePath}.`);
    this.name = "HostedArtifactRuntimeDuplicateModulePathError";
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
  readonly compatibilityDate?: string;
  readonly internalToken?: string;
  readonly internalTokenVersion?: string;
};

export class HostedDynamicWorkerExecutionArtifactMaterializer implements ExecutionArtifactMaterializer {
  private readonly loader: WorkerLoader;
  private readonly compatibilityDate: string;
  private readonly internalToken: string | undefined;
  private readonly internalAuthIdentity: string;

  constructor(options: HostedDynamicWorkerMaterializerOptions) {
    this.loader = options.loader;
    this.compatibilityDate = options.compatibilityDate ?? DEFAULT_DYNAMIC_WORKER_COMPATIBILITY_DATE;
    this.internalToken = options.internalToken;
    this.internalAuthIdentity = internalAuthIdentity(options.internalToken, options.internalTokenVersion);
  }

  materialize(payload: MaterializedExecutionArtifactPayload): Promise<MaterializedExecutionArtifact> {
    const code = dynamicWorkerCode(payload.sourcePackage, this.compatibilityDate, this.internalToken);
    const worker = this.loader.get(
      dynamicWorkerId(payload, this.compatibilityDate, this.internalAuthIdentity),
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
  return new HostedDynamicWorkerExecutionArtifactMaterializer({
    loader: env.LOADER,
    ...(env.FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE === undefined
      ? {}
      : { compatibilityDate: env.FLAREX_DYNAMIC_WORKER_COMPATIBILITY_DATE }),
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

const DEFAULT_DYNAMIC_WORKER_COMPATIBILITY_DATE = "2026-06-14";
const DYNAMIC_WORKER_MAIN_MODULE = "flarex-runtime-worker.js";

function dynamicWorkerId(
  payload: MaterializedExecutionArtifactPayload,
  compatibilityDate: string,
  internalAuthIdentity: string,
): string {
  return [
    "v1",
    payload.ref.artifactId,
    payload.ref.sourcePackageHash,
    `compat=${compatibilityDate}`,
    `auth=${internalAuthIdentity}`,
  ].join(":");
}

function internalAuthIdentity(
  internalToken: string | undefined,
  internalTokenVersion: string | undefined,
): string {
  if (internalToken === undefined) return "none";
  return internalTokenVersion === undefined ? "enabled-unversioned" : `version-${internalTokenVersion}`;
}

function dynamicWorkerCode(
  sourcePackage: PushSourcePackage,
  compatibilityDate: string,
  internalToken: string | undefined,
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate,
    mainModule: DYNAMIC_WORKER_MAIN_MODULE,
    modules: dynamicWorkerModules(sourcePackage),
    env: internalToken === undefined ? {} : { FLAREX_INTERNAL_TOKEN: internalToken },
    globalOutbound: null,
  };
}

function dynamicWorkerModules(sourcePackage: PushSourcePackage): Record<string, string> {
  const modules: Record<string, string> = {
    [DYNAMIC_WORKER_MAIN_MODULE]: dynamicWorkerRuntimeSource(sourcePackage.execution),
  };
  const seenPaths = new Set([DYNAMIC_WORKER_MAIN_MODULE]);
  for (const module of sourcePackage.modules) {
    if (module.path === DYNAMIC_WORKER_MAIN_MODULE) {
      throw new HostedArtifactRuntimeReservedModulePathError(module.path);
    }
    if (seenPaths.has(module.path)) {
      throw new HostedArtifactRuntimeDuplicateModulePathError(module.path);
    }
    seenPaths.add(module.path);
    if (module.source === undefined) {
      throw new HostedArtifactRuntimeSourceModuleMissingError(module.path);
    }
    modules[module.path] = module.source;
  }
  return modules;
}

function dynamicWorkerRuntimeSource(executionModule: string): string {
  return `// Generated by Flarex artifact-runtime for Dynamic Worker execution.
const executionModulePromise = import(${JSON.stringify(`./${executionModule}`)});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__flarex_internal/")) {
      const unauthorized = authorizeInternalRequest(request, env);
      if (unauthorized !== null) return unauthorized;
    }
    if (url.pathname === "/__flarex_internal/invoke" && request.method === "POST") {
      try {
        return Response.json({ value: normalizeReturnValue(await invoke(await readInternalRequestJson(request))) });
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  },
};

function authorizeInternalRequest(request, env) {
  if (env.FLAREX_INTERNAL_TOKEN === undefined) return null;
  const expected = \`Bearer \${env.FLAREX_INTERNAL_TOKEN}\`;
  if (request.headers.get("authorization") === expected) return null;
  return Response.json({ error: "Unauthorized internal Flarex request." }, { status: 401 });
}

async function readInternalRequestJson(request) {
  try {
    return await request.json();
  } catch (cause) {
    throw new Error("Internal request body must be valid JSON.", { cause });
  }
}

async function invoke(body) {
  const fn = await resolveFunction(body.path);
  const kind = functionKind(fn);
  if (kind !== "query" && kind !== "mutation") {
    throw new Error(\`\${kind ?? "unknown"} execution is not implemented by execution artifacts.\`);
  }
  const handler = handlerFor(fn);
  return await handler(minimalContext(), body.args ?? null);
}

async function resolveFunction(path) {
  const separator = path.indexOf(":");
  const moduleName = separator === -1 ? path : path.slice(0, separator);
  const exportName = separator === -1 ? "default" : path.slice(separator + 1);
  const executionModule = await executionModulePromise;
  const module = executionModule.default?.[moduleName];
  const fn = module?.[exportName];
  if (fn === undefined) throw new Error(\`Unknown Flarex function: \${path}\`);
  return fn;
}

function functionKind(value) {
  if (!isRecord(value)) return null;
  const kinds = [
    ["isQuery", "query"],
    ["isMutation", "mutation"],
    ["isWorkflowMutation", "workflowMutation"],
    ["isAction", "action"],
  ];
  const marked = kinds.filter(([marker]) => marker in value);
  return marked.length === 1 ? marked[0][1] : null;
}

function handlerFor(value) {
  if (isRecord(value) && "_handler" in value && typeof value._handler === "function") {
    return value._handler;
  }
  if (typeof value === "function") return value;
  throw new Error("Flarex function handler is not executable.");
}

function minimalContext() {
  const unsupported = () => {
    throw new Error("Hosted Dynamic Worker db/syscall context is not implemented yet.");
  };
  return {
    auth: {
      getUserIdentity: unsupported,
    },
    db: {
      get: unsupported,
      query: unsupported,
      insert: unsupported,
      patch: unsupported,
      replace: unsupported,
      delete: unsupported,
    },
    runQuery: unsupported,
    runMutation: unsupported,
    scheduler: {
      runAfter: unsupported,
      runAt: unsupported,
    },
    storage: {
      delete: unsupported,
      get: unsupported,
      getUrl: unsupported,
      list: unsupported,
      store: unsupported,
    },
  };
}

function normalizeReturnValue(value) {
  return value === undefined ? null : value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
`;
}

export default createArtifactRuntimeWorker() satisfies ExportedHandler<ArtifactRuntimeEnv>;
