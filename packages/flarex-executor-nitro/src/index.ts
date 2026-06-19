import type { FlarexExecutor } from "flarex-executor";
import { createFlarexExecutor } from "flarex-executor";

export interface FlarexNitroEventLike {
  request: Request;
}

export interface FlarexNitroAdapterConfig {
  executor?: FlarexExecutor;
}

export function createFlarexNitroHandler(
  config: FlarexNitroAdapterConfig = {},
): (event: FlarexNitroEventLike) => Promise<Response> {
  const executor = config.executor ?? createFlarexExecutor();

  return async (event) => executor.fetch(event.request);
}
