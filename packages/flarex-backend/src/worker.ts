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
  analyzerDiagnostics,
  decodeBackendAnalyzerResponse,
} from "./backendAnalyzerResponse";
import {
  ServiceBindingExecutionArtifactRuntime,
  type BackendExecutionArtifactRuntime,
} from "./artifactRuntime";
import { ConnectionDO } from "./connectionDO";
import { DeliveryDO } from "./deliveryDO";
import {
  decodePublicDeliveryWakeRequest,
  publicDeliveryWakeRouteErrorToHttpError,
} from "./delivery/PublicWakeRouteBoundary";
import { DeploymentDO } from "./deploymentDO";
import {
  decodePublicExecutionActionRequest,
  publicExecutionRoutePathErrorToHttpError,
  publicExecutionRoutePathFromPartsEffect,
  publicExecutionActionRouteErrorToHttpError,
  type PublicExecutionAction,
} from "./execution/ActionRouteBoundary";
import {
  decodePublicExecutionStartRouteRequest,
  executionStartRouteErrorToHttpError,
} from "./execution/StartRouteBoundary";
import {
  publicWorkerDispatchError,
  publicWorkerDispatchErrorToAdapterError,
  publicWorkerDispatchErrorToHttpError,
  PublicWorkerDispatchError,
} from "./worker/PublicRouteDispatchError";
import {
  deploymentPushActionFromPath,
  MissingDeploymentPushIdError,
  publicDeploymentIdFromPartsEffect,
  publicDeploymentPushPathFromPartsEffect,
  publicPartitionKeyFromPartsEffect,
  publicRoutePathErrorToHttpError,
} from "./worker/PublicRoutePathBoundary";
import {
  authorizePublicLiveQueryDeliveryRequest,
  publicLiveQueryDeliveryAuthorizationErrorToHttpError,
  PublicLiveQueryDeliveryAuthorizationError,
} from "./worker/PublicLiveQueryDeliveryAuthorization";
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
import { errorResponse, HttpError, json, readResponseJsonEffect } from "./http";
import { ExecutionDO } from "./executionDO";
import {
  executeInvoke,
  invokeErrorResponse,
  InvokeActiveDeploymentLoadError,
  invokeActiveDeploymentLoadErrorToHttpError,
  loadActiveDeploymentEffect,
  type BackendFunctionRegistry,
} from "./invoke";
import {
  decodePublicInvokeRouteRequest,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  publicInvokeRouteErrorToHttpError,
} from "./invoke/PublicInvokeRouteBoundary";
import {
  deliverLiveQueryChangesToConnectionsEffect,
  liveQueryDeliveryTargetErrorToHttpError,
  LiveQueryDeliveryTargetError,
} from "./liveQueryDelivery";
import {
  decodePublicLiveQueryDeliveryRequest,
  publicLiveQueryDeliveryRouteErrorToHttpError,
} from "./liveQueryDelivery/RouteBoundary";
import {
  decodePartitionCommitRequest,
  partitionRouteErrorToHttpError,
} from "./partition/RouteBoundary";
import {
  decodePublicPartitionSchemaCacheRequest,
  publicPartitionSchemaCacheRouteErrorToHttpError,
} from "./partition/PublicSchemaCacheRouteBoundary";
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
  decodePublicSchedulerCleanupConnectionsRequest,
  decodePublicSchedulerConnectionReconcileRequest,
  decodePublicSchedulerDeadLetterDeliveriesRequest,
  decodePublicSchedulerDeliveryReconcileRequest,
  decodePublicSchedulerRerunSubscriptionsRequest,
  decodePublicSchedulerTriggerSubscriptionsRequest,
  publicSchedulerRouteErrorToHttpError,
} from "./scheduler/PublicRouteBoundary";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  LIVE_QUERY_SCHEDULER_NAME,
  type LiveQuerySchedulerInternalPath,
} from "./schedulerRoutes";
import type {
  AnalyzedStartPushRequest,
  Env,
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
        Effect.matchEffect({
          onFailure: error => Effect.succeed(publicWorkerInvokeRouteErrorToResponse(error)),
          onSuccess: response => Effect.succeed(response),
        }),
      ),
    );
  }

  if (url.pathname === "/deployments" && ["GET", "POST"].includes(request.method)) {
    return await Effect.runPromise(
      routeRegistryDeployments(request, env).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/reconcile" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerDeliveryReconcile(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/reconcile" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerConnectionReconcile(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-deliveries/dead-letter" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerDeadLetterDeliveries(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-connections/cleanup" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerCleanupConnections(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/rerun" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerRerunSubscriptions(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (
    url.pathname === "/scheduler/live-query-subscriptions/trigger" &&
    request.method === "POST"
  ) {
    return await Effect.runPromise(
      routePublicSchedulerTriggerSubscriptions(request, env).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (parts[0] === "deployments") {
    const deploymentId = await Effect.runPromise(
      publicDeploymentIdFromPartsEffect(parts).pipe(
        Effect.mapError(publicRoutePathErrorToHttpError),
      ),
    );
    if (parts[2] === "push") {
      return routeDeploymentPush(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "deployment" && request.method === "GET") {
      return await Effect.runPromise(
        routeDeploymentActiveRead(env, deploymentId).pipe(
          Effect.mapError(publicWorkerDispatchErrorToHttpError),
        ),
      );
    }
    if (parts[2] === "invoke" && request.method === "POST") {
      return await Effect.runPromise(
        routePublicInvoke(request, env, deploymentId).pipe(
          Effect.matchEffect({
            onFailure: error => Effect.succeed(publicWorkerInvokeRouteErrorToResponse(error)),
            onSuccess: response => Effect.succeed(response),
          }),
        ),
      );
    }
    if (parts[2] === "executions") {
      return routeExecution(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "partitions") {
      const partitionKey = await Effect.runPromise(
        publicPartitionKeyFromPartsEffect(parts).pipe(
          Effect.mapError(publicRoutePathErrorToHttpError),
        ),
      );
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
      return await Effect.runPromise(
        routeConnectionSync(request, env, deploymentId, connectionName).pipe(
          Effect.mapError(publicWorkerDispatchErrorToHttpError),
        ),
      );
    }
    if (parts[2] === "scheduler") {
      return await Effect.runPromise(
        routeDeploymentScheduler(request, env, deploymentId).pipe(
          Effect.mapError(publicWorkerDispatchErrorToHttpError),
        ),
      );
    }
  }

  return json({ error: "Not found." }, { status: 404 });
}

const routeRegistryDeployments = Effect.fn("Worker.routeRegistryDeployments")(
  function* (request: Request, env: Env) {
    return yield* Effect.tryPromise({
      try: () => env.REGISTRY.getByName("registry:v1").fetch(request),
      catch: error => publicWorkerDispatchError("registry-deployments", error),
    });
  },
);

const routeDeploymentActiveRead = Effect.fn("Worker.routeDeploymentActiveRead")(
  function* (env: Env, deploymentId: string) {
    return yield* Effect.tryPromise({
      try: () => env.DEPLOYMENTS
        .getByName(deploymentObjectName(deploymentId))
        .fetch(deploymentInternalUrl(DeploymentRoute.activeDeployment)),
      catch: error => publicWorkerDispatchError("deployment-active-read", error),
    });
  },
);

const routeConnectionSync = Effect.fn("Worker.routeConnectionSync")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    connectionName: string,
  ) {
    return yield* Effect.tryPromise({
      try: () => {
        const headers = new Headers(request.headers);
        headers.set("x-flarex-deployment", deploymentId);
        headers.set("x-flarex-connection", connectionName);
        return env.CONNECTIONS
          .getByName(connectionName)
          .fetch(new Request(request, { headers }));
      },
      catch: error => publicWorkerDispatchError("connection-sync", error),
    });
  },
);

const routeDeploymentScheduler = Effect.fn("Worker.routeDeploymentScheduler")(
  function* (request: Request, env: Env, deploymentId: string) {
    return yield* Effect.tryPromise({
      try: () => env.SCHEDULERS.getByName(schedulerObjectName(deploymentId)).fetch(request),
      catch: error => publicWorkerDispatchError("deployment-scheduler", error),
    });
  },
);

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

const routePublicSchedulerDeliveryReconcile = Effect.fn("Worker.routePublicSchedulerDeliveryReconcile")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerDeliveryReconcileRequest(request);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries,
      ),
      catch: error => publicWorkerDispatchError("scheduler-delivery-reconcile", error),
    });
  },
);

