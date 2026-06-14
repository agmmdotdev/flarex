import { DurableObject } from "cloudflare:workers";
import { json } from "./http";
import type { Env } from "./types";

export class SchedulerDO extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return json({ service: "flarex-scheduler", status: "ok" });
  }
}
