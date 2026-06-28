import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { RegistryApi } from "flarex-protocol/registry";
import { RegistryApiHandlers } from "./HttpApiHandlers";
import type { RegistryService } from "./Service";

export interface RegistryApiWebHandler {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
}

export function makeRegistryApiWebHandler(
  registryLayer: Layer.Layer<RegistryService>,
): RegistryApiWebHandler {
  const routes = HttpApiBuilder.layer(RegistryApi).pipe(
    Layer.provide(RegistryApiHandlers),
    Layer.provide(registryLayer),
    Layer.provide(HttpServer.layerServices),
  );

  return HttpRouter.toWebHandler(routes);
}