const routePublicSchedulerConnectionReconcile = Effect.fn("Worker.routePublicSchedulerConnectionReconcile")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerConnectionReconcileRequest(request);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections,
      ),
      catch: error => publicWorkerDispatchError("scheduler-connection-reconcile", error),
    });
  },
);

const routePublicSchedulerDeadLetterDeliveries = Effect.fn("Worker.routePublicSchedulerDeadLetterDeliveries")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerDeadLetterDeliveriesRequest(request);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries,
      ),
      catch: error => publicWorkerDispatchError("scheduler-dead-letter-deliveries", error),
    });
  },
);

const routePublicSchedulerCleanupConnections = Effect.fn("Worker.routePublicSchedulerCleanupConnections")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerCleanupConnectionsRequest(request, env);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections,
      ),
      catch: error => publicWorkerDispatchError("scheduler-cleanup-connections", error),
    });
  },
);

const routePublicSchedulerRerunSubscriptions = Effect.fn("Worker.routePublicSchedulerRerunSubscriptions")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerRerunSubscriptionsRequest(request);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
      ),
      catch: error => publicWorkerDispatchError("scheduler-rerun-subscriptions", error),
    });
  },
);

const routePublicSchedulerTriggerSubscriptions = Effect.fn("Worker.routePublicSchedulerTriggerSubscriptions")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerTriggerSubscriptionsRequest(request);
    return yield* Effect.tryPromise({
      try: () => forwardLiveQuerySchedulerBody(
        body,
        env,
        LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
      ),
      catch: error => publicWorkerDispatchError("scheduler-trigger-subscriptions", error),
    });
  },
);

