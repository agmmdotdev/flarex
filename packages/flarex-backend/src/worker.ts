import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  R2BackendExecutionArtifactStore,
  type BackendExecutionArtifactStore,
} from "./artifactStore";
import {
  ServiceBindingExecutionArtifactRuntime,
  type BackendExecutionArtifactRuntime,
} from "./artifactRuntime";
import { ConnectionDO } from "./connectionDO";
import { DeliveryDO } from "./deliveryDO";
import { DeploymentDO } from "./deploymentDO";
import { errorResponse, HttpError, json, readJson, required } from "./http";
import { ExecutionDO } from "./executionDO";
import {
  executeInvoke,
  invokeErrorResponse,
  loadActiveDeployment,
  parseInvokeKind,
  type BackendFunctionRegistry,
} from "./invoke";
import {
  deliverLiveQueryChangesToConnections,
  liveQueryDeliveryChangesFromBody,
} from "./liveQueryDelivery";
import { PartitionDO } from "./partitionDO";
import { RegistryDO } from "./registryDO";
import {
  connectionObjectName,
  deliveryObjectName,
  deploymentObjectName,
  executionObjectName,
  partitionObjectName,
  schedulerObjectName,
} from "./routing";
import { SchedulerDO } from "./schedulerDO";
import type {
  AnalyzedStartPushRequest,
  AnalyzeSourcePackageResponse,
  CommitRequest,
  DeploymentSchema,
  Env,
  FinishPushRequest,
  InvokeRequest,
  Json,
  PushStatus,
  StartPushRequest,
} from "./types";

export { ConnectionDO, DeliveryDO, DeploymentDO, PartitionDO, RegistryDO, SchedulerDO };
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
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      env.SCHEDULERS
        .getByName(schedulerObjectName("live-query-deliveries"))
        .fetch("https://flarex.internal/reconcile/live-query-deliveries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
    );
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

  if (
    url.pathname === "/scheduler/live-query-deliveries/reconcile" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    return env.SCHEDULERS
      .getByName(schedulerObjectName("live-query-deliveries"))
      .fetch("https://flarex.internal/reconcile/live-query-deliveries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await readJson(request)),
      });
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/dead-letter" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    return env.SCHEDULERS
      .getByName(schedulerObjectName("live-query-deliveries"))
      .fetch("https://flarex.internal/dead-letter/live-query-deliveries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await readJson(request)),
      });
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/rerun" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    return env.SCHEDULERS
      .getByName(schedulerObjectName("live-query-deliveries"))
      .fetch("https://flarex.internal/rerun/live-query-subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await readJson(request)),
      });
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/trigger" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    return env.SCHEDULERS
      .getByName(schedulerObjectName("live-query-deliveries"))
      .fetch("https://flarex.internal/rerun/live-query-subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await readJson(request)),
      });
  }

  if (parts[0] === "deployments") {
    const deploymentId = required(parts[1], "deployment id");
    if (parts[2] === "push") {
      return routeDeploymentPush(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "deployment" && request.method === "GET") {
      return env.DEPLOYMENTS
        .getByName(deploymentObjectName(deploymentId))
        .fetch("https://flarex.internal/deployment");
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
      if (parts[3] === "deliver-live-query" && request.method === "POST") {
        return routeLiveQueryDelivery(request, env, deploymentId);
      }
      if (parts[3] === "wake-delivery" && request.method === "POST") {
        return routeWakeDelivery(request, env, deploymentId);
      }
      const sessionId = request.headers.get("x-flarex-session") ?? crypto.randomUUID();
      const connectionName = connectionObjectName(deploymentId, sessionId);
      const headers = new Headers(request.headers);
      headers.set("x-flarex-deployment", deploymentId);
      headers.set("x-flarex-connection", connectionName);
      return env.CONNECTIONS
        .getByName(connectionName)
        .fetch(new Request(request, { headers }));
    }
    if (parts[2] === "scheduler") {
      return env.SCHEDULERS.getByName(schedulerObjectName(deploymentId)).fetch(request);
    }
  }

  return json({ error: "Not found." }, { status: 404 });
}

