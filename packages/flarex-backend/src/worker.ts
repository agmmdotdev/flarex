import { Effect } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  DeploymentPushAction,
  DeploymentRoute,
  type DeploymentRoutePath,
} from "flarex-protocol/deployment";
import type { PublicInvokeRequestBody } from "flarex-protocol/invoke";
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
import { readPublicDeliveryWakeRequest } from "./delivery/PublicWakeRouteBoundary";
import { DeploymentDO } from "./deploymentDO";
import {
  readPublicExecutionActionRequest,
  type PublicExecutionAction,
} from "./execution/ActionRouteBoundary";
import { readPublicExecutionStartRequest } from "./execution/StartRouteBoundary";
import {
  deploymentProtocolValidationErrorResponse,
  decodePublicAbandonPushRequest,
  decodePublicAnalyzedStartPushRequest,
  decodePublicFinishPushJson,
  decodePublicStartPushJson,
  parsePublicFinishPushRequestEffect,
  parsePublicStartPushRequestEffect,
  publicDeploymentRouteErrorToHttpError,
} from "./deployment/PublicPushRouteBoundary";
import { errorResponse, HttpError, json, required } from "./http";
import { ExecutionDO } from "./executionDO";
import {
  executeInvoke,
  invokeErrorResponse,
  loadActiveDeployment,
  parseInvokeKind,
  type BackendFunctionRegistry,
} from "./invoke";
import {
  decodePublicInvokeRouteRequest,
  publicInvokeRouteErrorToHttpError,
} from "./invoke/PublicInvokeRouteBoundary";
import {
  deliverLiveQueryChangesToConnections,
} from "./liveQueryDelivery";
import { readPublicLiveQueryDeliveryRequest } from "./liveQueryDelivery/RouteBoundary";
import { readPartitionCommitRequest } from "./partition/RouteBoundary";
import { readPublicPartitionSchemaCacheRequest } from "./partition/PublicSchemaCacheRouteBoundary";
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
  readPublicSchedulerCleanupConnectionsRequest,
  readPublicSchedulerConnectionReconcileRequest,
  readPublicSchedulerDeadLetterDeliveriesRequest,
  readPublicSchedulerDeliveryReconcileRequest,
  readPublicSchedulerRerunSubscriptionsRequest,
  readPublicSchedulerTriggerSubscriptionsRequest,
} from "./scheduler/PublicRouteBoundary";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  LIVE_QUERY_SCHEDULER_NAME,
  type LiveQuerySchedulerInternalPath,
} from "./schedulerRoutes";
import type {
  AnalyzedStartPushRequest,
  Env,
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
      const deploymentProtocolError = deploymentProtocolValidationErrorResponse(error);
      if (deploymentProtocolError !== undefined) return deploymentProtocolError;
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
    return await Effect.runPromise(
      routePublicInvoke(request, env, request.headers.get("x-flarex-deployment") ?? undefined).pipe(
        Effect.mapError(publicWorkerInvokeRouteErrorToHttpError),
      ),
    );
  }

  if (url.pathname === "/deployments" && ["GET", "POST"].includes(request.method)) {
    return env.REGISTRY.getByName("registry:v1").fetch(request);
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/reconcile" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerDeliveryReconcileRequest(request);
    return forwardLiveQuerySchedulerBody(
      body,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/reconcile" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerConnectionReconcileRequest(request);
    return forwardLiveQuerySchedulerBody(
      body,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/dead-letter" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerDeadLetterDeliveriesRequest(request);
    return forwardLiveQuerySchedulerBody(
      body,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/cleanup" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerCleanupConnectionsRequest(request, env);
    return forwardLiveQuerySchedulerBody(
      body,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/rerun" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerRerunSubscriptionsRequest(request);
    return forwardLiveQuerySchedulerBody(
      body,
      env,
      LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/trigger" &&
    request.method === "POST"
  ) {
    authorizeLiveQueryDeliveryRequest(request, env);
    const body = await readPublicSchedulerTriggerSubscriptionsRequest(request);
    return forwardLiveQuerySchedulerBody(
      body,
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
        .fetch(deploymentInternalUrl(DeploymentRoute.activeDeployment));
    }
    if (parts[2] === "invoke" && request.method === "POST") {
      return await Effect.runPromise(
        routePublicInvoke(request, env, deploymentId).pipe(
          Effect.mapError(publicWorkerInvokeRouteErrorToHttpError),
        ),
      );
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

async function forwardLiveQuerySchedulerBody(
  body: unknown,
  env: Env,
  internalPath: LiveQuerySchedulerInternalPath,
): Promise<Response> {
  return env.SCHEDULERS
    .getByName(LIVE_QUERY_SCHEDULER_NAME)
    .fetch(`https://flarex.internal${internalPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
    return await Effect.runPromise(
      routeDeploymentStartPush(request, env, deployment, deploymentId).pipe(
        Effect.mapError(publicDeploymentRouteErrorToHttpError),
      ),
    );
  }
  if (parts[0] === "start-analyzed" && request.method === "POST") {
    return await Effect.runPromise(
      routeDeploymentAnalyzedStartPush(request, deployment).pipe(
        Effect.mapError(publicDeploymentRouteErrorToHttpError),
      ),
    );
  }
  const pushId = decodeURIComponent(required(parts[0], "push id"));
  if (parts.length === 1 && request.method === "GET") {
    return deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId)));
  }
  if (parts[1] === DeploymentPushAction.finish && request.method === "POST") {
    return await Effect.runPromise(
      routeDeploymentFinishPush(request, env, deployment, pushId).pipe(
        Effect.mapError(publicDeploymentRouteErrorToHttpError),
      ),
    );
  }
  if (parts[1] === DeploymentPushAction.abandon && request.method === "POST") {
    return await Effect.runPromise(
      routeDeploymentAbandonPush(request, deployment, pushId).pipe(
        Effect.mapError(publicDeploymentRouteErrorToHttpError),
      ),
    );
  }
  return json({ error: "Push route not found." }, { status: 404 });
}

const routeDeploymentAbandonPush = Effect.fn("Worker.routeDeploymentAbandonPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
    pushId: string,
  ) {
    const body = yield* decodePublicAbandonPushRequest(request);
    return yield* Effect.promise(() =>
      deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.abandon)), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
);

const routeDeploymentFinishPush = Effect.fn("Worker.routeDeploymentFinishPush")(
  function* (
    request: Request,
    env: Env,
    deployment: DurableObjectStub,
    pushId: string,
  ) {
    const rawBody = yield* decodePublicFinishPushJson(request);
    const missingArtifact = yield* Effect.promise(() => verifyStoredPushArtifact(env, deployment, pushId));
    if (missingArtifact !== undefined) return missingArtifact;
    const body = yield* parsePublicFinishPushRequestEffect(rawBody);
    return yield* Effect.promise(() =>
      deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.finish)), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
);

const routeDeploymentStartPush = Effect.fn("Worker.routeDeploymentStartPush")(
  function* (
    request: Request,
    env: Env,
    deployment: DurableObjectStub,
    deploymentId: string,
  ) {
    const rawBody = yield* decodePublicStartPushJson(request);
    const analyzer = env.FLAREX_ANALYZER;
    if (analyzer === undefined) {
      return json(
        {
          error:
            "Backend source-package analysis is not configured in this runtime. Use a backend analyzer service before starting a push.",
        },
        { status: 501 },
      );
    }
    const body = yield* parsePublicStartPushRequestEffect(rawBody);
    const analyzed = yield* Effect.promise(() => analyzeSourcePackage(analyzer, deploymentId, body));
    yield* Effect.promise(() => persistAnalyzedSourcePackage(env, analyzed));
    return yield* Effect.promise(() =>
      deployment.fetch(deploymentInternalUrl(DeploymentRoute.startAnalyzedPush), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(analyzed),
      })
    );
  },
);

const routeDeploymentAnalyzedStartPush = Effect.fn("Worker.routeDeploymentAnalyzedStartPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
  ) {
    const body = yield* decodePublicAnalyzedStartPushRequest(request);
    return yield* Effect.promise(() =>
      deployment.fetch(deploymentInternalUrl(DeploymentRoute.startAnalyzedPush), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
);

type DeploymentInternalPath =
  | DeploymentRoutePath
  | `${typeof DeploymentRoute.push}/${string}`
  | `${typeof DeploymentRoute.push}/${string}/${DeploymentPushAction}`;

function deploymentInternalUrl(path: DeploymentInternalPath): string {
  return `https://flarex.internal${path}`;
}

function deploymentPushPath(pushId: string, action?: DeploymentPushAction): DeploymentInternalPath {
  const pushPath: `${typeof DeploymentRoute.push}/${string}` = `${DeploymentRoute.push}/${encodeURIComponent(pushId)}`;
  if (action === undefined) return pushPath;
  const actionPath: `${typeof DeploymentRoute.push}/${string}/${DeploymentPushAction}` = `${pushPath}/${action}`;
  return actionPath;
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

  const response = await deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId)));
  if (!response.ok) return;
  const status = await response.json() as PushStatus;
  if (status.state !== "analyzed") return;

  const ref = await executionArtifactRefForSourcePackage(status.sourcePackage);
  try {
    await artifactStore.get(ref);
  } catch {
    const error = `Execution artifact ${ref.artifactId} is not available in durable storage.`;
    return json(rejectedFinishPushResponse(status, "missing_artifact", error), { status: 409 });
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
    const body = await readPublicExecutionStartRequest(request, deploymentId);
    const response = await execution.fetch("https://flarex.internal/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return response;
    return json({ sessionId, ...((await response.json()) as Record<string, unknown>) });
  }

  const sessionId = required(parts[0], "execution session id");
  const action = required(parts[1], "execution action");
  const execution = env.EXECUTIONS.getByName(executionObjectName(deploymentId, sessionId));
  if (isPublicExecutionAction(action) && request.method === "POST") {
    const body = await readPublicExecutionActionRequest(request, action);
    return execution.fetch(`https://flarex.internal/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  return json({ error: "Execution route not found." }, { status: 404 });
}

function isPublicExecutionAction(action: string): action is PublicExecutionAction {
  return action === "syscall" || action === "finish" || action === "abort";
}

async function routeInvoke(
  env: Env,
  deploymentId: string,
  body: PublicInvokeRequestBody,
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

const routePublicInvoke = Effect.fn("Worker.routePublicInvoke")(
  function* (
    request: Request,
    env: Env,
    routeDeploymentId: string | undefined,
  ) {
    const body = yield* decodePublicInvokeRouteRequest(request);
    const deploymentId = routeDeploymentId ?? body.deploymentId;
    if (deploymentId === undefined || deploymentId.length === 0) {
      return yield* Effect.fail(new HttpError(400, "Missing deployment id."));
    }
    return yield* Effect.promise(() => routeInvoke(env, deploymentId, body));
  },
);

function publicWorkerInvokeRouteErrorToHttpError(
  error: Parameters<typeof publicInvokeRouteErrorToHttpError>[0] | HttpError,
): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return publicInvokeRouteErrorToHttpError(error);
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
    const commit = await readPartitionCommitRequest(request);
    return partition.fetch("https://flarex.internal/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(commit),
    });
  }
  if (action === "schema-cache" && request.method === "PUT") {
    const schemaCache = await readPublicPartitionSchemaCacheRequest(request, partitionKey);
    return partition.fetch("https://flarex.internal/schema-cache", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(schemaCache),
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
  const deliveries = await readPublicLiveQueryDeliveryRequest(request);
  return json(await deliverLiveQueryChangesToConnections(env, deploymentId, deliveries));
}

async function routeWakeDelivery(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  authorizeLiveQueryDeliveryRequest(request, env);
  const body = await readPublicDeliveryWakeRequest(request, deploymentId);
  return env.DELIVERIES
    .getByName(deliveryObjectName(deploymentId))
    .fetch("https://flarex.internal/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

function authorizeLiveQueryDeliveryRequest(request: Request, env: Env): void {
  if (env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN === undefined) return;
  const expected = `Bearer ${env.FLAREX_LIVE_QUERY_DELIVERY_TOKEN}`;
  if (request.headers.get("authorization") === expected) return;
  throw new HttpError(401, "Unauthorized live query delivery request.");
}
