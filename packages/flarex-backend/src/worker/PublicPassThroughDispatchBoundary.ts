import { Effect } from "effect";
import { DeploymentRoute } from "flarex-protocol/deployment";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "./PublicRouteDispatchError";

export interface PublicWorkerPassThroughTarget {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export const dispatchRegistryDeploymentsEffect = Effect.fn(
  "Worker.dispatchRegistryDeployments",
)(function* (
  registry: PublicWorkerPassThroughTarget,
  request: Request,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => registry.fetch(request),
    catch: error => publicWorkerDispatchError("registry-deployments", error),
  });
});

export const readDeploymentActiveEffect = Effect.fn(
  "Worker.readDeploymentActive",
)(function* (
  deployment: PublicWorkerPassThroughTarget,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => deployment.fetch(`https://flarex.internal${DeploymentRoute.activeDeployment}`),
    catch: error => publicWorkerDispatchError("deployment-active-read", error),
  });
});

export const syncPublicConnectionEffect = Effect.fn(
  "Worker.syncPublicConnection",
)(function* (
  connection: PublicWorkerPassThroughTarget,
  request: Request,
  deploymentId: string,
  connectionName: string,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => {
      const headers = new Headers(request.headers);
      headers.set("x-flarex-deployment", deploymentId);
      headers.set("x-flarex-connection", connectionName);
      return connection.fetch(new Request(request, { headers }));
    },
    catch: error => publicWorkerDispatchError("connection-sync", error),
  });
});

export const dispatchDeploymentSchedulerEffect = Effect.fn(
  "Worker.dispatchDeploymentScheduler",
)(function* (
  scheduler: PublicWorkerPassThroughTarget,
  request: Request,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => scheduler.fetch(request),
    catch: error => publicWorkerDispatchError("deployment-scheduler", error),
  });
});