async function routeDeploymentPush(
  request: Request,
  env: Env,
  deploymentId: string,
  parts: string[],
): Promise<Response> {
  const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
  if (parts[0] === "start" && request.method === "POST") {
    const body = await readJson<StartPushRequest>(request);
    if (env.FLAREX_ANALYZER === undefined) {
      return json(
        {
          error:
            "Backend source-package analysis is not configured in this runtime. Use a backend analyzer service before starting a push.",
        },
        { status: 501 },
      );
    }
    const analyzed = await analyzeSourcePackage(env.FLAREX_ANALYZER, deploymentId, body);
    await persistAnalyzedSourcePackage(env, analyzed);
    return deployment.fetch("https://flarex.internal/push/start-analyzed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(analyzed),
    });
  }
  if (parts[0] === "start-analyzed" && request.method === "POST") {
    const body = await readJson<AnalyzedStartPushRequest>(request);
    return deployment.fetch("https://flarex.internal/push/start-analyzed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const pushId = required(parts[0], "push id");
  if (parts.length === 1 && request.method === "GET") {
    return deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}`);
  }
  if (parts[1] === "finish" && request.method === "POST") {
    const body = await readJson<FinishPushRequest>(request);
    await verifyStoredPushArtifact(env, deployment, pushId);
    return deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return json({ error: "Push route not found." }, { status: 404 });
}

async function persistAnalyzedSourcePackage(
  env: Env,
  analyzed: AnalyzedStartPushRequest,
): Promise<void> {
  const artifactStore = artifactStoreFromEnv(env);
  if (artifactStore === undefined || analyzed.analysis === undefined) return;
  await artifactStore.put(analyzed.sourcePackage);
}

async function verifyStoredPushArtifact(
  env: Env,
  deployment: DurableObjectStub,
  pushId: string,
): Promise<void> {
  const artifactStore = artifactStoreFromEnv(env);
  if (artifactStore === undefined) return;

  const response = await deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}`);
  if (!response.ok) return;
  const status = await response.json() as PushStatus;
  if (status.state !== "analyzed") return;

  const ref = await executionArtifactRefForSourcePackage(status.sourcePackage);
  try {
    await artifactStore.get(ref);
  } catch {
    throw new HttpError(
      409,
      `Execution artifact ${ref.artifactId} is not available in durable storage.`,
    );
  }
}

function artifactStoreFromEnv(env: Env): BackendExecutionArtifactStore | undefined {
  return env.ARTIFACTS === undefined
    ? undefined
    : new R2BackendExecutionArtifactStore(env.ARTIFACTS);
}

async function analyzeSourcePackage(
  analyzer: Fetcher,
  deploymentId: string,
  request: StartPushRequest,
): Promise<AnalyzedStartPushRequest> {
  const response = await analyzer.fetch("https://flarex-analyzer.internal/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deploymentId, sourcePackage: request.sourcePackage }),
  });
  const body = await response.json().catch(() => null) as AnalyzeSourcePackageResponse | null;
  if (
    response.ok &&
    body !== null &&
    typeof body === "object" &&
    "analysis" in body &&
    body.analysis !== undefined
  ) {
    return {
      sourcePackage: request.sourcePackage,
      analysis: body.analysis,
      ...(body.diagnostics === undefined ? {} : { diagnostics: body.diagnostics }),
    };
  }
  const error =
    body !== null && typeof body === "object" && "error" in body
      ? String(body.error)
      : `Analyzer request failed with status ${response.status}`;
  return {
    sourcePackage: request.sourcePackage,
    error,
    ...(body !== null &&
    typeof body === "object" &&
    "diagnostics" in body &&
    body.diagnostics !== undefined
      ? { diagnostics: body.diagnostics }
      : {}),
  };
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
      ...(kind === undefined ? {} : { kind }),
      ...(body.partitionKey === undefined
        ? {}
        : { partitionKey: required(body.partitionKey, "partition key") }),
      ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
    };
    const artifactRuntime = artifactRuntimeFromEnv(env, deploymentId);
    if (artifactRuntime !== undefined) {
      const activeDeployment = await loadActiveDeployment(env, deploymentId);
      return json(await artifactRuntime.invoke(activeDeployment, invokeRequest));
    }
    return json(await executeInvoke(env, deploymentId, invokeRequest, functions));
  } catch (error) {
    return invokeErrorResponse(error);
  }
}

function artifactRuntimeFromEnv(
  env: Env,
  deploymentId: string,
): BackendExecutionArtifactRuntime | undefined {
  const store = artifactStoreFromEnv(env);
  if (store === undefined || env.FLAREX_ARTIFACT_RUNTIME === undefined) return undefined;
  return new ServiceBindingExecutionArtifactRuntime({
    runtime: env.FLAREX_ARTIFACT_RUNTIME,
    store,
    deploymentId,
    sendSourcePackage: env.FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE !== "true",
    ...(env.FLAREX_ARTIFACT_RUNTIME_TOKEN === undefined
      ? {}
      : { capabilityToken: env.FLAREX_ARTIFACT_RUNTIME_TOKEN }),
  });
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
      body: JSON.stringify({ partitionKey, schema }),
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

async function routeLiveQueryDelivery(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  authorizeLiveQueryDeliveryRequest(request, env);
  const deliveries = liveQueryDeliveryChangesFromBody(await readJson(request));
  return json(await deliverLiveQueryChangesToConnections(env, deploymentId, deliveries));
}

async function routeWakeDelivery(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  authorizeLiveQueryDeliveryRequest(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  return env.DELIVERIES
    .getByName(deliveryObjectName(deploymentId))
    .fetch("https://flarex.internal/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, deploymentId }),
    });
}

function authorizeLiveQueryDeliveryRequest(request: Request, env: Env): void {
  if (env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN === undefined) return;
  const expected = `Bearer ${env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN}`;
  if (request.headers.get("authorization") === expected) return;
  throw new HttpError(401, "Unauthorized live query delivery request.");
}
