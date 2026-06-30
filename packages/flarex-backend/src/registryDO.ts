import { DurableObject } from "cloudflare:workers";
import {
  routeRegistryDurableObject,
  runRegistryDurableObjectRoute,
} from "./registry/InternalRouteBoundary";
import { makeRegistryApiWebHandler } from "./registry/HttpApiWebHandler";
import { makeRegistryLayer } from "./registry/Layer";
import { initializeRegistryStorage } from "./registry/StorageSchema";
import type { Env } from "./types";

export class RegistryDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly registryLayer = makeRegistryLayer(this.sql);
  private readonly registryApi = makeRegistryApiWebHandler(this.registryLayer);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeRegistryStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    return await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(
        request,
        apiRequest => this.registryApi.handler(apiRequest),
      ),
    );
  }
}
