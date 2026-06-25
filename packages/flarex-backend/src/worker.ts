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
import { rejectedFinishPushResponse } from "./pushResponses.ts";
import {
  connectionObjectName,
  deliveryObjectName,
  deploymentObjectName,
  executionObjectName,
  partitionObjectName,
  schedulerObjectName,
} from "./routing";
import { SchedulerDO } from "./schedulerDO";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  LIVE_QUERY_SCHEDULER_NAME,
  type LiveQuerySchedulerInternalPath,
} from "./schedulerRoutes";
import type {
  AbandonPushRequest,
  AnalyzedStartPushRequest,
  CommitRequest,
  DeploymentSchema,
  Env,
  FinishPushRequest,
  InvokeRequest,
  Json,
  PushDiagnostic,
  PushStatus,
  StartPushRequest,
} from "./types";

type RawAnalyzerSuccessResponse = {
  analysis: unknown;
  codegenAnalysis: unknown;
  diagnostics?: unknown;
};

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
        .getByName(LIVE_QUERY_SCHEDULER_NAME)
        .fetch(`https://flarex.internal${LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
    );
    ctx.waitUntil(
      env.SCHEDULERS
        .getByName(LIVE_QUERY_SCHEDULER_NAME)
        .fetch(`https://flarex.internal${LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections}`, {
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
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/reconcile" &&
    request.method === "POST"
  ) {
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/dead-letter" &&
    request.method === "POST"
  ) {
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/cleanup" &&
    request.method === "POST"
  ) {
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/rerun" &&
    request.method === "POST"
  ) {
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/trigger" &&
    request.method === "POST"
  ) {
    return forwardLiveQuerySchedulerRequest(
      request,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
    );
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

async function forwardLiveQuerySchedulerRequest(
  request: Request,
  env: Env,
  internalPath: LiveQuerySchedulerInternalPath,
): Promise<Response> {
  authorizeLiveQueryDeliveryRequest(request, env);
  return env.SCHEDULERS
    .getByName(LIVE_QUERY_SCHEDULER_NAME)
    .fetch(`https://flarex.internal${internalPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await readJson(request)),
    });
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
  const pushId = decodeURIComponent(required(parts[0], "push id"));
  if (parts.length === 1 && request.method === "GET") {
    return deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}`);
  }
  if (parts[1] === "finish" && request.method === "POST") {
    const body = await readJson<FinishPushRequest>(request);
    const missingArtifact = await verifyStoredPushArtifact(env, deployment, pushId);
    if (missingArtifact !== undefined) return missingArtifact;
    return deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  if (parts[1] === "abandon" && request.method === "POST") {
    const body = await readJson<AbandonPushRequest>(request);
    return deployment.fetch(`https://flarex.internal/push/${encodeURIComponent(pushId)}/abandon`, {
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
): Promise<Response | undefined> {
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
    const error = `Execution artifact ${ref.artifactId} is not available in durable storage.`;
    return json(rejectedFinishPushResponse(status, error), { status: 409 });
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
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && isAnalyzerSuccessResponse(body)) {
    const diagnostics = analyzerDiagnostics(body);
    return {
      sourcePackage: request.sourcePackage,
      analysis: body.analysis,
      codegenAnalysis: body.codegenAnalysis,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  const error =
    body !== null && typeof body === "object" && "error" in body
      ? String(body.error)
      : response.ok &&
        body !== null &&
        typeof body === "object" &&
        "analysis" in body &&
        !("codegenAnalysis" in body)
        ? "Backend analyzer response did not include codegenAnalysis."
      : `Analyzer request failed with status ${response.status}`;
  const diagnostics = analyzerDiagnostics(body);
  return {
    sourcePackage: request.sourcePackage,
    error,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

function analyzerDiagnostics(body: unknown): PushDiagnostic[] | undefined {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("diagnostics" in body) ||
    body.diagnostics === undefined
  ) {
    return undefined;
  }
  if (!Array.isArray(body.diagnostics)) return undefined;
  return body.diagnostics.slice(-100).flatMap((diagnostic): PushDiagnostic[] => {
    if (diagnostic === null || typeof diagnostic !== "object" || Array.isArray(diagnostic)) {
      return [];
    }
    if (!("level" in diagnostic) || !("message" in diagnostic)) return [];
    const level = diagnostic.level;
    const message = diagnostic.message;
    if (level !== "log" && level !== "warn" && level !== "error") return [];
    if (typeof message !== "string") return [];
    return [{ level, message }];
  });
}

function isAnalyzerSuccessResponse(body: unknown): body is RawAnalyzerSuccessResponse {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "analysis" in body &&
    body.analysis !== undefined &&
    "codegenAnalysis" in body &&
    body.codegenAnalysis !== undefined &&
    body.codegenAnalysis !== null &&
    !("error" in body)
  );
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
