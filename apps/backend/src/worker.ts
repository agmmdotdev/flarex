import { ConnectionDO } from "./connectionDO";
import { DeploymentDO } from "./deploymentDO";
import { errorResponse, json, readJson, required } from "./http";
import { ExecutionDO } from "./executionDO";
import {
  executeInvoke,
  invokeErrorResponse,
  parseInvokeKind,
  type BackendFunctionRegistry,
} from "./invoke";
import { PartitionDO } from "./partitionDO";
import { RegistryDO } from "./registryDO";
import {
  connectionObjectName,
  deploymentObjectName,
  executionObjectName,
  partitionObjectName,
  schedulerObjectName,
} from "./routing";
import { SchedulerDO } from "./schedulerDO";
import type {
  CommitRequest,
  DeploymentFunctions,
  DeploymentSchema,
  Env,
  InvokeRequest,
  Json,
} from "./types";

export { ConnectionDO, DeploymentDO, PartitionDO, RegistryDO, SchedulerDO };
export { ExecutionDO };

const functions: BackendFunctionRegistry = {};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/health") {
    return json({ service: "flarex-backend", status: "ok" });
  }

  if (url.pathname === "/invoke" && request.method === "POST") {
    const body = await readJson<Partial<InvokeRequest> & { deploymentId?: string }>(request);
    const deploymentId =
      request.headers.get("x-flarex-deployment") ?? required(body.deploymentId, "deployment id");
    return routeInvoke(env, deploymentId, body);
  }

  if (url.pathname === "/deployments" && ["GET", "POST"].includes(request.method)) {
    return env.REGISTRY.getByName("registry:v1").fetch(request);
  }

  if (parts[0] === "deployments") {
    const deploymentId = required(parts[1], "deployment id");
    if (parts[2] === "schema") {
      return routeDeploymentSchema(request, env, deploymentId);
    }
    if (parts[2] === "functions") {
      return routeDeploymentFunctions(request, env, deploymentId);
    }
    if (parts[2] === "invoke" && request.method === "POST") {
      return routeInvoke(env, deploymentId, await readJson(request));
    }
    if (parts[2] === "executions") {
      return routeExecution(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "partitions") {
      const partitionKey = required(parts[3], "partition key");
      return routePartition(request, env, deploymentId, partitionKey, parts.slice(4), url);
    }
    if (parts[2] === "sync") {
      const sessionId = request.headers.get("x-flarex-session") ?? crypto.randomUUID();
      return env.CONNECTIONS.getByName(connectionObjectName(deploymentId, sessionId)).fetch(request);
    }
    if (parts[2] === "scheduler") {
      return env.SCHEDULERS.getByName(schedulerObjectName(deploymentId)).fetch(request);
    }
  }

  return json({ error: "Not found." }, { status: 404 });
}

async function routeExecution(
  request: Request,
  env: Env,
  deploymentId: string,
  parts: string[],
): Promise<Response> {
  if (parts[0] === "start" && request.method === "POST") {
    const sessionId = crypto.randomUUID();
    const execution = env.EXECUTIONS.getByName(executionObjectName(deploymentId, sessionId));
    const body = await readJson<Record<string, unknown>>(request);
    const response = await execution.fetch("https://flarex.internal/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, deploymentId }),
    });
    if (!response.ok) return response;
    return json({ sessionId, ...((await response.json()) as Record<string, unknown>) });
  }

  const sessionId = required(parts[0], "execution session id");
  const action = required(parts[1], "execution action");
  const execution = env.EXECUTIONS.getByName(executionObjectName(deploymentId, sessionId));
  if (["syscall", "finish", "abort"].includes(action) && request.method === "POST") {
    return execution.fetch(`https://flarex.internal/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await readJson(request)),
    });
  }

  return json({ error: "Execution route not found." }, { status: 404 });
}

async function routeDeploymentFunctions(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  if (request.method === "GET") return deployment.fetch("https://flarex.internal/functions");
  if (request.method === "PUT") {
    const functions = await readJson<DeploymentFunctions>(request);
    return deployment.fetch("https://flarex.internal/functions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(functions),
    });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

async function routeInvoke(
  env: Env,
  deploymentId: string,
  body: Partial<InvokeRequest>,
): Promise<Response> {
  try {
    const kind = parseInvokeKind(body.kind);
    const invokeRequest: InvokeRequest = {
      path: required(body.path, "function path"),
      args: (body.args ?? null) as Json,
      partitionKey: required(body.partitionKey, "partition key"),
      ...(kind === undefined ? {} : { kind }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    };
    return json(await executeInvoke(env, deploymentId, invokeRequest, functions));
  } catch (error) {
    return invokeErrorResponse(error);
  }
}

async function routeDeploymentSchema(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  if (request.method === "GET") return deployment.fetch("https://flarex.internal/schema");
  if (request.method === "PUT") {
    const schema = await readJson<DeploymentSchema>(request);
    return deployment.fetch("https://flarex.internal/schema", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
    });
  }
  return json({ error: "Method not allowed." }, { status: 405 });
}

async function routePartition(
  request: Request,
  env: Env,
  deploymentId: string,
  partitionKey: string,
  parts: string[],
  originalUrl: URL,
): Promise<Response> {
  const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
  const action = parts[0];

  if (action === "begin" && request.method === "POST") {
    return partition.fetch("https://flarex.internal/begin", { method: "POST" });
  }
  if (action === "commit" && request.method === "POST") {
    const commit = await readJson<CommitRequest>(request);
    return partition.fetch("https://flarex.internal/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(commit),
    });
  }
  if (action === "schema-cache" && request.method === "PUT") {
    const schema = await readJson<DeploymentSchema>(request);
    return partition.fetch("https://flarex.internal/schema-cache", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schema),
    });
  }
  if (action === "document" && request.method === "GET") {
    return partition.fetch(`https://flarex.internal/document?${originalUrl.searchParams}`);
  }
  if (action === "index" && request.method === "GET") {
    return partition.fetch(`https://flarex.internal/index?${originalUrl.searchParams}`);
  }

  return json({ error: "Partition route not found." }, { status: 404 });
}
