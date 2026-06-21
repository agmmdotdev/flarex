import { Miniflare } from "miniflare";
import type { RunLiveQuerySubscriptionWithInvokeInput } from "@flarex/executor";
import type {
  ExecutionArtifactQuerySessionRequest,
  ExecutionArtifactMaterializer,
  MaterializedExecutionArtifactPayload,
  MaterializedExecutionArtifact,
} from "flarex-backend/artifact-runtime";
import type { InvokeResponse, Json } from "flarex-backend/types";

export type RuntimeBackendDispatcher = (request: Request) => Response | Promise<Response>;

export type LocalMiniflareExecutionArtifactMaterializerOptions = {
  backend: RuntimeBackendDispatcher;
  executorTransport?: "legacy" | "postgres";
  projectId?: string;
  executorToken?: string;
  internalToken?: string;
  compatibilityDate?: string;
};

export type MaterializedArtifactLiveQueryExecutionHostOptions = {
  artifact: MaterializedExecutionArtifact;
  payload: MaterializedExecutionArtifactPayload;
  projectId?: string;
};

export function createMaterializedArtifactLiveQueryExecutionHost(
  options: MaterializedArtifactLiveQueryExecutionHostOptions,
): RunLiveQuerySubscriptionWithInvokeInput["executeQuery"] {
  return async (attempt, subscription) => {
    if (options.artifact.executeQuerySession === undefined) {
      throw new Error(
        "Materialized execution artifact does not support query-session execution.",
      );
    }
    return await options.artifact.executeQuerySession(options.payload, {
      deploymentId: subscription.deploymentId,
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      path: subscription.functionPath,
      args: subscription.argsJson as Json,
      ...(subscription.partitionKey === null ? {} : { partitionKey: subscription.partitionKey }),
      sessionId: attempt.session.sessionId,
    });
  };
}

export class LocalMiniflareExecutionArtifactMaterializer implements ExecutionArtifactMaterializer {
  private readonly backend: RuntimeBackendDispatcher;
  private readonly executorTransport: "legacy" | "postgres" | undefined;
  private readonly projectId: string | undefined;
  private readonly executorToken: string | undefined;
  private readonly internalToken: string | undefined;
  private readonly compatibilityDate: string;

  constructor(options: LocalMiniflareExecutionArtifactMaterializerOptions) {
    this.backend = options.backend;
    this.executorTransport = options.executorTransport;
    this.projectId = options.projectId;
    this.executorToken = options.executorToken;
    this.internalToken = options.internalToken;
    this.compatibilityDate = options.compatibilityDate ?? "2026-06-14";
  }

  async materialize(
    payload: MaterializedExecutionArtifactPayload,
  ): Promise<MaterializedExecutionArtifact> {
    const artifact = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: runtimeWorkerSource(payload.sourcePackage.execution),
        },
        ...payload.sourcePackage.modules.map(module => {
          if (module.source === undefined) {
            throw new Error(`Source package module ${module.path} has no source.`);
          }
          return {
            type: "ESModule" as const,
            path: module.path,
            contents: module.source,
          };
        }),
      ],
      compatibilityDate: this.compatibilityDate,
      bindings: {
        ...(this.executorTransport === undefined
          ? {}
          : { FLAREX_EXECUTOR_TRANSPORT: this.executorTransport }),
        ...(this.projectId === undefined ? {} : { FLAREX_PROJECT_ID: this.projectId }),
        ...(this.executorToken === undefined ? {} : { FLAREX_EXECUTOR_TOKEN: this.executorToken }),
        ...(this.internalToken === undefined ? {} : { FLAREX_INTERNAL_TOKEN: this.internalToken }),
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => this.backend(request),
      },
    });
    return new LocalMiniflareMaterializedExecutionArtifact(artifact, this.internalToken);
  }
}

class LocalMiniflareMaterializedExecutionArtifact implements MaterializedExecutionArtifact {
  private readonly artifact: Miniflare;
  private readonly internalToken: string | undefined;

  constructor(artifact: Miniflare, internalToken: string | undefined) {
    this.artifact = artifact;
    this.internalToken = internalToken;
  }

