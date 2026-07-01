import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
  routeDeploymentDurableObject,
  runDeploymentDurableObjectRoute,
} from "./deployment/InternalRouteBoundary";
import { makeDeploymentLayer } from "./deployment/Layer";
import { makeDeploymentApiWebHandler } from "./deployment/HttpApiWebHandler";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import type { Env } from "./types";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentLayer = makeDeploymentLayer(
    this.ctx.storage,
    this.sql,
  );
  private readonly deploymentApi = makeDeploymentApiWebHandler(this.deploymentLayer);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeDeploymentStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    return await runDeploymentDurableObjectRoute(
      routeDeploymentDurableObject(
        request,
        apiRequest => this.deploymentApi.handler(apiRequest),
      ).pipe(Effect.provide(this.deploymentLayer)),
    );
  }
}