function publicWorkerSchedulerRouteErrorToHttpError(
  error: Parameters<typeof publicSchedulerRouteErrorToHttpError>[0]
    | PublicWorkerDispatchError
    | PublicLiveQueryDeliveryAuthorizationError,
): HttpError {
  if (error instanceof PublicLiveQueryDeliveryAuthorizationError) {
    return publicLiveQueryDeliveryAuthorizationErrorToHttpError(error);
  }
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicSchedulerRouteErrorToHttpError(error);
}

async function routeDeploymentPush(
  request: Request,
  env: Env,
  deploymentId: string,
  parts: string[],
): Promise<Response> {
  return await Effect.runPromise(
    routeDeploymentPushEffect(request, env, deploymentId, parts).pipe(
      Effect.mapError(publicDeploymentWorkerRouteErrorToHttpError),
    ),
  );
}

const routeDeploymentPushEffect = Effect.fn("Worker.routeDeploymentPush")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    parts: string[],
  ): Effect.fn.Return<
    Response,
    Parameters<typeof publicDeploymentRouteErrorToHttpError>[0]
      | PublicWorkerDispatchError
      | MissingDeploymentPushIdError
  > {
    const deployment = env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId));
    const path = yield* publicDeploymentPushPathFromPartsEffect(parts, request.method);
    if (path.kind === "start" && request.method === "POST") {
      return yield* routeDeploymentStartPush(request, env, deployment, deploymentId);
    }
    if (path.kind === "startAnalyzed" && request.method === "POST") {
      return yield* routeDeploymentAnalyzedStartPush(request, deployment);
    }
    if (path.kind !== "push") {
      return json({ error: "Push route not found." }, { status: 404 });
    }
    const pushId = decodeURIComponent(path.encodedPushId);
    const action = deploymentPushActionFromPath(path.action);
    if (path.action === undefined && request.method === "GET") {
      return yield* routeDeploymentReadPush(deployment, pushId);
    }
    if (action === DeploymentPushAction.finish && request.method === "POST") {
      return yield* routeDeploymentFinishPush(request, env, deployment, pushId);
    }
    if (action === DeploymentPushAction.abandon && request.method === "POST") {
      return yield* routeDeploymentAbandonPush(request, deployment, pushId);
    }
    return json({ error: "Push route not found." }, { status: 404 });
  },
);

