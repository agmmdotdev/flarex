import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import {
  runDeploymentSyncCatchUpProbe,
  type DeploymentSyncCatchUpProbeResponse,
} from "./deploymentSync/CatchUpProbe";
import type { Env } from "./types";

export class DeploymentSyncDO extends DurableObject<Env> {
  async runCatchUpProbe(
    request: unknown,
  ): Promise<DeploymentSyncCatchUpProbeResponse> {
    return await Effect.runPromise(runDeploymentSyncCatchUpProbe({
      env: this.env,
      objectId: this.ctx.id,
      storage: this.ctx.storage,
      request,
    }));
  }
}
