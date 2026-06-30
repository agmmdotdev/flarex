import { Effect } from "effect";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  DeploymentProtocolValidationError,
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
import {
  DeliveryWakeRouteValidationError,
  type DeliveryWakeRouteError,
} from "./delivery/RouteBoundary";
import { DeploymentDO } from "./deploymentDO";
import {
  decodePublicExecutionActionRequest,
  MissingExecutionActionError,
  MissingExecutionSessionIdError,
  publicExecutionRoutePathErrorToHttpError,
  publicExecutionRoutePathFromPartsEffect,
  type PublicExecutionAction,
  type PublicExecutionRoutePathError,
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
  MissingPublicDeploymentIdError,
  MissingPublicPartitionKeyError,
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
  LiveQueryDeliveryRouteValidationError,
  publicLiveQueryDeliveryRouteErrorToHttpError,
  type LiveQueryDeliveryRouteError,
} from "./liveQueryDelivery/RouteBoundary";
import {
  decodePartitionCommitRequest,
  partitionRouteErrorToHttpError,
} from "./partition/RouteBoundary";
import {
  decodePublicPartitionSchemaCacheRequest,
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

  if (request.method === "POST" && isPublicSchedulerRoutePath(url.pathname)) {
    return await Effect.runPromise(
      routePublicScheduler(request, env, url.pathname).pipe(
        Effect.mapError(publicWorkerSchedulerRouteErrorToHttpError),
      ),
    );
  }

  if (parts[0] === "deployments") {
    return await Effect.runPromise(
      routeDeployment(request, env, parts, url).pipe(
        Effect.mapError(publicWorkerDeploymentRouteErrorToHttpError),
      ),
    );
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

type PublicWorkerDeploymentRouteError =
  | MissingPublicDeploymentIdError
  | MissingPublicPartitionKeyError
  | HttpError
  | DeploymentProtocolValidationError;

const routeDeployment = Effect.fn("Worker.routeDeployment")(
  function* (
    request: Request,
    env: Env,
    parts: readonly string[],
    originalUrl: URL,
  ): Effect.fn.Return<Response, PublicWorkerDeploymentRouteError> {
    const deploymentId = yield* publicDeploymentIdFromPartsEffect(parts);
    if (parts[2] === "push") {
      return yield* routeDeploymentPushEffect(request, env, deploymentId, parts.slice(3)).pipe(
        Effect.mapError(publicDeploymentWorkerRouteErrorToHttpError),
      );
    }
    if (parts[2] === "deployment" && request.method === "GET") {
      return yield* routeDeploymentActiveRead(env, deploymentId).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      );
    }
    if (parts[2] === "invoke" && request.method === "POST") {
      return yield* routePublicInvoke(request, env, deploymentId).pipe(
        Effect.matchEffect({
          onFailure: error => Effect.succeed(publicWorkerInvokeRouteErrorToResponse(error)),
          onSuccess: response => Effect.succeed(response),
        }),
      );
    }
    if (parts[2] === "executions") {
      return yield* routeExecutionEffect(request, env, deploymentId, parts.slice(3)).pipe(
        Effect.mapError(publicWorkerExecutionRouteErrorToHttpError),
      );
    }
    if (parts[2] === "partitions") {
      const partitionKey = yield* publicPartitionKeyFromPartsEffect(parts);
      return yield* routePartitionEffect(request, env, deploymentId, partitionKey, parts.slice(4), originalUrl).pipe(
        Effect.mapError(publicWorkerPartitionRouteErrorToHttpError),
      );
    }
    if (parts[2] === "sync") {
      return yield* routeDeploymentSync(request, env, deploymentId, parts.slice(3)).pipe(
        Effect.mapError(publicWorkerDeploymentSyncRouteErrorToHttpError),
      );
    }
    if (parts[2] === "scheduler") {
      return yield* routeDeploymentScheduler(request, env, deploymentId).pipe(
        Effect.mapError(publicWorkerDispatchErrorToHttpError),
      );
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

function publicWorkerDeploymentRouteErrorToHttpError(
  error: PublicWorkerDeploymentRouteError,
): HttpError | DeploymentProtocolValidationError {
  if (error instanceof HttpError || error instanceof DeploymentProtocolValidationError) {
    return error;
  }
  return publicRoutePathErrorToHttpError(error);
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

const PUBLIC_SCHEDULER_ROUTE_PATHS = [
  "/scheduler/live-query-deliveries/reconcile",
  "/scheduler/live-query-connections/reconcile",
  "/scheduler/live-query-deliveries/dead-letter",
  "/scheduler/live-query-connections/cleanup",
  "/scheduler/live-query-subscriptions/rerun",
  "/scheduler/live-query-subscriptions/trigger",
] as const;

type PublicSchedulerRoutePath = typeof PUBLIC_SCHEDULER_ROUTE_PATHS[number];

function isPublicSchedulerRoutePath(pathname: string): pathname is PublicSchedulerRoutePath {
  return (PUBLIC_SCHEDULER_ROUTE_PATHS as readonly string[]).includes(pathname);
}

type PublicWorkerSchedulerRouteError =
  | Parameters<typeof publicSchedulerRouteErrorToHttpError>[0]
  | PublicWorkerDispatchError
  | PublicLiveQueryDeliveryAuthorizationError;

const routePublicScheduler = Effect.fn("Worker.routePublicScheduler")(
  function* (
    request: Request,
    env: Env,
    pathname: PublicSchedulerRoutePath,
  ): Effect.fn.Return<Response, PublicWorkerSchedulerRouteError> {
    switch (pathname) {
      case "/scheduler/live-query-deliveries/reconcile":
        return yield* routePublicSchedulerDeliveryReconcile(request, env);
      case "/scheduler/live-query-connections/reconcile":
        return yield* routePublicSchedulerConnectionReconcile(request, env);
      case "/scheduler/live-query-deliveries/dead-letter":
        return yield* routePublicSchedulerDeadLetterDeliveries(request, env);
      case "/scheduler/live-query-connections/cleanup":
        return yield* routePublicSchedulerCleanupConnections(request, env);
      case "/scheduler/live-query-subscriptions/rerun":
        return yield* routePublicSchedulerRerunSubscriptions(request, env);
      case "/scheduler/live-query-subscriptions/trigger":
        return yield* routePublicSchedulerTriggerSubscriptions(request, env);
    }
  },
);

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
  error: PublicWorkerSchedulerRouteError,
): HttpError {
  if (error instanceof PublicLiveQueryDeliveryAuthorizationError) {
    return publicLiveQueryDeliveryAuthorizationErrorToHttpError(error);
  }
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  return publicSchedulerRouteErrorToHttpError(error);
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

type PublicWorkerExecutionRouteError =
  | Parameters<typeof executionStartRouteErrorToHttpError>[0]
  | PublicExecutionRoutePathError
  | PublicWorkerDispatchError;

const routeExecutionEffect = Effect.fn("Worker.routeExecution")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    parts: readonly string[],
  ): Effect.fn.Return<Response, PublicWorkerExecutionRouteError> {
    if (parts[0] === "start" && request.method === "POST") {
      const sessionId = crypto.randomUUID();
      const execution = env.EXECUTIONS.getByName(executionObjectName(deploymentId, sessionId));
      return yield* routePublicExecutionStart(request, execution, deploymentId, sessionId);
    }

    const publicAction = yield* publicExecutionRoutePathFromPartsEffect(parts);
    if (publicAction.matched && request.method === "POST") {
      const execution = env.EXECUTIONS.getByName(
        executionObjectName(deploymentId, publicAction.sessionId),
      );
      return yield* routePublicExecutionAction(request, execution, publicAction.action);
    }

    return json({ error: "Execution route not found." }, { status: 404 });
  },
);

function publicWorkerExecutionRouteErrorToHttpError(
  error: PublicWorkerExecutionRouteError,
): HttpError {
  if (error instanceof PublicWorkerDispatchError) {
    return publicWorkerDispatchErrorToHttpError(error);
  }
  if (
    error instanceof MissingExecutionSessionIdError ||
    error instanceof MissingExecutionActionError
  ) {
    return publicExecutionRoutePathErrorToHttpError(error);
  }
  return executionStartRouteErrorToHttpError(error);
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

type PublicWorkerPartitionRouteError =
  | Parameters<typeof partitionRouteErrorToHttpError>[0]
  | PublicWorkerDispatchError;

const routePartitionEffect = Effect.fn("Worker.routePartition")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    partitionKey: string,
    parts: readonly string[],
    originalUrl: URL,
  ): Effect.fn.Return<Response, PublicWorkerPartitionRouteError> {
    const partition = env.PARTITIONS.getByName(partitionObjectName(deploymentId, partitionKey));
    const action = parts[0];

    if (action === "begin" && request.method === "POST") {
      return yield* routePublicPartitionBegin(partition);
    }
    if (action === "commit" && request.method === "POST") {
      return yield* routePublicPartitionCommit(request, partition);
    }
    if (action === "schema-cache" && request.method === "PUT") {
      return yield* routePublicPartitionSchemaCache(request, partition, partitionKey);
    }
    if (action === "document" && request.method === "GET") {
      return yield* routePublicPartitionDocumentRead(partition, originalUrl.searchParams);
    }
    if (action === "index" && request.method === "GET") {
      return yield* routePublicPartitionIndexRead(partition, originalUrl.searchParams);
    }

    return json({ error: "Partition route not found." }, { status: 404 });
  },
);

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
  error: PublicWorkerPartitionRouteError,
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

type PublicWorkerDeploymentSyncRouteError =
  | LiveQueryDeliveryRouteError
  | DeliveryWakeRouteError
  | PublicWorkerDispatchError
  | LiveQueryDeliveryTargetError
  | PublicLiveQueryDeliveryAuthorizationError;

const routeDeploymentSync = Effect.fn("Worker.routeDeploymentSync")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    parts: readonly string[],
  ): Effect.fn.Return<Response, PublicWorkerDeploymentSyncRouteError> {
    if (parts[0] === "deliver-live-query" && request.method === "POST") {
      return yield* routePublicLiveQueryDelivery(request, env, deploymentId);
    }
    if (parts[0] === "wake-delivery" && request.method === "POST") {
      return yield* routePublicDeliveryWake(request, env, deploymentId);
    }
    const sessionId = request.headers.get("x-flarex-session") ?? crypto.randomUUID();
    const connectionName = connectionObjectName(deploymentId, sessionId);
    return yield* routeConnectionSync(request, env, deploymentId, connectionName);
  },
);

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

function publicWorkerDeploymentSyncRouteErrorToHttpError(
  error: PublicWorkerDeploymentSyncRouteError,
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
  if (error instanceof DeliveryWakeRouteValidationError) {
    return publicDeliveryWakeRouteErrorToHttpError(error);
  }
  if (error instanceof LiveQueryDeliveryRouteValidationError) {
    return publicLiveQueryDeliveryRouteErrorToHttpError(error);
  }
  return publicLiveQueryDeliveryRouteErrorToHttpError(error);
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
