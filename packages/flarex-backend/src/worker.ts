import { Effect } from "effect";
import {
  DeploymentProtocolValidationError,
  DeploymentPushAction,
} from "flarex-protocol/deployment";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import {
  InvokeProtocolValidationError,
  type PublicInvokeRequestBody,
} from "flarex-protocol/invoke";
import {
  R2BackendExecutionArtifactStore,
  type BackendExecutionArtifactStore,
} from "./artifactStore";
import {
  analyzeSourcePackageEffect,
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
  dispatchPublicDeliveryWakeEffect,
} from "./delivery/PublicWakeDispatchBoundary";
import {
  type DeliveryWakeRouteError,
} from "./delivery/RouteBoundary";
import { DeliveryWakePayloadError } from "./delivery/WakeRequest";
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
  executionStartRouteErrorToHttpErrorEffect,
} from "./execution/StartRouteBoundary";
import {
  dispatchPublicExecutionActionEffect,
  startPublicExecutionEffect,
} from "./execution/PublicDispatchBoundary";
import {
  publicWorkerDispatchError,
  publicWorkerDispatchErrorToAdapterError,
  publicWorkerDispatchErrorToHttpError,
  publicWorkerDispatchErrorToHttpErrorEffect,
  PublicWorkerDispatchError,
} from "./worker/PublicRouteDispatchError";
import {
  dispatchDeploymentSchedulerEffect,
  dispatchRegistryDeploymentsEffect,
  readDeploymentActiveEffect,
  syncPublicConnectionEffect,
} from "./worker/PublicPassThroughDispatchBoundary";
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
  decodePublicAbandonPushRequest,
  decodePublicAnalyzedStartPushRequest,
  decodePublicFinishPushJson,
  decodePublicFinishPushRoutePayload,
  decodePublicStartPushJson,
  decodePublicStartPushRoutePayload,
  type PublicDeploymentRouteError,
  publicDeploymentRouteErrorToHttpError,
  publicDeploymentRouteErrorToHttpErrorEffect,
} from "./deployment/PublicPushRouteBoundary";
import {
  abandonDeploymentPushEffect,
  finishDeploymentPushEffect,
  readDeploymentPushEffect,
  readDeploymentPushForFinishArtifactEffect,
  startAnalyzedDeploymentPushEffect,
  startDeploymentPushEffect,
} from "./deployment/PublicPushDispatchBoundary";
import { verifyStoredPushArtifactEffect } from "./deployment/PublicFinishArtifactBoundary";
import { persistAnalyzedSourcePackageEffect } from "./deployment/PublicStartArtifactBoundary";
import {
  errorResponse,
  HttpError,
  json,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "./http";
import { ExecutionDO } from "./executionDO";
import {
  executeInvokeEffect,
  invokeExecutionErrorToAdapterError,
  invokeErrorResponse,
  InvokeActiveDeploymentLoadError,
  InvokeExecutionError,
  loadActiveDeploymentEffect,
  type BackendFunctionRegistry,
} from "./invoke";
import {
  decodePublicInvokeRouteRequest,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
  publicInvokeDeploymentIdEffect,
  publicInvokeRouteErrorToHttpError,
  publicInvokeRouteErrorToHttpErrorEffect,
} from "./invoke/PublicInvokeRouteBoundary";
import {
  LiveQueryDeliveryChangePayloadError,
  liveQueryDeliveryTargetErrorToHttpError,
  LiveQueryDeliveryTargetError,
} from "./liveQueryDelivery";
import {
  dispatchPublicLiveQueryDeliveryEffect,
} from "./liveQueryDelivery/PublicDispatchBoundary";
import {
  decodePublicLiveQueryDeliveryRequest,
  publicLiveQueryDeliveryRouteErrorToHttpError,
  type LiveQueryDeliveryRouteError,
} from "./liveQueryDelivery/RouteBoundary";
import {
  decodePartitionCommitRequest,
  PartitionRoutePayloadError,
  partitionRouteErrorToHttpError,
  partitionRouteErrorToHttpErrorEffect,
} from "./partition/RouteBoundary";
import {
  decodePublicPartitionSchemaCacheRequest,
} from "./partition/PublicSchemaCacheRouteBoundary";
import {
  beginPublicPartitionEffect,
  cachePublicPartitionSchemaEffect,
  commitPublicPartitionEffect,
  readPublicPartitionDocumentEffect,
  readPublicPartitionIndexEffect,
} from "./partition/PublicDispatchBoundary";
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
import {
  decodePublicSchedulerCleanupConnectionsRequest,
  decodePublicSchedulerConnectionReconcileRequest,
  decodePublicSchedulerDeadLetterDeliveriesRequest,
  decodePublicSchedulerDeliveryReconcileRequest,
  decodePublicSchedulerRerunSubscriptionsRequest,
  decodePublicSchedulerTriggerSubscriptionsRequest,
  publicSchedulerRouteErrorToHttpError,
  publicSchedulerRouteErrorToHttpErrorEffect,
} from "./scheduler/PublicRouteBoundary";
import {
  cleanupPublicSchedulerConnectionsEffect,
  deadLetterPublicSchedulerDeliveriesEffect,
  reconcilePublicSchedulerConnectionsEffect,
  reconcilePublicSchedulerDeliveriesEffect,
  rerunPublicSchedulerSubscriptionsEffect,
  triggerPublicSchedulerSubscriptionsEffect,
} from "./scheduler/PublicDispatchBoundary";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  LIVE_QUERY_SCHEDULER_NAME,
} from "./schedulerRoutes";
import type {
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
  return await Effect.runPromise(routePublicWorker(request, env));
}