const routeDeploymentReadPush = Effect.fn("Worker.routeDeploymentReadPush")(
  function* (
    deployment: DurableObjectStub,
    pushId: string,
  ) {
    return yield* Effect.tryPromise({
      try: () => deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId))),
      catch: error => publicWorkerDispatchError("deployment-read-push", error),
    });
  },
);

const routeDeploymentAbandonPush = Effect.fn("Worker.routeDeploymentAbandonPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
    pushId: string,
  ) {
    const body = yield* decodePublicAbandonPushRequest(request);
    return yield* Effect.tryPromise({
      try: () => deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.abandon)), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      catch: error => publicWorkerDispatchError("deployment-abandon-push", error),
    });
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
    const missingArtifact = yield* Effect.tryPromise({
      try: () => verifyStoredPushArtifact(env, deployment, pushId),
      catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
    });
    if (missingArtifact !== undefined) return missingArtifact;
    const body = yield* parsePublicFinishPushRequestEffect(rawBody);
    return yield* Effect.tryPromise({
      try: () => deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.finish)), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      catch: error => publicWorkerDispatchError("deployment-finish-push", error),
    });
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
    const analyzed = yield* Effect.tryPromise({
      try: () => analyzeSourcePackage(analyzer, deploymentId, body),
      catch: error => publicWorkerDispatchError("deployment-start-push-analyze", error),
    });
    yield* Effect.tryPromise({
      try: () => persistAnalyzedSourcePackage(env, analyzed),
      catch: error => publicWorkerDispatchError("deployment-start-push-store-artifact", error),
    });
    return yield* Effect.tryPromise({
      try: () => deployment.fetch(deploymentInternalUrl(DeploymentRoute.startAnalyzedPush), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(analyzed),
      }),
      catch: error => publicWorkerDispatchError("deployment-start-push", error),
    });
  },
);

const routeDeploymentAnalyzedStartPush = Effect.fn("Worker.routeDeploymentAnalyzedStartPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
  ) {
    const body = yield* decodePublicAnalyzedStartPushRequest(request);
    return yield* Effect.tryPromise({
      try: () => deployment.fetch(deploymentInternalUrl(DeploymentRoute.startAnalyzedPush), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      catch: error => publicWorkerDispatchError("deployment-start-analyzed-push", error),
    });
  },
);

