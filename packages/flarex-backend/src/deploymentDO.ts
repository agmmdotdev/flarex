import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  parseAnalyzedStartPushRequest,
  DeploymentProtocolValidationError,
  parseAbandonPushRequest,
  parseFinishPushRequest,
} from "flarex-protocol/deployment";
import { makeDeploymentLayer } from "./deployment/Layer";
import {
  deploymentFailureToHttpError,
  type DeploymentServiceFailure,
} from "./deployment/HttpBoundary";
import {
  DeploymentService,
  type DeploymentServiceApi,
} from "./deployment/Service";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import {
  analyzedStartPushRequest,
  startAnalyzedPushInput,
} from "./deployment/Validation";
import { errorResponse, json, readJson } from "./http";
import type { Env } from "./types";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentRuntime = ManagedRuntime.make(
    makeDeploymentLayer(
      this.ctx.storage,
      this.sql,
    ),
  );

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeDeploymentStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-deployment", status: "ok" });
      }
      if (url.pathname === "/deployment" && request.method === "GET") {
        return json(await this.runDeploymentService(service => service.getActiveDeployment()));
      }
      if (url.pathname === "/push/start-analyzed" && request.method === "POST") {
        const body = parseAnalyzedStartPushRequest(await readJson(request));
        return json(await this.runDeploymentService(service =>
          service.startAnalyzedPush(startAnalyzedPushInput(analyzedStartPushRequest(body)))
        ));
      }
      const pushMatch = url.pathname.match(/^\/push\/([^/]+)(?:\/([^/]+))?$/);
      if (pushMatch) {
        const pushId = decodeURIComponent(pushMatch[1]!);
        const action = pushMatch[2];
        if (action === undefined && request.method === "GET") {
          return json(await this.runDeploymentService(service => service.getPush(pushId)));
        }
        if (action === "finish" && request.method === "POST") {
          parseFinishPushRequest(await readJson(request));
          const response = await this.runDeploymentService(service => service.finishPush(pushId));
          return json(response, { status: response.result === "rejected" ? 409 : 200 });
        }
        if (action === "abandon" && request.method === "POST") {
          const body = parseAbandonPushRequest(await readJson(request));
          return json(await this.runDeploymentService(service =>
            service.abandonPush(pushId, body.reason === undefined ? {} : { reason: body.reason })
          ));
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
