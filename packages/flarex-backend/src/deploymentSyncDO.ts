import { DurableObject } from "cloudflare:workers";
import { Result } from "effect";

import {
  initializeDeploymentSyncStorage,
} from "./deploymentSync/Store";
import type { Env } from "./types";

export class DeploymentSyncDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    Result.getOrThrow(initializeDeploymentSyncStorage(this.ctx.storage.sql));
  }
}