type PublicWorkerRouteError = HttpError;

const routePublicWorker = Effect.fn("Worker.routePublicWorker")(
  function* (
    request: Request,
    env: Env,
  ): Effect.fn.Return<Response, PublicWorkerRouteError> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/health") {
    return json({ service: "flarex-backend", status: "ok" });
  }

  if (url.pathname === "/invoke" && request.method === "POST") {
    return yield* routePublicInvoke(request, env, request.headers.get("x-flarex-deployment") ?? undefined).pipe(
      Effect.catch(publicWorkerInvokeRouteErrorToResponseEffect),
    );
  }

  if (url.pathname === "/deployments" && ["GET", "POST"].includes(request.method)) {
    return yield* routeRegistryDeployments(request, env).pipe(
      Effect.catch(publicWorkerDispatchErrorToHttpErrorEffect),
    );
  }

  if (request.method === "POST" && isPublicSchedulerRoutePath(url.pathname)) {
    return yield* routePublicScheduler(request, env, url.pathname).pipe(
      Effect.catch(publicWorkerSchedulerRouteErrorToHttpErrorEffect),
    );
  }

  if (parts[0] === "deployments") {
    return yield* routeDeployment(request, env, parts, url).pipe(
      Effect.catch(publicWorkerDeploymentRouteErrorToResponseEffect),
    );
  }

  return json({ error: "Not found." }, { status: 404 });
  },
);

const routeRegistryDeployments = Effect.fn("Worker.routeRegistryDeployments")(
  function* (request: Request, env: Env) {
    return yield* dispatchRegistryDeploymentsEffect(env.REGISTRY.getByName("registry:v1"), request);
  },
);

const routeDeploymentActiveRead = Effect.fn("Worker.routeDeploymentActiveRead")(
  function* (env: Env, deploymentId: string) {
    return yield* readDeploymentActiveEffect(
      env.DEPLOYMENTS.getByName(deploymentObjectName(deploymentId)),
    );
  },
);

const routeConnectionSync = Effect.fn("Worker.routeConnectionSync")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    connectionName: string,
  ) {
    return yield* syncPublicConnectionEffect(
      env.CONNECTIONS.getByName(connectionName),
      request,
      deploymentId,
      connectionName,
    );
  },
);

