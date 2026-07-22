import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
  routeDeploymentDurableObject,
  runDeploymentDurableObjectRoute,
} from "./deployment/InternalRouteBoundary";
import { makeDeploymentLayer } from "./deployment/Layer";
import { initializeDeploymentStorage } from "./deployment/StorageSchema";
import { makeSourceArtifactV2AttemptReader } from "./sourceArtifactV2/AttemptStore";
import {
  isSourceArtifactV2FinalizedAttemptReadRequestV1,
  makeSourceArtifactV2FinalizedAttemptReadRouteV1,
} from "./sourceArtifactV2/FinalizedAttemptReadBoundary";
import { makeLiveSourceArtifactV2Sha256 } from "./sourceArtifactV2/Sha256";
import type { Env } from "./types";

export class DeploymentDO extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;
  private readonly deploymentLayer = makeDeploymentLayer(
    this.ctx.storage,
    this.sql,
  );
  private readonly sourceArtifactV2AttemptReader =
    makeSourceArtifactV2AttemptReader(this.sql);
  private readonly sourceArtifactV2FinalizedAttemptReadRoute =
    makeSourceArtifactV2FinalizedAttemptReadRouteV1({
      durableObjectName: this.ctx.id.name,
      reader: this.sourceArtifactV2AttemptReader,
      sha256: makeLiveSourceArtifactV2Sha256(),
    });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeDeploymentStorage(this.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const route = isSourceArtifactV2FinalizedAttemptReadRequestV1(request)
      ? this.sourceArtifactV2FinalizedAttemptReadRoute.route(request)
      : routeDeploymentDurableObject(request).pipe(Effect.provide(this.deploymentLayer));
    return await runDeploymentDurableObjectRoute(route);
  }
}
