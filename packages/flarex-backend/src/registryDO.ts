import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
  ProtocolValidationError,
  RegistryRoute,
} from "flarex-protocol/registry";
import { errorResponse, json } from "./http";
import {
  decodeRegistryApiRequestForRoute,
  registryRouteErrorToHttpError,
} from "./registry/HttpApiRouteBoundary";
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
    try {
      const url = new URL(request.url);
      const apiRequest = await Effect.runPromise(
        decodeRegistryApiRequestForRoute(request).pipe(
          Effect.mapError(registryRouteErrorToHttpError),
        ),
      );
      if (apiRequest !== null) {
        return this.registryApi.handler(apiRequest);
      }
      if (url.pathname === RegistryRoute.health) {
        return json({ service: "flarex-registry", status: "ok" });
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }
}