const routeDeploymentScheduler = Effect.fn("Worker.routeDeploymentScheduler")(
  function* (request: Request, env: Env, deploymentId: string) {
    return yield* dispatchDeploymentSchedulerEffect(
      env.SCHEDULERS.getByName(schedulerObjectName(deploymentId)),
      request,
    );
  },
);

type PublicWorkerDeploymentPushRouteError =
  | PublicDeploymentRouteError
  | PublicWorkerDispatchError
  | MissingDeploymentPushIdError;

type PublicWorkerInvokeRouteError =
  | Parameters<typeof publicInvokeRouteErrorToHttpError>[0]
  | InvokeActiveDeploymentLoadError
  | InvokeExecutionError
  | PublicWorkerDispatchError;

type PublicWorkerDeploymentNonInvokeRouteError =
  | MissingPublicDeploymentIdError
  | MissingPublicPartitionKeyError
  | PublicWorkerDeploymentPushRouteError
  | PublicWorkerExecutionRouteError
  | PublicWorkerPartitionRouteError
  | PublicWorkerDeploymentSyncRouteError
  | PublicWorkerDispatchError
  | HttpError;

type PublicWorkerDeploymentRouteError =
  | PublicWorkerDeploymentNonInvokeRouteError
  | PublicWorkerInvokeRouteError;

const routeDeployment = Effect.fn("Worker.routeDeployment")(
  function* (
    request: Request,
    env: Env,
    parts: readonly string[],
    originalUrl: URL,
  ): Effect.fn.Return<Response, PublicWorkerDeploymentRouteError> {
    const deploymentId = yield* publicDeploymentIdFromPartsEffect(parts);
    if (parts[2] === "push") {
      return yield* routeDeploymentPushEffect(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "deployment" && request.method === "GET") {
      return yield* routeDeploymentActiveRead(env, deploymentId);
    }
    if (parts[2] === "invoke" && request.method === "POST") {
      return yield* routePublicInvoke(request, env, deploymentId);
    }
    if (parts[2] === "executions") {
      return yield* routeExecutionEffect(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "partitions") {
      const partitionKey = yield* publicPartitionKeyFromPartsEffect(parts);
      return yield* routePartitionEffect(
        request,
        env,
        deploymentId,
        partitionKey,
        parts.slice(4),
        originalUrl,
      );
    }
    if (parts[2] === "sync") {
      return yield* routeDeploymentSync(request, env, deploymentId, parts.slice(3));
    }
    if (parts[2] === "scheduler") {
      return yield* routeDeploymentScheduler(request, env, deploymentId);
    }
    return json({ error: "Not found." }, { status: 404 });
  },
);

const publicWorkerDeploymentRouteErrorToResponseEffect = Effect.fn(
  "Worker.publicWorkerDeploymentRouteErrorToResponse",
)(function* (
  error: PublicWorkerDeploymentRouteError,
): Effect.fn.Return<Response, never> {
  if (isPublicWorkerInvokeRouteError(error)) {
    return yield* publicWorkerInvokeRouteErrorToResponseEffect(error);
  }
  const httpError = yield* Effect.flip(publicWorkerDeploymentRouteErrorToHttpErrorEffect(error));
  return errorResponse(httpError);
});

const publicWorkerDeploymentRouteErrorToHttpErrorEffect = Effect.fn(
  "Worker.publicWorkerDeploymentRouteErrorToHttpError",
)(function* (
  error: PublicWorkerDeploymentNonInvokeRouteError,
): Effect.fn.Return<never, HttpError> {
  if (error instanceof HttpError) {
    return yield* Effect.fail(error);
  }
  if (error instanceof PublicWorkerDispatchError) {
    return yield* publicWorkerDispatchErrorToHttpErrorEffect(error);
  }
  if (
    error instanceof MissingPublicDeploymentIdError ||
    error instanceof MissingPublicPartitionKeyError ||
    error instanceof MissingDeploymentPushIdError ||
    error instanceof MissingExecutionSessionIdError ||
    error instanceof MissingExecutionActionError
  ) {
    return yield* Effect.fail(publicDeploymentRoutePathErrorToHttpError(error));
  }
  if (error instanceof RequestJsonError || error instanceof DeploymentProtocolValidationError) {
    return yield* publicDeploymentRouteErrorToHttpErrorEffect(error);
  }
  if (error instanceof ExecutionProtocolValidationError) {
    return yield* executionStartRouteErrorToHttpErrorEffect(error);
  }
  if (error instanceof PartitionRoutePayloadError) {
    return yield* partitionRouteErrorToHttpErrorEffect(error);
  }
  return yield* Effect.fail(publicWorkerDeploymentSyncRouteErrorToHttpError(error));
});

function publicDeploymentRoutePathErrorToHttpError(
  error:
    | MissingPublicDeploymentIdError
    | MissingPublicPartitionKeyError
    | MissingDeploymentPushIdError
    | PublicExecutionRoutePathError,
): HttpError {
  if (
    error instanceof MissingExecutionSessionIdError ||
    error instanceof MissingExecutionActionError
  ) {
    return publicExecutionRoutePathErrorToHttpError(error);
  }
  return publicRoutePathErrorToHttpError(error);
}

function isPublicWorkerInvokeRouteError(
  error: PublicWorkerDeploymentRouteError,
): error is PublicWorkerInvokeRouteError {
  if (isInvokeExecutionError(error)) return true;
  if (error instanceof InvokeProtocolValidationError) return true;
  if (error instanceof MissingInvokeDeploymentError) return true;
  if (error instanceof MissingInvokePathError) return true;
  if (error instanceof MissingInvokePartitionKeyError) return true;
  return error instanceof PublicWorkerDispatchError && error.source === "invoke-execute";
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
    return yield* reconcilePublicSchedulerDeliveriesEffect(liveQueryScheduler(env), body);
  },
);

const routePublicSchedulerConnectionReconcile = Effect.fn("Worker.routePublicSchedulerConnectionReconcile")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerConnectionReconcileRequest(request);
    return yield* reconcilePublicSchedulerConnectionsEffect(liveQueryScheduler(env), body);
  },
);

