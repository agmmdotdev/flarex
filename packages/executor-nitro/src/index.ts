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
export {
  createFlarexBackendLiveQueryDelivery,
  type FlarexBackendLiveQueryDeliveryConfig,
} from "@flarex/executor-http";

export function createFlarexNitroHandler(
  config: FlarexNitroAdapterConfig,
): (event: FlarexNitroEventLike) => Promise<Response> {
  const handler = createFlarexHttpHandler(config);
  return (event) => handler(event.request);
}
