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

type ExecutorTransport = "legacy" | "postgres";

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
      ...(options.executorToken === undefined ? {} : { FLAREX_EXECUTOR_TOKEN: options.executorToken }),
      ...(options.executorTransport === undefined
        ? {}
        : { FLAREX_EXECUTOR_TRANSPORT: options.executorTransport }),
      ...(options.invokeMaxAttempts === undefined
        ? {}
        : { FLAREX_INVOKE_MAX_ATTEMPTS: options.invokeMaxAttempts }),
      ...(options.projectId === undefined ? {} : { FLAREX_PROJECT_ID: options.projectId }),
      ...(options.internalToken === undefined ? {} : { FLAREX_INTERNAL_TOKEN: options.internalToken }),
    },
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
        return Response.json(await invoke(await readInternalRequestJson(request), env, request));
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

async function invoke(body, env, request) {
  const fn = await resolveFunction(body.path);
  const kind = functionKind(fn);
  if (kind !== "query" && kind !== "mutation") {
    throw new Error(\`\${kind ?? "unknown"} execution is not implemented by execution artifacts.\`);
  }
  const deploymentId = request.headers.get("x-flarex-deployment") ?? body.deploymentId;
  if (!deploymentId) throw new Error("A deploymentId or x-flarex-deployment header is required.");
  if (typeof env.FLAREX_EXECUTOR?.fetch !== "function") {
    throw new Error("FLAREX_EXECUTOR service binding is required for hosted Dynamic Worker execution.");
  }
  const transport = executorTransport(request, env);
  const projectId = projectIdForTransport(transport, body, env, request);
  const partitionKey = request.headers.get("x-flarex-partition") ?? body.partitionKey;
  const maxAttempts = invokeMaxAttempts(transport, kind, env);
  const expectedVisibility = functionVisibility(fn);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = await startExecution(env.FLAREX_EXECUTOR, {
      transport,
      deploymentId,
      ...(projectId === undefined ? {} : { projectId }),
      ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
      path: body.path,
      args: body.args ?? null,
      kind,
      visibility: expectedVisibility,
      ...(partitionKey === undefined ? {} : { partitionKey }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    });
    const startedKind = executionKind(start);
    if (startedKind !== kind) {
      throw new Error(\`Executor start response kind mismatch: expected \${kind}, got \${startedKind}.\`);
    }
    try {
      const handler = handlerFor(fn);
      const ctx = executionContextForSession({
        executor: env.FLAREX_EXECUTOR,
        deploymentId,
        sessionId: start.sessionId,
        kind: startedKind,
        transport,
        nestedCallDepth: 0,
        projectId,
        executorToken: env.FLAREX_EXECUTOR_TOKEN,
      });
      const value = normalizeReturnValue(await handler(ctx, body.args ?? null));
      return await finishExecution(env.FLAREX_EXECUTOR, {
        transport,
        deploymentId,
        ...(projectId === undefined ? {} : { projectId }),
        ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
        sessionId: start.sessionId,
        value,
      });
    } catch (error) {
      await abortExecution(env.FLAREX_EXECUTOR, {
        transport,
        deploymentId,
        ...(projectId === undefined ? {} : { projectId }),
        ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
        sessionId: start.sessionId,
      }).catch(() => undefined);
      if (isRetryableInvokeAttempt(transport, startedKind, error)) {
        if (attempt < maxAttempts) {
          continue;
        }
        throw new InvokeRetryExhaustedError(maxAttempts, error);
      }
      throw error;
    }
  }

  throw new Error("Flarex invoke retry policy did not run any attempts.");
}

function executorTransport(request, env) {
  const transport =
    request.headers.get("x-flarex-executor-transport") ?? env.FLAREX_EXECUTOR_TRANSPORT ?? "legacy";
  if (transport === "legacy" || transport === "postgres") return transport;
  throw new Error(\`Unsupported Flarex executor transport: \${transport}\`);
}

function projectIdForTransport(transport, body, env, request) {
  if (transport === "legacy") return undefined;
  const projectId = request.headers.get("x-flarex-project") ?? body.projectId ?? env.FLAREX_PROJECT_ID;
  if (!projectId) {
    throw new Error("A projectId, x-flarex-project header, or FLAREX_PROJECT_ID binding is required for postgres executor transport.");
  }
  return projectId;
}

async function startExecution(executor, input) {
  if (input.transport === "postgres") {
    return executionStartResponse(await postExecutor(executor, "/invoke/start", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      path: input.path,
      args: input.args,
      kind: input.kind,
      visibility: input.visibility,
      ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    }, executorHeaders(input.executorToken)));
  }
  return executionStartResponse(await postExecutor(executor, \`/deployments/\${input.deploymentId}/executions/start\`, {
    path: input.path,
    args: input.args,
    kind: input.kind,
    ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  }));
}

function executionStartResponse(value) {
  if (!isRecord(value) || typeof value.sessionId !== "string" || value.sessionId.length === 0) {
    throw new Error("Executor start response did not include a sessionId.");
  }
  executionKind(value);
  return value;
}

function executionKind(start) {
  const kind = start.kind ?? start.function?.kind;
  if (kind === "query" || kind === "mutation") return kind;
  throw new Error("Backend execution start response did not include a query or mutation kind.");
}

const DEFAULT_INVOKE_MAX_ATTEMPTS = 8;
const MAX_NESTED_CALL_DEPTH = 8;
const RETRYABLE_INVOKE_ERROR_CODES = new Set([
  "InvokeSessionOccConflictError",
  "InvokeSessionTableOccConflictError",
  "InvokeSessionIndexOccConflictError",
  "40001",
]);

function invokeMaxAttempts(transport, kind, env) {
  if (transport !== "postgres" || kind !== "mutation") return 1;
  if (env.FLAREX_INVOKE_MAX_ATTEMPTS === undefined) {
    return DEFAULT_INVOKE_MAX_ATTEMPTS;
  }
  const value = Number(env.FLAREX_INVOKE_MAX_ATTEMPTS);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error("FLAREX_INVOKE_MAX_ATTEMPTS must be a positive integer.");
  }
  return value;
}

function isRetryableInvokeAttempt(transport, kind, error) {
  return (
    transport === "postgres" &&
    kind === "mutation" &&
    isRetryableInvokeError(error)
  );
}

function isRetryableInvokeError(error) {
  if (error instanceof BackendRequestError) {
    return error.status === 409 && error.code !== undefined && RETRYABLE_INVOKE_ERROR_CODES.has(error.code);
  }
  if (!isRecord(error)) return false;
  return (
    (typeof error.name === "string" && RETRYABLE_INVOKE_ERROR_CODES.has(error.name)) ||
    (typeof error.code === "string" && RETRYABLE_INVOKE_ERROR_CODES.has(error.code))
  );
}

async function finishExecution(executor, input) {
  if (input.transport === "postgres") {
    return await postExecutor(executor, "/invoke/finish", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      value: input.value,
    }, executorHeaders(input.executorToken));
  }
  return await postExecutor(
    executor,
    \`/deployments/\${input.deploymentId}/executions/\${input.sessionId}/finish\`,
    { value: input.value },
  );
}

async function abortExecution(executor, input) {
  if (input.transport === "postgres") {
    await postExecutor(executor, "/invoke/abort", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
    }, executorHeaders(input.executorToken)).catch(() => undefined);
    return;
  }
  await postExecutor(
    executor,
    \`/deployments/\${input.deploymentId}/executions/\${input.sessionId}/abort\`,
    {},
  ).catch(() => undefined);
}

function functionVisibility(value) {
  if (!isRecord(value)) {
    throw new Error("Flarex function is missing visibility metadata.");
  }
  const publicFunction = "isPublic" in value;
  const internalFunction = "isInternal" in value;
  if (publicFunction === internalFunction) {
    throw new Error("Flarex function must be exactly one of public or internal.");
  }
  return publicFunction ? "public" : "internal";
}

function getFunctionName(reference) {
  if (typeof reference === "string" && reference.length > 0) {
    return reference;
  }
  if (
    isRecord(reference) &&
    typeof reference._path === "string" &&
    reference._path.length > 0
  ) {
    return reference._path;
  }
  throw new Error("ctx.runQuery and ctx.runMutation require a Flarex function reference.");
}

function databaseForSession(executor, deploymentId, sessionId, kind, transport, projectId, executorToken) {
  const syscall = async (body) => {
    if (transport === "postgres") {
      const response = await postExecutor(executor, "/invoke/syscall", {
        deploymentId,
        projectId,
        sessionId,
        ...body,
      }, executorHeaders(executorToken));
      return response.value;
    }
    return await postExecutor(executor, \`/deployments/\${deploymentId}/executions/\${sessionId}/syscall\`, body);
  };
  const query = (queryRequest) =>
    syscall({ op: "query", request: queryRequest });
  return {
    get: id => syscall({ op: "get", id }),
    query: table => createQueryInitializer(table, query),
    insert: async (table, value) => {
      if (kind !== "mutation") throw new Error("Cannot insert during a query.");
      return await syscall({ op: "insert", table, value });
    },
    patch: async (id, value) => {
      if (kind !== "mutation") throw new Error("Cannot patch during a query.");
      await syscall({ op: "patch", id, value });
    },
    replace: async (id, value) => {
      if (kind !== "mutation") throw new Error("Cannot replace during a query.");
      await syscall({ op: "replace", id, value });
    },
    delete: async id => {
      if (kind !== "mutation") throw new Error("Cannot delete during a query.");
      await syscall({ op: "delete", id });
    },
  };
}

function executionContextForSession(input) {
  const db = databaseForSession(
    input.executor,
    input.deploymentId,
    input.sessionId,
    input.kind,
    input.transport,
    input.projectId,
    input.executorToken,
  );
  return {
    db,
    runQuery: (reference, args) =>
      executeNestedFunction({
        ...input,
        expectedKind: "query",
        args: args === undefined ? {} : args,
        path: getFunctionName(reference),
      }),
    runMutation: (reference, args) => {
      if (input.kind !== "mutation") {
        throw new Error("Cannot run mutation during a query.");
      }
      return executeNestedFunction({
        ...input,
        expectedKind: "mutation",
        args: args === undefined ? {} : args,
        path: getFunctionName(reference),
      });
    },
    auth: {
      getUserIdentity: unsupportedCapability("auth.getUserIdentity"),
    },
    scheduler: {
      runAfter: unsupportedCapability("scheduler.runAfter"),
      runAt: unsupportedCapability("scheduler.runAt"),
    },
    storage: {
      delete: unsupportedCapability("storage.delete"),
      get: unsupportedCapability("storage.get"),
      getUrl: unsupportedCapability("storage.getUrl"),
      list: unsupportedCapability("storage.list"),
      store: unsupportedCapability("storage.store"),
    },
  };
}

async function executeNestedFunction(input) {
  assertNestedCallDepth(input.nestedCallDepth);
  const fn = await resolveFunction(input.path);
  const kind = functionKind(fn);
  if (kind !== input.expectedKind) {
    throw new Error(\`ctx.run\${input.expectedKind === "query" ? "Query" : "Mutation"} expected a \${input.expectedKind}, got \${kind ?? "unknown"}.\`);
  }
  const nestedKind = input.expectedKind === "query" ? "query" : input.kind;
  const ctx = executionContextForSession({
    executor: input.executor,
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    kind: nestedKind,
    transport: input.transport,
    nestedCallDepth: input.nestedCallDepth + 1,
    projectId: input.projectId,
    executorToken: input.executorToken,
  });
  const handler = handlerFor(fn);
  return normalizeReturnValue(await handler(ctx, input.args));
}

function assertNestedCallDepth(depth) {
  if (depth < MAX_NESTED_CALL_DEPTH) return;
  throw new Error(
    "Maximum nested function call depth exceeded. Do you have an infinite loop in your app?",
  );
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

function createQueryInitializer(table, query, index, range, limit, cursor, order) {
  const execute = (nextLimit, nextCursor) => {
    const resolvedLimit = nextLimit ?? limit;
    const resolvedCursor = nextCursor ?? cursor;
    return query({
      table,
      ...(index === undefined ? {} : { index }),
      ...(range === undefined ? {} : { range }),
      ...(resolvedLimit === undefined ? {} : { limit: resolvedLimit }),
      ...(resolvedCursor === undefined ? {} : { cursor: resolvedCursor }),
      ...(order === undefined ? {} : { order }),
    });
  };
  return {
    withIndex: (nextIndex, buildRange) => {
      const builder = rangeBuilder();
      const nextRange = buildRange === undefined ? undefined : buildRange(builder);
      return createQueryInitializer(table, query, nextIndex, nextRange, limit, cursor, order);
    },
    order: nextOrder => createQueryInitializer(table, query, index, range, limit, cursor, nextOrder),
    collect: async () => (await execute()).page,
    take: async count => (await execute(count)).page,
    first: async () => (await execute(1)).page[0] ?? null,
    unique: async () => {
      const documents = (await execute(2)).page;
      if (documents.length > 1) throw new Error("Query returned more than one document.");
      return documents[0] ?? null;
    },
    paginate: options => execute(options.numItems, options.cursor === null ? undefined : options.cursor),
  };
}

function rangeBuilder(expressions = []) {
  return {
    expressions,
    eq: (field, value) => rangeBuilder([...expressions, { op: "eq", field, value }]),
    gt: (field, value) => rangeBuilder([...expressions, { op: "gt", field, value }]),
    gte: (field, value) => rangeBuilder([...expressions, { op: "gte", field, value }]),
    lt: (field, value) => rangeBuilder([...expressions, { op: "lt", field, value }]),
    lte: (field, value) => rangeBuilder([...expressions, { op: "lte", field, value }]),
  };
}

function unsupportedCapability(name) {
  return () => {
    throw new Error(\`Hosted Dynamic Worker capability \${name} is not implemented yet.\`);
  };
}

function executorHeaders(executorToken) {
  return executorToken === undefined ? {} : { authorization: \`Bearer \${executorToken}\` };
}

function normalizeReturnValue(value) {
  return value === undefined ? null : value;
}

class BackendRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
    this.code = code;
  }
}

class InvokeRetryExhaustedError extends Error {
  constructor(attempts, cause) {
    super(\`Flarex invoke retry exhausted after \${attempts} attempts: \${errorMessage(cause)}\`);
    this.name = "InvokeRetryExhaustedError";
    this.attempts = attempts;
  }
}

async function postExecutor(executor, path, body, headers = {}) {
  const response = await executor.fetch(\`https://flarex-executor.internal\${path}\`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const value = await readExecutorResponseJson(response);
  if (!response.ok) {
    const code = executorErrorCode(value);
    const message =
      executorErrorMessage(value) ??
      code ??
      \`Executor request failed with status \${response.status}\`;
    throw new BackendRequestError(response.status, code, message);
  }
  return value;
}

async function readExecutorResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function executorErrorCode(value) {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }
  return undefined;
}

function executorErrorMessage(value) {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return undefined;
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
