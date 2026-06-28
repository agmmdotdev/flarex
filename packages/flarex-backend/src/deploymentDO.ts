import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  DeploymentPushAction,
  DeploymentRoute,
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import {
  deploymentFailureToHttpError,
  finishPushHttpStatus,
  type DeploymentServiceFailure,
} from "./deployment/HttpBoundary";
import {
  DeploymentService,
  type DeploymentServiceApi,
} from "./deployment/Service";
import { makeDeploymentApiWebHandler } from "./deployment/HttpApiWebHandler";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import {
  analyzedStartPushRequest,
  startAnalyzedPushInput,
} from "./deployment/Validation";
import { errorResponse, json, readJson } from "./http";
import type { Env } from "./types";

const deploymentPushRoutePattern = new RegExp(`^${DeploymentRoute.push}/([^/]+)(?:/([^/]+))?$`);

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentLayer = makeDeploymentLayer(
    this.ctx.storage,
    this.sql,
  );
  private readonly deploymentRuntime = ManagedRuntime.make(this.deploymentLayer);
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
      if (url.pathname === DeploymentRoute.activeDeployment && request.method === "GET") {
        return json(await this.runDeploymentService(service => service.getActiveDeployment()));
      }
      if (url.pathname === DeploymentRoute.startAnalyzedPush && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return json(await this.runDeploymentService(service =>
          service.startAnalyzedPush(startAnalyzedPushInput(analyzedStartPushRequest(body)))
        ));
      }
      const pushMatch = url.pathname.match(deploymentPushRoutePattern);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === undefined && request.method === "GET") {
          return json(await this.runDeploymentService(service => service.getPush(pushId)));
        }
        if (action === DeploymentPushAction.finish && request.method === "POST") {
          parseFinishPushRequest(await readJson(request));
          const response = await this.runDeploymentService(service => service.finishPush(pushId));
          return json(response, { status: finishPushHttpStatus(response) });
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

  private async runDeploymentService<A>(
    use: (service: DeploymentServiceApi) => Effect.Effect<A, DeploymentServiceFailure>,
  ): Promise<A> {
    return this.runDeployment(DeploymentService.use(use));
  }

  private async runDeployment<A>(
    effect: Effect.Effect<
      A,
      DeploymentServiceFailure,
      DeploymentService
    >,
  ): Promise<A> {
    const result = await this.deploymentRuntime.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: error => ({ ok: false as const, error }),
          onSuccess: value => ({ ok: true as const, value }),
        }),
      ),
    );
    if (!result.ok) {
      throw deploymentFailureToHttpError(result.error);
    }
    return result.value;
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
