import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
  routeRegistryDurableObject,
  runRegistryDurableObjectRoute,
} from "./registry/InternalRouteBoundary";
import { makeRegistryLayer } from "./registry/Layer";
import { initializeRegistryStorage } from "./registry/StorageSchema";
import type { Env } from "./types";

export class RegistryDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly registryLayer = makeRegistryLayer(this.sql);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeRegistryStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    return await runRegistryDurableObjectRoute(
      routeRegistryDurableObject(request).pipe(Effect.provide(this.registryLayer)),
    );
  }
}
