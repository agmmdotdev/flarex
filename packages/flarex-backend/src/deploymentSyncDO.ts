import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export class DeploymentSyncDO extends DurableObject<Env> {}
