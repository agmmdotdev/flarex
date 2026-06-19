import {
  createFlarexHttpApp,
  createFlarexHttpHandler,
  type FlarexHttpAppConfig,
} from "@flarex/executor-http";

export interface FlarexNitroEventLike {
  request: Request;
}

export interface FlarexNitroAdapterConfig extends FlarexHttpAppConfig {}

export { createFlarexHttpApp, createFlarexHttpHandler };

export function createFlarexNitroHandler(
  config: FlarexNitroAdapterConfig,
): (event: FlarexNitroEventLike) => Promise<Response> {
  const handler = createFlarexHttpHandler(config);
  return (event) => handler(event.request);
}