function publicDeploymentWorkerRouteErrorToHttpError(
  error:
    | Parameters<typeof publicDeploymentRouteErrorToHttpError>[0]
    | PublicWorkerDispatchError
    | MissingDeploymentPushIdError,
): ReturnType<typeof publicDeploymentRouteErrorToHttpError> | HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  if (error instanceof MissingDeploymentPushIdError) {
    return publicRoutePathErrorToHttpError(error);
  }
  return publicDeploymentRouteErrorToHttpError(error);
}

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
  const decoded = await Effect.runPromise(
    decodeBackendAnalyzerResponse(response).pipe(
      Effect.map(body => ({ ok: true, body }) as const),
      Effect.catch(error => Effect.succeed({ ok: false, error } as const)),
    ),
  );
  if (decoded.ok) {
    const diagnostics = analyzerDiagnostics(decoded.body);
    return {
      sourcePackage: request.sourcePackage,
      analysis: decoded.body.analysis,
      codegenAnalysis: decoded.body.codegenAnalysis,
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  }
  return {
    sourcePackage: request.sourcePackage,
    error: decoded.error.message,
    ...(decoded.error.diagnostics === undefined ? {} : { diagnostics: decoded.error.diagnostics }),
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
    return await Effect.runPromise(
      routePublicExecutionStart(request, execution, deploymentId, sessionId).pipe(
        Effect.mapError(publicWorkerExecutionStartRouteErrorToHttpError),
      ),
    );
  }

  const publicAction = await Effect.runPromise(
    publicExecutionRoutePathFromPartsEffect(parts).pipe(
      Effect.mapError(publicExecutionRoutePathErrorToHttpError),
    ),
  );
  if (publicAction.matched && request.method === "POST") {
    const execution = env.EXECUTIONS.getByName(
      executionObjectName(deploymentId, publicAction.sessionId),
    );
    return await Effect.runPromise(
      routePublicExecutionAction(request, execution, publicAction.action).pipe(
        Effect.mapError(publicWorkerExecutionActionRouteErrorToHttpError),
      ),
    );
  }

  return json({ error: "Execution route not found." }, { status: 404 });
}

const routePublicExecutionStart = Effect.fn("Worker.routePublicExecutionStart")(
  function* (
    request: Request,
    execution: DurableObjectStub,
    deploymentId: string,
    sessionId: string,
  ) {
    const body = yield* decodePublicExecutionStartRouteRequest(request, deploymentId);
    const response = yield* Effect.tryPromise({
      try: () =>
        execution.fetch("https://flarex.internal/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      catch: error => publicWorkerDispatchError("execution-start", error),
    });
    if (!response.ok) return response;
    const responseBody = yield* readResponseJsonEffect(response).pipe(
      Effect.mapError(error => publicWorkerDispatchError("execution-start-response", error)),
    );
    return json({ sessionId, ...(responseBody as Record<string, unknown>) });
  },
);

function publicWorkerExecutionStartRouteErrorToHttpError(
  error: Parameters<typeof executionStartRouteErrorToHttpError>[0] | PublicWorkerDispatchError,
): HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return executionStartRouteErrorToHttpError(error);
}

