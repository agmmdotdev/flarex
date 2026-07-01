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
  type PublicWorkerDispatchSource,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicDeploymentPushDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export type PublicDeploymentPushDispatchOperation = Extract<
  PublicWorkerDispatchSource,
  | "deployment-read-push"
  | "deployment-start-push"
  | "deployment-start-analyzed-push"
  | "deployment-finish-push-artifact"
  | "deployment-finish-push"
  | "deployment-abandon-push"
>;

export const readDeploymentPushEffect = Effect.fn(
  "Worker.readDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* dispatchDeploymentPushEffect(
    deployment,
    "deployment-read-push",
    deploymentPushPath(pushId),
  );
});

export const readDeploymentPushForFinishArtifactEffect = Effect.fn(
  "Worker.readDeploymentPushForFinishArtifact",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* dispatchDeploymentPushEffect(
    deployment,
    "deployment-finish-push-artifact",
    deploymentPushPath(pushId),
  );
});

export const abandonDeploymentPushEffect = Effect.fn(
  "Worker.abandonDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
  body: AbandonPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* dispatchDeploymentPushEffect(
    deployment,
    "deployment-abandon-push",
    deploymentPushPath(pushId, DeploymentPushAction.abandon),
    jsonPost(body),
  );
});

export const finishDeploymentPushEffect = Effect.fn(
  "Worker.finishDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  pushId: string,
  body: FinishPushRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* dispatchDeploymentPushEffect(
    deployment,
    "deployment-finish-push",
    deploymentPushPath(pushId, DeploymentPushAction.finish),
    jsonPost(body),
  );
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
    "deployment-start-push",
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
    "deployment-start-analyzed-push",
  );
});

function forwardAnalyzedStartPushEffect(
  deployment: PublicDeploymentPushDispatchTarget,
  body: AnalyzedStartPushRequest,
  operation: PublicDeploymentPushDispatchOperation,
): Effect.Effect<Response, PublicWorkerDispatchError> {
  return dispatchDeploymentPushEffect(
    deployment,
    operation,
    DeploymentRoute.startAnalyzedPush,
    jsonPost(body),
  );
}

export const dispatchDeploymentPushEffect = Effect.fn(
  "Worker.dispatchDeploymentPush",
)(function* (
  deployment: PublicDeploymentPushDispatchTarget,
  operation: PublicDeploymentPushDispatchOperation,
  path: DeploymentInternalPath,
  init?: RequestInit,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(deploymentInternalUrl(path), init),
    catch: error => publicWorkerDispatchError(operation, error),
  });
});

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
