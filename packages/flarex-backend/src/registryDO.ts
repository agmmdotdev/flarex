import { DurableObject } from "cloudflare:workers";
import { Effect, ManagedRuntime } from "effect";
import {
  parseCreateDeploymentRequest,
  ProtocolValidationError,
  type ListDeploymentsResponse,
} from "flarex-protocol/registry";
import { errorResponse, json, readJson } from "./http";
import { registryFailureToHttpError } from "./registry/HttpBoundary";
import { makeRegistryLayer } from "./registry/Layer";
import { RegistryService } from "./registry/Service";
import { initializeRegistryStorage } from "./registry/StorageSchema";
import type { RegistrySqlError } from "./registry/Store";
import type { Env } from "./types";

export class RegistryDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly registryRuntime = ManagedRuntime.make(makeRegistryLayer(this.sql));

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeRegistryStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ service: "flarex-registry", status: "ok" });
      }
      if (url.pathname === "/deployments" && request.method === "POST") {
        const body = parseCreateDeploymentRequest(await readJson(request));
        return await this.runRegistryResponse(
          RegistryService.use(service => service.createDeployment(body)),
          deployment => json(deployment),
        );
      }
      if (url.pathname === "/deployments" && request.method === "GET") {
        return await this.runRegistryResponse(
          RegistryService.use(service => service.listDeployments()),
          response => json(response satisfies ListDeploymentsResponse),
        );
      }
      return json({ error: "Not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof ProtocolValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      return errorResponse(error);
    }
  }

  private runRegistryResponse<A>(
    effect: Effect.Effect<A, RegistrySqlError, RegistryService>,
    onSuccess: (value: A) => Response,
  ): Promise<Response> {
    return this.registryRuntime.runPromise(
      effect.pipe(
        Effect.match({
          onFailure: error => errorResponse(registryFailureToHttpError(error)),
          onSuccess,
        }),
      ),
    );
  }
}