  async invoke(payload: MaterializedExecutionArtifactPayload): Promise<InvokeResponse> {
    const response = await this.artifact.dispatchFetch(
      "https://flarex-artifact.internal/__flarex_internal/invoke",
      {
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
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `Materialized execution artifact failed with status ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body as InvokeResponse;
  }

  async executeQuerySession(
    payload: MaterializedExecutionArtifactPayload,
    input: ExecutionArtifactQuerySessionRequest,
  ): Promise<Json> {
    const response = await this.artifact.dispatchFetch(
      "https://flarex-artifact.internal/__flarex_internal/query-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-flarex-artifact-id": payload.ref.artifactId,
          "x-flarex-source-package-hash": payload.ref.sourcePackageHash,
          ...(this.internalToken === undefined
            ? {}
            : { authorization: `Bearer ${this.internalToken}` }),
        },
        body: JSON.stringify(input),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `Materialized execution artifact failed with status ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return body as Json;
  }

  async dispose(): Promise<void> {
    await this.artifact.dispose();
  }
}

function runtimeWorkerSource(executionModule: string): string {
  return `// Generated by flarex-dev for local execution-artifact runtime materialization.
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
        return Response.json(await invokeWithBackend(await request.json(), env, request));
      } catch (error) {
        return Response.json({ error: errorMessage(error) }, { status: 400 });
      }
    }
    if (url.pathname === "/__flarex_internal/query-session" && request.method === "POST") {
      try {
        return Response.json(await executeQuerySession(await request.json(), env, request));
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

async function invokeWithBackend(body, env, request) {
  const fn = await resolveFunction(body.path);
  const kind = functionKind(fn);
  if (kind !== "query" && kind !== "mutation") {
    throw new Error(\`\${kind ?? "unknown"} execution is not implemented by execution artifacts.\`);
  }
  const deploymentId = request.headers.get("x-flarex-deployment") ?? body.deploymentId;
  if (!deploymentId) throw new Error("A deploymentId or x-flarex-deployment header is required.");
  const transport = executorTransport(request, env);
  const projectId = projectIdForTransport(transport, body, env, request);
  const partitionKey = request.headers.get("x-flarex-partition") ?? body.partitionKey;

  const start = await startExecution(env.FLAREX_BACKEND, {
    transport,
    deploymentId,
    ...(projectId === undefined ? {} : { projectId }),
    ...(env.FLAREX_EXECUTOR_TOKEN === undefined ? {} : { executorToken: env.FLAREX_EXECUTOR_TOKEN }),
    path: body.path,
    args: body.args ?? null,
    kind,
    ...(partitionKey === undefined ? {} : { partitionKey }),
    ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
  });
  const startedKind = executionKind(start);
  try {
    const handler = handlerFor(fn);
    const db = databaseForSession(
      env.FLAREX_BACKEND,
      deploymentId,
      start.sessionId,
      startedKind,
      transport,
      projectId,
      env.FLAREX_EXECUTOR_TOKEN,
    );
    const value = await handler({ db }, body.args ?? null);
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
    });
    throw error;
  }
}

async function executeQuerySession(body, env, request) {
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
  const transport = executorTransport(request, env);
  if (transport !== "postgres") {
    throw new Error("Query-session execution requires postgres executor transport.");
  }
  const projectId = projectIdForTransport(transport, body, env, request);
  const handler = handlerFor(fn);
  const db = databaseForSession(
    env.FLAREX_BACKEND,
    deploymentId,
    body.sessionId,
    "query",
    transport,
    projectId,
    env.FLAREX_EXECUTOR_TOKEN,
  );
  return await handler({ db }, body.args ?? null);
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
    return await postBackend(backend, "/invoke/start", {
      deploymentId: input.deploymentId,
      projectId: input.projectId,
      path: input.path,
      args: input.args,
      kind: input.kind,
      ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    }, executorHeaders(input.executorToken));
  }
  return await postBackend(backend, \`/deployments/\${input.deploymentId}/executions/start\`, {
    path: input.path,
    args: input.args,
    kind: input.kind,
    ...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}

function executionKind(start) {
  const kind = start.kind ?? start.function?.kind;
  if (kind === "query" || kind === "mutation") return kind;
  throw new Error("Backend execution start response did not include a query or mutation kind.");
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
      order,
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

function executorHeaders(executorToken) {
  return executorToken === undefined ? {} : { authorization: \`Bearer \${executorToken}\` };
}

async function postBackend(backend, path, body, headers = {}) {
  const response = await backend.fetch(\`https://flarex-backend.internal\${path}\`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof value === "object" && value !== null && "error" in value
        ? String(value.error)
        : \`Backend request failed with status \${response.status}\`;
    throw new Error(message);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
`;
}