const routePublicExecutionAction = Effect.fn("Worker.routePublicExecutionAction")(
  function* (request: Request, execution: DurableObjectStub, action: PublicExecutionAction) {
    const body = yield* decodePublicExecutionActionRequest(request, action);
    return yield* Effect.tryPromise({
      try: () =>
        execution.fetch(`https://flarex.internal/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      catch: error => publicWorkerDispatchError("execution-action", error),
    });
  },
);

function publicWorkerExecutionActionRouteErrorToHttpError(
  error: Parameters<typeof publicExecutionActionRouteErrorToHttpError>[0] | PublicWorkerDispatchError,
): HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicExecutionActionRouteErrorToHttpError(error);
}

const routeInvoke = Effect.fn("Worker.routeInvoke")(
  function* (
    env: Env,
    deploymentId: string,
    body: PublicInvokeRequestBody,
  ) {
    const invokeRequest = yield* invokeRequestFromPublicInvokeBodyEffect(body);
    const artifactRuntime = artifactRuntimeFromEnv(env, deploymentId);
    if (artifactRuntime !== undefined) {
      const activeDeployment = yield* loadActiveDeploymentEffect(env, deploymentId);
      const result = yield* Effect.tryPromise({
        try: () => artifactRuntime.invoke(activeDeployment, invokeRequest),
        catch: error => publicWorkerDispatchError("invoke-execute", error),
      });
      return json(result);
    }
    const result = yield* Effect.tryPromise({
      try: () => executeInvoke(env, deploymentId, invokeRequest, functions),
      catch: error => publicWorkerDispatchError("invoke-execute", error),
    });
    return json(result);
  },
);

const routePublicInvoke = Effect.fn("Worker.routePublicInvoke")(
  function* (
    request: Request,
    env: Env,
    routeDeploymentId: string | undefined,
  ) {
    const body = yield* decodePublicInvokeRouteRequest(request);
    const deploymentId = routeDeploymentId ?? body.deploymentId;
    if (deploymentId === undefined || deploymentId.length === 0) {
      return yield* Effect.fail(new MissingInvokeDeploymentError());
    }
    return yield* routeInvoke(env, deploymentId, body);
  },
);

function publicWorkerInvokeRouteErrorToResponse(
  error:
    | Parameters<typeof publicInvokeRouteErrorToHttpError>[0]
    | InvokeActiveDeploymentLoadError
    | PublicWorkerDispatchError,
): Response {
  if (error instanceof InvokeActiveDeploymentLoadError) {
    return invokeErrorResponse(invokeActiveDeploymentLoadErrorToHttpError(error));
  }
  if (error instanceof PublicWorkerDispatchError) {
    return invokeErrorResponse(publicWorkerDispatchErrorToAdapterError(error));
  }
  return invokeErrorResponse(publicInvokeRouteErrorToHttpError(error));
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
    return await Effect.runPromise(
      routePublicPartitionBegin(partition).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      ),
    );
  }
  if (action === "commit" && request.method === "POST") {
    return await Effect.runPromise(
      routePublicPartitionCommit(request, partition).pipe(
        Effect.mapError(publicWorkerPartitionRouteErrorToHttpError),
      ),
    );
  }
  if (action === "schema-cache" && request.method === "PUT") {
    return await Effect.runPromise(
      routePublicPartitionSchemaCache(request, partition, partitionKey).pipe(
        Effect.mapError(publicWorkerPartitionSchemaCacheRouteErrorToHttpError),
      ),
    );
  }
  if (action === "document" && request.method === "GET") {
    return await Effect.runPromise(
      routePublicPartitionDocumentRead(partition, originalUrl.searchParams).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      ),
    );
  }
  if (action === "index" && request.method === "GET") {
    return await Effect.runPromise(
      routePublicPartitionIndexRead(partition, originalUrl.searchParams).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      ),
    );
  }

  return json({ error: "Partition route not found." }, { status: 404 });
}

const routePublicPartitionBegin = Effect.fn("Worker.routePublicPartitionBegin")(
  function* (partition: DurableObjectStub) {
    return yield* Effect.tryPromise({
      try: () => partition.fetch("https://flarex.internal/begin", { method: "POST" }),
      catch: error => publicWorkerDispatchError("partition-begin", error),
    });
  },
);

const routePublicPartitionCommit = Effect.fn("Worker.routePublicPartitionCommit")(
  function* (request: Request, partition: DurableObjectStub) {
    const commit = yield* decodePartitionCommitRequest(request);
    return yield* Effect.tryPromise({
      try: () => partition.fetch("https://flarex.internal/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(commit),
      }),
      catch: error => publicWorkerDispatchError("partition-commit", error),
    });
  },
);

function publicWorkerPartitionRouteErrorToHttpError(
  error: Parameters<typeof partitionRouteErrorToHttpError>[0] | PublicWorkerDispatchError,
): HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return partitionRouteErrorToHttpError(error);
}

const routePublicPartitionSchemaCache = Effect.fn("Worker.routePublicPartitionSchemaCache")(
  function* (
    request: Request,
    partition: DurableObjectStub,
    partitionKey: string,
  ) {
    const schemaCache = yield* decodePublicPartitionSchemaCacheRequest(request, partitionKey);
    return yield* Effect.tryPromise({
      try: () => partition.fetch("https://flarex.internal/schema-cache", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schemaCache),
      }),
      catch: error => publicWorkerDispatchError("partition-schema-cache", error),
    });
  },
);

function publicWorkerPartitionSchemaCacheRouteErrorToHttpError(
  error: Parameters<typeof publicPartitionSchemaCacheRouteErrorToHttpError>[0] | PublicWorkerDispatchError,
): HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicPartitionSchemaCacheRouteErrorToHttpError(error);
}

const routePublicPartitionDocumentRead = Effect.fn("Worker.routePublicPartitionDocumentRead")(
  function* (partition: DurableObjectStub, searchParams: URLSearchParams) {
    return yield* Effect.tryPromise({
      try: () => partition.fetch(`https://flarex.internal/document?${searchParams}`),
      catch: error => publicWorkerDispatchError("partition-document-read", error),
    });
  },
);

const routePublicPartitionIndexRead = Effect.fn("Worker.routePublicPartitionIndexRead")(
  function* (partition: DurableObjectStub, searchParams: URLSearchParams) {
    return yield* Effect.tryPromise({
      try: () => partition.fetch(`https://flarex.internal/index?${searchParams}`),
      catch: error => publicWorkerDispatchError("partition-index-read", error),
    });
  },
);

async function routeLiveQueryDelivery(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  return await Effect.runPromise(
    routePublicLiveQueryDelivery(request, env, deploymentId).pipe(
      Effect.mapError(publicWorkerLiveQueryDeliveryRouteErrorToHttpError),
    ),
  );
}

const routePublicLiveQueryDelivery = Effect.fn("Worker.routePublicLiveQueryDelivery")(
  function* (request: Request, env: Env, deploymentId: string) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const deliveries = yield* decodePublicLiveQueryDeliveryRequest(request);
    const result = yield* deliverLiveQueryChangesToConnectionsEffect(
      env,
      deploymentId,
      deliveries,
    ).pipe(
      Effect.mapError(error =>
        error instanceof LiveQueryDeliveryTargetError
          ? error
          : publicWorkerDispatchError("live-query-delivery", error)
      ),
    );
    return json(result);
  },
);