const routePublicSchedulerDeadLetterDeliveries = Effect.fn("Worker.routePublicSchedulerDeadLetterDeliveries")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerDeadLetterDeliveriesRequest(request);
    return yield* deadLetterPublicSchedulerDeliveriesEffect(liveQueryScheduler(env), body);
  },
);

const routePublicSchedulerCleanupConnections = Effect.fn("Worker.routePublicSchedulerCleanupConnections")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerCleanupConnectionsRequest(request, env);
    return yield* cleanupPublicSchedulerConnectionsEffect(liveQueryScheduler(env), body);
  },
);

const routePublicSchedulerRerunSubscriptions = Effect.fn("Worker.routePublicSchedulerRerunSubscriptions")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerRerunSubscriptionsRequest(request);
    return yield* rerunPublicSchedulerSubscriptionsEffect(liveQueryScheduler(env), body);
  },
);

const routePublicSchedulerTriggerSubscriptions = Effect.fn("Worker.routePublicSchedulerTriggerSubscriptions")(
  function* (request: Request, env: Env) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicSchedulerTriggerSubscriptionsRequest(request);
    return yield* triggerPublicSchedulerSubscriptionsEffect(liveQueryScheduler(env), body);
  },
);

function liveQueryScheduler(env: Env): DurableObjectStub {
  return env.SCHEDULERS.getByName(LIVE_QUERY_SCHEDULER_NAME);
}

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

const publicWorkerSchedulerRouteErrorToHttpErrorEffect = Effect.fn(
  "Worker.publicWorkerSchedulerRouteErrorToHttpError",
)(function* (
  error: PublicWorkerSchedulerRouteError,
): Effect.fn.Return<never, HttpError> {
  if (error instanceof PublicLiveQueryDeliveryAuthorizationError) {
    return yield* Effect.fail(publicLiveQueryDeliveryAuthorizationErrorToHttpError(error));
  }
  if (error instanceof PublicWorkerDispatchError) {
    return yield* publicWorkerDispatchErrorToHttpErrorEffect(error);
  }
  return yield* publicSchedulerRouteErrorToHttpErrorEffect(error);
});

