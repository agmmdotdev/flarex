import { DurableObject } from "cloudflare:workers";
import {
  DeploymentPushAction,
  DeploymentRoute,
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import { makeDeploymentApiWebHandler } from "./deployment/HttpApiWebHandler";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import { errorResponse, json, readJson } from "./http";
import type { Env } from "./types";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

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
      if (isDeploymentApiReadRoute(request, url)) {
        return this.deploymentApi.handler(request);
      }
      if (url.pathname === DeploymentRoute.health) {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return this.deploymentApi.handler(jsonRequest(url, body));
      }
      const pushMatch = url.pathname.match(deploymentPushRoutePattern);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === DeploymentPushAction.finish && request.method === "POST") {
          const body = parseFinishPushRequest(await readJson(request));
          return this.deploymentApi.handler(jsonRequest(url, body));
        }
        if (action === DeploymentPushAction.abandon && request.method === "POST") {
          const body = parseAbandonPushRequest(await readJson(request));
          return this.deploymentApi.handler(jsonRequest(url, body));
        }
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

function jsonRequest(url: URL, body: unknown): Request {
  return new Request(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isDeploymentApiReadRoute(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (url.pathname === DeploymentRoute.health || url.pathname === DeploymentRoute.activeDeployment) {
    return true;
  }
  const pushMatch = url.pathname.match(deploymentPushRoutePattern);
  return pushMatch !== null && pushMatch[2] === undefined;
}
