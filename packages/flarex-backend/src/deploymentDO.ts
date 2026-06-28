import { DurableObject } from "cloudflare:workers";
import {
  DeploymentRoute,
  DeploymentProtocolValidationError,
} from "flarex-protocol/deployment";
import { deploymentApiRequestForRoute } from "./deployment/HttpApiRouteBoundary";
import { makeDeploymentLayer } from "./deployment/Layer";
import { makeDeploymentApiWebHandler } from "./deployment/HttpApiWebHandler";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import { errorResponse, json } from "./http";
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
    try {
      const url = new URL(request.url);
      const apiRequest = await deploymentApiRequestForRoute(request);
      if (apiRequest !== null) {
        return this.deploymentApi.handler(apiRequest);
      }
      if (url.pathname === DeploymentRoute.health) {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof DeploymentProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }
}