function publicWorkerLiveQueryDeliveryRouteErrorToHttpError(
  error: Parameters<typeof publicLiveQueryDeliveryRouteErrorToHttpError>[0]
    | PublicWorkerDispatchError
    | LiveQueryDeliveryTargetError
    | PublicLiveQueryDeliveryAuthorizationError,
): HttpError {
  if (error instanceof PublicLiveQueryDeliveryAuthorizationError) {
    return publicLiveQueryDeliveryAuthorizationErrorToHttpError(error);
  }
  if (error instanceof LiveQueryDeliveryTargetError) {
    return liveQueryDeliveryTargetErrorToHttpError(error);
  }
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicLiveQueryDeliveryRouteErrorToHttpError(error);
}

async function routeWakeDelivery(
  request: Request,
  env: Env,
  deploymentId: string,
): Promise<Response> {
  return await Effect.runPromise(
    routePublicDeliveryWake(request, env, deploymentId).pipe(
      Effect.mapError(publicWorkerDeliveryWakeRouteErrorToHttpError),
    ),
  );
}

const routePublicDeliveryWake = Effect.fn("Worker.routePublicDeliveryWake")(
  function* (request: Request, env: Env, deploymentId: string) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicDeliveryWakeRequest(request, deploymentId);
    return yield* Effect.tryPromise({
      try: () =>
        env.DELIVERIES
          .getByName(deliveryObjectName(deploymentId))
          .fetch("https://flarex.internal/wake", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
      catch: error => publicWorkerDispatchError("delivery-wake", error),
    });
  },
);

function publicWorkerDeliveryWakeRouteErrorToHttpError(
  error: Parameters<typeof publicDeliveryWakeRouteErrorToHttpError>[0]
    | PublicWorkerDispatchError
    | PublicLiveQueryDeliveryAuthorizationError,
): HttpError {
  if (error instanceof PublicLiveQueryDeliveryAuthorizationError) {
    return publicLiveQueryDeliveryAuthorizationErrorToHttpError(error);
  }
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicDeliveryWakeRouteErrorToHttpError(error);
}
