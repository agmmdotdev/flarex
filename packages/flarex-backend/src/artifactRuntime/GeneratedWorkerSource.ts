export type GeneratedExecutionWorkerSourceOptions = {
  readonly headerComment: string;
  readonly executionModule: string;
  readonly backendBinding: string;
  readonly backendBaseUrl: string;
  readonly missingBackendBindingMessage: string;
  readonly includeQuerySessionRoute?: boolean;
  readonly includeUnsupportedCapabilities?: boolean;
};

export function generatedExecutionWorkerSource(
  options: GeneratedExecutionWorkerSourceOptions,
): string {
  return `${options.headerComment}
const executionModulePromise = import(${JSON.stringify(`./${options.executionModule}`)});
const BACKEND_BINDING = ${JSON.stringify(options.backendBinding)};
const BACKEND_BASE_URL = ${JSON.stringify(options.backendBaseUrl)};
const MISSING_BACKEND_BINDING_MESSAGE = ${JSON.stringify(options.missingBackendBindingMessage)};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__flarex_internal/")) {
      const unauthorized = authorizeInternalRequest(request, env);
      if (unauthorized !== null) return unauthorized;
    }
    if (url.pathname === "/__flarex_internal/invoke" && request.method === "POST") {
      try {
        return Response.json(await invokeWithBackend(await readInternalRequestJson(request), env, request));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
    }
${options.includeQuerySessionRoute === true ? querySessionRouteSource() : ""}
    return Response.json({ error: "Not found." }, { status: 404 });
  },
};

function authorizeInternalRequest(request, env) {
  if (env.FLAREX_INTERNAL_TOKEN === undefined) return null;
  const expected = \`Bearer \${env.FLAREX_INTERNAL_TOKEN}\`;
  if (request.headers.get("authorization") === expected) return null;
  return Response.json({ error: "Unauthorized internal Flarex request." }, { status: 401 });
}

class InternalRequestJsonError extends Error {
  constructor(cause) {
    super("Internal request body must be valid JSON.");
    this.name = "InternalRequestJsonError";
    this.cause = cause;
  }
}

async function readInternalRequestJson(request) {
  try {
    return await request.json();
  } catch (cause) {
    throw new InternalRequestJsonError(cause);
  }
}

async function invokeWithBackend(body, env, request) {
  const fn = await resolveFunction(body.path);
  const kind = functionKind(fn);
  if (kind !== "query" && kind !== "mutation") {
    throw new Error(\`\${kind ?? "unknown"} execution is not implemented by execution artifacts.\`);
  }
  const deploymentId = request.headers.get("x-flarex-deployment") ?? body.deploymentId;
  if (!deploymentId) throw new Error("A deploymentId or x-flarex-deployment header is required.");
  const backend = backendBinding(env);
  const transport = executorTransport(request, env);
  const projectId = projectIdForTransport(transport, body, env, request);
  const partitionKey = request.headers.get("x-flarex-partition") ?? body.partitionKey;
  const maxAttempts = invokeMaxAttempts(transport, kind, env);
  const expectedVisibility = functionVisibility(fn);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = await startExecution(backend, {
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
        backend,
        deploymentId,
        sessionId: start.sessionId,
        kind: startedKind,
        transport,
        nestedCallDepth: 0,
        projectId,
        executorToken: env.FLAREX_EXECUTOR_TOKEN,
      });
      const value = normalizeReturnValue(await handler(ctx, body.args ?? null));
      return await finishExecution(backend, {
        transport,
        deploymentId,
        ...(projectId === undefined ? {} : { projectId }),
        ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
        sessionId: start.sessionId,
        value,
      });
    } catch (error) {
      await abortExecution(backend, {
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

${options.includeQuerySessionRoute === true ? querySessionImplementationSource() : ""}
function backendBinding(env) {
  const backend = env[BACKEND_BINDING];
  if (typeof backend?.fetch !== "function") {
    throw new Error(MISSING_BACKEND_BINDING_MESSAGE);
  }
  return backend;
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

async function startExecution(backend, input) {
  if (input.transport === "postgres") {
    return executionStartResponse(await postBackend(backend, "/invoke/start", {
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
  return executionStartResponse(await postBackend(backend, \`/deployments/\${input.deploymentId}/executions/start\`, {
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

async function finishExecution(backend, input) {
  if (input.transport === "postgres") {
    return await postBackend(backend, "/invoke/finish", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      value: input.value,
    }, executorHeaders(input.executorToken));
  }
  return await postBackend(
    backend,
    \`/deployments/\${input.deploymentId}/executions/\${input.sessionId}/finish\`,
    { value: input.value },
  );
}

async function abortExecution(backend, input) {
  if (input.transport === "postgres") {
    await postBackend(backend, "/invoke/abort", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
    }, executorHeaders(input.executorToken)).catch(() => undefined);
    return;
  }
  await postBackend(
    backend,
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

function databaseForSession(backend, deploymentId, sessionId, kind, transport, projectId, executorToken) {
  const syscall = async (body) => {
    if (transport === "postgres") {
      const response = await postBackend(backend, "/invoke/syscall", {
        deploymentId,
        projectId,
        sessionId,
        ...body,
      }, executorHeaders(executorToken));
      return response.value;
    }
    return await postBackend(backend, \`/deployments/\${deploymentId}/executions/\${sessionId}/syscall\`, body);
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
    input.backend,
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
${options.includeUnsupportedCapabilities === true ? unsupportedCapabilityContextSource() : ""}
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
    backend: input.backend,
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

${options.includeUnsupportedCapabilities === true ? unsupportedCapabilityImplementationSource() : ""}
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

async function postBackend(backend, path, body, headers = {}) {
  const response = await backend.fetch(\`\${BACKEND_BASE_URL}\${path}\`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const value = await readBackendResponseJson(response);
  if (!response.ok) {
    const code = backendErrorCode(value);
    const message =
      backendErrorMessage(value) ??
      code ??
      \`Backend request failed with status \${response.status}\`;
    throw new BackendRequestError(response.status, code, message);
  }
  return value;
}

async function readBackendResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function backendErrorCode(value) {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }
  return undefined;
}

function backendErrorMessage(value) {
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

function querySessionRouteSource(): string {
  return `    if (url.pathname === "/__flarex_internal/query-session" && request.method === "POST") {
      try {
        return Response.json(
          await executeQuerySession(await readInternalRequestJson(request), env, request),
        );
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
    }
`;
}

function querySessionImplementationSource(): string {
  return `async function executeQuerySession(body, env, request) {
  const fn = await resolveFunction(body.path);
  const kind = functionKind(fn);
  if (kind !== "query") {
    throw new Error(\`\${kind ?? "unknown"} execution is not a query.\`);
  }
  const deploymentId = request.headers.get("x-flarex-deployment") ?? body.deploymentId;
  if (!deploymentId) throw new Error("A deploymentId or x-flarex-deployment header is required.");
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    throw new Error("sessionId is required for query-session execution.");
  }
  const backend = backendBinding(env);
  const transport = executorTransport(request, env);
  if (transport !== "postgres") {
    throw new Error("Query-session execution requires postgres executor transport.");
  }
  const projectId = projectIdForTransport(transport, body, env, request);
  const handler = handlerFor(fn);
  const ctx = executionContextForSession({
    backend,
    deploymentId,
    sessionId: body.sessionId,
    kind: "query",
    transport,
    nestedCallDepth: 0,
    projectId,
    executorToken: env.FLAREX_EXECUTOR_TOKEN,
  });
  return await handler(ctx, body.args ?? null);
}

`;
}

function unsupportedCapabilityContextSource(): string {
  return `    auth: {
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
`;
}

function unsupportedCapabilityImplementationSource(): string {
  return `function unsupportedCapability(name) {
  return () => {
    throw new Error(\`Hosted Dynamic Worker capability \${name} is not implemented yet.\`);
  };
}

`;
}


export type GeneratedProjectWorkerExecutorBridgeSourceOptions = {
  readonly backendBaseUrl: string;
};

export function generatedProjectWorkerExecutorBridgeSource(
  options: GeneratedProjectWorkerExecutorBridgeSourceOptions,
): string {
  return `type InvokeBody = {
  path: string;
  args: unknown;
  partitionKey?: string;
  deploymentId?: string;
  projectId?: string;
  idempotencyKey?: string;
};

type ExecutorTransport = "legacy" | "postgres";

type ExecutionStartResponse = {
  sessionId: string;
  kind?: "query" | "mutation";
  function?: { kind: "query" | "mutation" };
};

const DEFAULT_INVOKE_MAX_ATTEMPTS = 8;
const MAX_NESTED_CALL_DEPTH = 8;
const RETRYABLE_INVOKE_ERROR_CODES = new Set([
  "InvokeSessionOccConflictError",
  "InvokeSessionTableOccConflictError",
  "InvokeSessionIndexOccConflictError",
  "40001",
]);

const GENERATED_PROJECT_WORKER_BACKEND_BASE_URL = ${JSON.stringify(options.backendBaseUrl)};

class BackendRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
    this.code = code;
  }
}

class InvokeRetryExhaustedError extends Error {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super("Flarex invoke retry exhausted after " + attempts + " attempts: " + invokeErrorMessage(cause));
    this.name = "InvokeRetryExhaustedError";
    this.attempts = attempts;
  }
}

async function invokeWithBackend(body: InvokeBody, env: Env, request: Request): Promise<unknown> {
  const fn = functions[body.path];
  if (!fn) throw new Error(\`Unknown Flarex function: \${body.path}\`);
  const metadata = functionMetadataByPath.get(body.path);
  if (!metadata) throw new Error(\`Missing analyzed metadata for Flarex function: \${body.path}\`);
  if (metadata.kind !== "query" && metadata.kind !== "mutation") {
    throw new Error(\`\${metadata.kind} execution is not implemented by /invoke\`);
  }
  validateValue(metadata.args, body.args, "$args", { validateId: validateTableNameId });

  const deploymentId =
    request.headers.get("x-flarex-deployment") ?? body.deploymentId ?? env.FLAREX_DEPLOYMENT_ID;
  if (!deploymentId) throw new Error("A deploymentId or x-flarex-deployment header is required.");
  const transport = executorTransport(request, env);
  const projectId = projectIdForTransport(transport, body, env, request);
  const partitionKey = request.headers.get("x-flarex-partition") ?? body.partitionKey;
  const maxAttempts = invokeMaxAttempts(transport, metadata.kind, env);
  const expectedVisibility =
    new URL(request.url).pathname === "/__flarex_internal/invoke"
      ? metadata.visibility
      : "public";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const start = await startExecution(env.FLAREX_BACKEND, {
      transport,
      deploymentId,
      ...(projectId === undefined ? {} : { projectId }),
      ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
      path: body.path,
      args: body.args,
      kind: metadata.kind,
      visibility: expectedVisibility,
      ...(partitionKey === undefined ? {} : { partitionKey }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    });
    const startedKind = executionKind(start);
    try {
      const ctx = executionContextForSession({
        backend: env.FLAREX_BACKEND,
        deploymentId,
        sessionId: start.sessionId,
        kind: startedKind,
        transport,
        nestedCallDepth: 0,
        ...(projectId === undefined ? {} : { projectId }),
        ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
      });
      const value = normalizeReturnValue(await fn._handler(ctx as never, body.args as never));
      validateFunctionReturn(metadata.returns, value);
      return await finishExecution(env.FLAREX_BACKEND, {
        transport,
        deploymentId,
        ...(projectId === undefined ? {} : { projectId }),
        ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
        sessionId: start.sessionId,
        value,
      });
    } catch (error) {
      await abortExecution(env.FLAREX_BACKEND, {
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

function executorTransport(request: Request, env: Env): ExecutorTransport {
  const transport =
    request.headers.get("x-flarex-executor-transport") ?? env.FLAREX_EXECUTOR_TRANSPORT ?? "legacy";
  if (transport === "legacy" || transport === "postgres") return transport;
  throw new Error(\`Unsupported Flarex executor transport: \${transport}\`);
}

function projectIdForTransport(
  transport: ExecutorTransport,
  body: InvokeBody,
  env: Env,
  request: Request,
): string | undefined {
  if (transport === "legacy") return undefined;
  const projectId = request.headers.get("x-flarex-project") ?? body.projectId ?? env.FLAREX_PROJECT_ID;
  if (!projectId) {
    throw new Error("A projectId, x-flarex-project header, or FLAREX_PROJECT_ID binding is required for postgres executor transport.");
  }
  return projectId;
}

async function startExecution(
  backend: Fetcher,
  input: {
    transport: ExecutorTransport;
    deploymentId: string;
    projectId?: string;
    executorToken?: string;
    path: string;
    args: unknown;
    kind: "query" | "mutation";
    visibility: (typeof functionMetadata)[number]["visibility"];
    partitionKey?: string;
    idempotencyKey?: string;
  },
): Promise<ExecutionStartResponse> {
  if (input.transport === "postgres") {
    return await postBackend<ExecutionStartResponse>(backend, "/invoke/start", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      path: input.path,
      args: input.args,
      kind: input.kind,
      visibility: input.visibility,
      ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    }, executorHeaders(input.executorToken));
  }
  return await postBackend<ExecutionStartResponse>(
    backend,
    \`/deployments/\${input.deploymentId}/executions/start\`,
    {
      path: input.path,
      args: input.args,
      kind: input.kind,
      ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    },
  );
}

function executionKind(start: ExecutionStartResponse): "query" | "mutation" {
  const kind = start.kind ?? start.function?.kind;
  if (kind === "query" || kind === "mutation") return kind;
  throw new Error("Backend execution start response did not include a query or mutation kind.");
}

function invokeMaxAttempts(
  transport: ExecutorTransport,
  kind: "query" | "mutation",
  env: Env,
): number {
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

function isRetryableInvokeAttempt(
  transport: ExecutorTransport,
  kind: "query" | "mutation",
  error: unknown,
): boolean {
  return (
    transport === "postgres" &&
    kind === "mutation" &&
    isRetryableInvokeError(error)
  );
}

function isRetryableInvokeError(error: unknown): boolean {
  if (error instanceof BackendRequestError) {
    return error.status === 409 && error.code !== undefined && RETRYABLE_INVOKE_ERROR_CODES.has(error.code);
  }
  if (!isRecord(error)) return false;
  const name = error.name;
  const code = error.code;
  return (
    (typeof name === "string" && RETRYABLE_INVOKE_ERROR_CODES.has(name)) ||
    (typeof code === "string" && RETRYABLE_INVOKE_ERROR_CODES.has(code))
  );
}

async function finishExecution(
  backend: Fetcher,
  input: {
    transport: ExecutorTransport;
    deploymentId: string;
    projectId?: string;
    executorToken?: string;
    sessionId: string;
    value: unknown;
  },
): Promise<unknown> {
  if (input.transport === "postgres") {
    return await postBackend(backend, "/invoke/finish", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      value: input.value,
    }, executorHeaders(input.executorToken));
  }
  return await postBackend(
    backend,
    \`/deployments/\${input.deploymentId}/executions/\${input.sessionId}/finish\`,
    { value: input.value },
  );
}

async function abortExecution(
  backend: Fetcher,
  input: {
    transport: ExecutorTransport;
    deploymentId: string;
    projectId?: string;
    executorToken?: string;
    sessionId: string;
  },
): Promise<void> {
  if (input.transport === "postgres") {
    await postBackend(
      backend,
      "/invoke/abort",
      {
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        sessionId: input.sessionId,
      },
      executorHeaders(input.executorToken),
    ).catch(() => undefined);
    return;
  }
  await postBackend(
    backend,
    \`/deployments/\${input.deploymentId}/executions/\${input.sessionId}/abort\`,
    {},
  ).catch(() => undefined);
}

function databaseForSession(
  backend: Fetcher,
  deploymentId: string,
  sessionId: string,
  kind: "query" | "mutation",
  transport: ExecutorTransport,
  projectId?: string,
  executorToken?: string,
): DatabaseWriter {
  const syscall = async (body: Record<string, unknown>) => {
    if (transport === "postgres") {
      const response = await postBackend<{ value: unknown }>(backend, "/invoke/syscall", {
        deploymentId,
        projectId,
        sessionId,
        ...body,
      }, executorHeaders(executorToken));
      return response.value;
    }
    return await postBackend<unknown>(
      backend,
      \`/deployments/\${deploymentId}/executions/\${sessionId}/syscall\`,
      body,
    );
  };
  const query = (request: DatabaseQueryRequest) =>
    syscall({ op: "query", request }) as Promise<DatabaseQueryResult>;
  return {
    get: id => syscall({ op: "get", id }) as never,
    query: table => createQueryInitializer(table, query),
    insert: async (table, value) => {
      if (kind !== "mutation") throw new Error("Cannot insert during a query.");
      return (await syscall({ op: "insert", table, value })) as never;
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

function executionContextForSession(input: {
  backend: Fetcher;
  deploymentId: string;
  sessionId: string;
  kind: "query" | "mutation";
  transport: ExecutorTransport;
  nestedCallDepth: number;
  projectId?: string;
  executorToken?: string;
}): {
  db: DatabaseWriter;
  runQuery: (reference: Parameters<typeof getFunctionName>[0], args?: unknown) => Promise<unknown>;
  runMutation: (reference: Parameters<typeof getFunctionName>[0], args?: unknown) => Promise<unknown>;
} {
  const db = databaseForSession(
    input.backend,
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
  };
}

async function executeNestedFunction(input: {
  backend: Fetcher;
  deploymentId: string;
  sessionId: string;
  kind: "query" | "mutation";
  transport: ExecutorTransport;
  nestedCallDepth: number;
  projectId?: string;
  executorToken?: string;
  expectedKind: "query" | "mutation";
  path: string;
  args: unknown;
}): Promise<unknown> {
  assertNestedCallDepth(input.nestedCallDepth);
  const fn = functions[input.path];
  if (!fn) throw new Error(\`Unknown Flarex function: \${input.path}\`);
  const metadata = functionMetadataByPath.get(input.path);
  if (!metadata) throw new Error(\`Missing analyzed metadata for Flarex function: \${input.path}\`);
  if (metadata.kind !== input.expectedKind) {
    throw new Error(\`ctx.run\${input.expectedKind === "query" ? "Query" : "Mutation"} expected a \${input.expectedKind}, got \${metadata.kind}.\`);
  }
  validateValue(metadata.args, input.args, "$args", { validateId: validateTableNameId });
  const nestedKind = input.expectedKind === "query" ? "query" : input.kind;
  const nestedCtx = executionContextForSession({
    backend: input.backend,
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    kind: nestedKind,
    transport: input.transport,
    nestedCallDepth: input.nestedCallDepth + 1,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.executorToken === undefined ? {} : { executorToken: input.executorToken }),
  });
  const value = normalizeReturnValue(await fn._handler(nestedCtx as never, input.args as never));
  validateFunctionReturn(metadata.returns, value);
  return value;
}

function assertNestedCallDepth(depth: number): void {
  if (depth < MAX_NESTED_CALL_DEPTH) return;
  throw new Error(
    "Maximum nested function call depth exceeded. Do you have an infinite loop in your app?",
  );
}

function executorHeaders(executorToken: string | undefined): Record<string, string> {
  return executorToken === undefined ? {} : { authorization: \`Bearer \${executorToken}\` };
}

function normalizeReturnValue(value: unknown): unknown {
  return value === undefined ? null : value;
}

async function postBackend<T>(
  backend: Fetcher,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await backend.fetch(\`\${GENERATED_PROJECT_WORKER_BACKEND_BASE_URL}\${path}\`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const value = await readBackendResponseJson(response);
  if (!response.ok) {
    const code = backendErrorCode(value);
    const message =
      backendErrorMessage(value) ??
      code ??
      \`Backend request failed with status \${response.status}\`;
    throw new BackendRequestError(response.status, code, message);
  }
  return value as T;
}

async function readBackendResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function backendErrorCode(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.error === "string") {
    return value.error;
  }
  return undefined;
}

function backendErrorMessage(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.message === "string") {
    return value.message;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invokeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
`;
}