const routeDeploymentPushEffect = Effect.fn("Worker.routeDeploymentPush")(
  function* (
    request: Request,
    env: Env,
    deploymentId: string,
    parts: string[],
  ): Effect.fn.Return<
    Response,
    PublicWorkerDeploymentPushRouteError
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
    return yield* readDeploymentPushEffect(deployment, pushId);
  },
);

const routeDeploymentAbandonPush = Effect.fn("Worker.routeDeploymentAbandonPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
    pushId: string,
  ) {
    const body = yield* decodePublicAbandonPushRequest(request);
    return yield* abandonDeploymentPushEffect(deployment, pushId, body);
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
    const missingArtifact = yield* verifyStoredPushArtifactEffect(
      artifactStoreFromEnv(env),
      readDeploymentPushForFinishArtifactEffect(deployment, pushId),
    );
    if (missingArtifact !== undefined) return missingArtifact;
    const body = yield* decodePublicFinishPushRoutePayload(rawBody);
    return yield* finishDeploymentPushEffect(deployment, pushId, body);
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
    const body = yield* decodePublicStartPushRoutePayload(rawBody);
    const analyzed = yield* analyzeSourcePackageEffect(analyzer, deploymentId, body);
    yield* persistAnalyzedSourcePackageEffect(artifactStoreFromEnv(env), analyzed);
    return yield* startDeploymentPushEffect(deployment, analyzed);
  },
);

const routeDeploymentAnalyzedStartPush = Effect.fn("Worker.routeDeploymentAnalyzedStartPush")(
  function* (
    request: Request,
    deployment: DurableObjectStub,
  ) {
    const body = yield* decodePublicAnalyzedStartPushRequest(request);
    return yield* startAnalyzedDeploymentPushEffect(deployment, body);
  },
);

