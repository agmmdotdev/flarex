import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { DeploymentApi } from "flarex-protocol/deployment";
import { DeploymentApiHandlers } from "./HttpApiHandlers";
import type { DeploymentService } from "./Service";

export interface DeploymentApiWebHandler {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

// Production DeploymentDO routing dispatches decoded route inputs directly.
// Keep this bridge for generated HttpApi handler integration coverage.
export function makeDeploymentApiWebHandler(
  deploymentLayer: Layer.Layer<DeploymentService>,
): DeploymentApiWebHandler {
  const routes = HttpApiBuilder.layer(DeploymentApi).pipe(
    Layer.provide(DeploymentApiHandlers),
    Layer.provide(deploymentLayer),
    Layer.provide(HttpServer.layerServices),
  );

  return HttpRouter.toWebHandler(routes);
}
