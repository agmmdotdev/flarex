import { Effect } from "effect";
import {
  type AbandonPushRequest,
  type AnalyzedStartPushRequest,
  DeploymentPushAction,
  DeploymentRoute,
  type FinishPushRequest,
} from "flarex-protocol/deployment";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicDeploymentPushDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const readDeploymentPushEffect = Effect.fn(
  "Worker.readDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId))),
    catch: error => publicWorkerDispatchError("deployment-read-push", error),
  });
});

export const readDeploymentPushForFinishArtifactEffect = Effect.fn(
  "Worker.readDeploymentPushForFinishArtifact",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(deploymentInternalUrl(deploymentPushPath(pushId))),
    catch: error => publicWorkerDispatchError("deployment-finish-push-artifact", error),
  });
});

export const abandonDeploymentPushEffect = Effect.fn(
  "Worker.abandonDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
  body: AbandonPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(
      deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.abandon)),
      jsonPost(body),
    ),
    catch: error => publicWorkerDispatchError("deployment-abandon-push", error),
  });
});

export const finishDeploymentPushEffect = Effect.fn(
  "Worker.finishDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
  body: FinishPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(
      deploymentInternalUrl(deploymentPushPath(pushId, DeploymentPushAction.finish)),
      jsonPost(body),
    ),
    catch: error => publicWorkerDispatchError("deployment-finish-push", error),
  });
});

export const startDeploymentPushEffect = Effect.fn(
  "Worker.startDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  analyzed: AnalyzedStartPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardAnalyzedStartPushEffect(
    deployment,
    analyzed,
    error => publicWorkerDispatchError("deployment-start-push", error),
  );
});

export const startAnalyzedDeploymentPushEffect = Effect.fn(
  "Worker.startAnalyzedDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  body: AnalyzedStartPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardAnalyzedStartPushEffect(
    deployment,
    body,
    error => publicWorkerDispatchError("deployment-start-analyzed-push", error),
  );
});

function forwardAnalyzedStartPushEffect(
  deployment: PublicDeploymentPushDispatchTarget,
  body: AnalyzedStartPushRequest,
  mapError: (error: unknown) => PublicWorkerDispatchError,
): Effect.Effect<Response, PublicWorkerDispatchError> {
  return Effect.tryPromise({
    try: () => deployment.fetch(
      deploymentInternalUrl(DeploymentRoute.startAnalyzedPush),
      jsonPost(body),
    ),
    catch: mapError,
  });
}

type DeploymentInternalPath =
  | typeof DeploymentRoute.activeDeployment
  | typeof DeploymentRoute.startAnalyzedPush
  | `${typeof DeploymentRoute.push}/${string}`
  | `${typeof DeploymentRoute.push}/${string}/${DeploymentPushAction}`;

function deploymentInternalUrl(path: DeploymentInternalPath): string {
  return `https://flarex.internal${path}`;
}

function deploymentPushPath(pushId: string, action?: DeploymentPushAction): DeploymentInternalPath {
  const pushPath: `${typeof DeploymentRoute.push}/${string}` = `${DeploymentRoute.push}/${encodeURIComponent(pushId)}`;
  if (action === undefined) return pushPath;
  return `${pushPath}/${action}`;
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