function artifactStoreFromEnv(env: Env): BackendExecutionArtifactStore | undefined {
  return env.ARTIFACTS === undefined
    ? undefined
    : new R2BackendExecutionArtifactStore(env.ARTIFACTS);
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

const routePublicExecutionStart = Effect.fn("Worker.routePublicExecutionStart")(
  function* (
    request: Request,
    execution: DurableObjectStub,
    deploymentId: string,
    sessionId: string,
  ) {
    const body = yield* decodePublicExecutionStartRouteRequest(request, deploymentId);
    return yield* startPublicExecutionEffect(execution, body, sessionId);
  },
);

const routePublicExecutionAction = Effect.fn("Worker.routePublicExecutionAction")(
  function* (request: Request, execution: DurableObjectStub, action: PublicExecutionAction) {
    const body = yield* decodePublicExecutionActionRequest(request, action);
    return yield* dispatchPublicExecutionActionEffect(execution, action, body);
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
    const result = yield* executeInvokeEffect(env, deploymentId, invokeRequest, functions);
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
    const deploymentId = yield* publicInvokeDeploymentIdEffect(routeDeploymentId, body);
    return yield* routeInvoke(env, deploymentId, body);
  },
);

function publicWorkerInvokeRouteErrorToResponse(
  error:
    | Parameters<typeof publicInvokeRouteErrorToHttpError>[0]
    | InvokeActiveDeploymentLoadError
    | InvokeExecutionError
    | PublicWorkerDispatchError,
): Response {
  if (isInvokeExecutionError(error)) {
    return invokeErrorResponse(invokeExecutionErrorToAdapterError(error));
  }
  if (error instanceof PublicWorkerDispatchError) {
    return invokeErrorResponse(publicWorkerDispatchErrorToAdapterError(error));
  }
  return invokeErrorResponse(publicInvokeRouteErrorToHttpError(error));
}

const publicWorkerInvokeRouteErrorToResponseEffect = Effect.fn(
  "Worker.publicWorkerInvokeRouteErrorToResponse",
)(function* (
  error: PublicWorkerInvokeRouteError,
): Effect.fn.Return<Response, never> {
  if (isInvokeExecutionError(error)) {
    return invokeErrorResponse(invokeExecutionErrorToAdapterError(error));
  }
  if (error instanceof PublicWorkerDispatchError) {
    return invokeErrorResponse(publicWorkerDispatchErrorToAdapterError(error));
  }
  const httpError = yield* Effect.flip(publicInvokeRouteErrorToHttpErrorEffect(error));
  return invokeErrorResponse(httpError);
});

function isInvokeExecutionError(error: unknown): error is InvokeExecutionError {
  if (error instanceof InvokeActiveDeploymentLoadError) return true;
  if (typeof error !== "object" || error === null || !("_tag" in error)) return false;
  switch ((error as { readonly _tag: string })._tag) {
    case "InvokeActiveFunctionMetadataNotFoundError":
    case "InvokeFunctionNotFoundError":
    case "InvokeUnsupportedFunctionKindError":
    case "InvokeFunctionKindMismatchError":
    case "InvokeRequestKindMismatchError":
    case "InvokeArgumentValidationError":
    case "InvokeReturnValidationError":
    case "InvokeTableNotFoundError":
    case "InvokeDocumentIdParseError":
    case "InvokeDocumentTableNotFoundError":
    case "InvokeDocumentIdTableMismatchError":
    case "InvokeDocumentValidationError":
    case "InvokeDocumentPlacementError":
    case "InvokeDocumentNotFoundError":
    case "InvokePartitionValidationError":
    case "InvokeQueryPlanningError":
    case "InvokeKindValidationError":
    case "InvokeExecutionOperationError":
      return true;
    default:
      return false;
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
    return yield* beginPublicPartitionEffect(partition);
  },
);

const routePublicPartitionCommit = Effect.fn("Worker.routePublicPartitionCommit")(
  function* (request: Request, partition: DurableObjectStub) {
    const commit = yield* decodePartitionCommitRequest(request);
    return yield* commitPublicPartitionEffect(partition, commit);
  },
);

const routePublicPartitionSchemaCache = Effect.fn("Worker.routePublicPartitionSchemaCache")(
  function* (
    request: Request,
    partition: DurableObjectStub,
    partitionKey: string,
  ) {
    const schemaCache = yield* decodePublicPartitionSchemaCacheRequest(request, partitionKey);
    return yield* cachePublicPartitionSchemaEffect(partition, schemaCache);
  },
);

const routePublicPartitionDocumentRead = Effect.fn("Worker.routePublicPartitionDocumentRead")(
  function* (partition: DurableObjectStub, searchParams: URLSearchParams) {
    return yield* readPublicPartitionDocumentEffect(partition, searchParams);
  },
);

const routePublicPartitionIndexRead = Effect.fn("Worker.routePublicPartitionIndexRead")(
  function* (partition: DurableObjectStub, searchParams: URLSearchParams) {
    return yield* readPublicPartitionIndexEffect(partition, searchParams);
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
    const result = yield* dispatchPublicLiveQueryDeliveryEffect(
      env,
      deploymentId,
      deliveries,
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
  if (error instanceof DeliveryWakePayloadError) {
    return publicDeliveryWakeRouteErrorToHttpError(error);
  }
  if (error instanceof LiveQueryDeliveryChangePayloadError) {
    return publicLiveQueryDeliveryRouteErrorToHttpError(error);
  }
  return publicLiveQueryDeliveryRouteErrorToHttpError(error);
}

const routePublicDeliveryWake = Effect.fn("Worker.routePublicDeliveryWake")(
  function* (request: Request, env: Env, deploymentId: string) {
    yield* authorizePublicLiveQueryDeliveryRequest(request, env);
    const body = yield* decodePublicDeliveryWakeRequest(request, deploymentId);
    return yield* dispatchPublicDeliveryWakeEffect(
      env.DELIVERIES.getByName(deliveryObjectName(deploymentId)),
      body,
    );
  },
);
