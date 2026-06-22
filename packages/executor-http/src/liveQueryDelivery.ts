import type {
  LiveQueryDeliveryRecord,
  LiveQueryInvalidationConfig,
  RunLiveQueryDeliveryBatchInput,
} from "@flarex/executor";

export interface FlarexBackendLiveQueryDeliveryConfig {
  backendUrl: string | URL;
  capabilityToken?: string;
  fetch?: typeof fetch;
}

export interface FlarexBackendLiveQueryWakeConfig {
  backendUrl: string | URL;
  capabilityToken?: string;
  fetch?: typeof fetch;
  limit?: number;
  maxBatches?: number;
}

export interface FlarexBackendLiveQueryTriggerConfig {
  backendUrl: string | URL;
  capabilityToken?: string;
  fetch?: typeof fetch;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
}

export interface FlarexBackendLiveQueryWakeInput {
  deploymentId: string;
  limit?: number;
  maxBatches?: number;
}

export interface FlarexBackendLiveQueryTriggerInput {
  deploymentId: string;
  projectId: string;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
}

export function createFlarexBackendLiveQueryDelivery(
  config: FlarexBackendLiveQueryDeliveryConfig,
): RunLiveQueryDeliveryBatchInput["deliver"] {
  const fetcher = config.fetch ?? fetch;
  return async deliveries => {
    const byDeployment = groupDeliveriesByDeployment(deliveries);
    for (const [deploymentId, deploymentDeliveries] of byDeployment) {
      const response = await fetcher(
        liveQueryDeliveryUrl(config.backendUrl, deploymentId),
        {
          method: "POST",
          headers: liveQueryDeliveryHeaders(config.capabilityToken),
          body: JSON.stringify({
            deliveries: deploymentDeliveries.map(delivery => delivery.payloadJson),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Flarex backend live query delivery failed for ${deploymentId}: ${response.status} ${await response.text()}`,
        );
      }
    }
  };
}

export function createFlarexBackendLiveQueryWakeNotifier(
  config: FlarexBackendLiveQueryWakeConfig,
): (input: FlarexBackendLiveQueryWakeInput) => Promise<void> {
  const fetcher = config.fetch ?? fetch;
  return async input => {
    const response = await fetcher(
      liveQueryWakeUrl(config.backendUrl, input.deploymentId),
      {
        method: "POST",
        headers: liveQueryDeliveryHeaders(config.capabilityToken),
        body: JSON.stringify({
          ...((input.limit ?? config.limit) === undefined
            ? {}
            : { limit: input.limit ?? config.limit }),
          ...((input.maxBatches ?? config.maxBatches) === undefined
            ? {}
            : { maxBatches: input.maxBatches ?? config.maxBatches }),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Flarex backend live query wake failed for ${input.deploymentId}: ${response.status} ${await response.text()}`,
      );
    }
  };
}

export function createFlarexBackendLiveQueryTriggerNotifier(
  config: FlarexBackendLiveQueryTriggerConfig,
): NonNullable<LiveQueryInvalidationConfig["notifyTrigger"]> {
  const fetcher = config.fetch ?? fetch;
  return async input => {
    const response = await fetcher(liveQueryTriggerUrl(config.backendUrl), {
      method: "POST",
      headers: liveQueryDeliveryHeaders(config.capabilityToken),
      body: JSON.stringify({
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        ...((config.limit) === undefined ? {} : { limit: config.limit }),
        ...((config.deliveryLimit) === undefined
          ? {}
          : { deliveryLimit: config.deliveryLimit }),
        ...((config.maxBatches) === undefined
          ? {}
          : { maxBatches: config.maxBatches }),
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Flarex backend live query trigger failed for ${input.deploymentId}: ${response.status} ${await response.text()}`,
      );
    }
  };
}

function groupDeliveriesByDeployment(
  deliveries: LiveQueryDeliveryRecord[],
): Map<string, LiveQueryDeliveryRecord[]> {
  const byDeployment = new Map<string, LiveQueryDeliveryRecord[]>();
  for (const delivery of deliveries) {
    const existing = byDeployment.get(delivery.deploymentId);
    if (existing === undefined) {
      byDeployment.set(delivery.deploymentId, [delivery]);
    } else {
      existing.push(delivery);
    }
  }
  return byDeployment;
}

function liveQueryDeliveryUrl(endpoint: string | URL, deploymentId: string): URL {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/deployments/${encodeURIComponent(deploymentId)}/sync/deliver-live-query`;
  url.search = "";
  url.hash = "";
  return url;
}

function liveQueryWakeUrl(endpoint: string | URL, deploymentId: string): URL {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/deployments/${encodeURIComponent(deploymentId)}/sync/wake-delivery`;
  url.search = "";
  url.hash = "";
  return url;
}

function liveQueryTriggerUrl(endpoint: string | URL): URL {
  const url = endpoint instanceof URL ? new URL(endpoint.href) : new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/scheduler/live-query-subscriptions/trigger`;
  url.search = "";
  url.hash = "";
  return url;
}

function liveQueryDeliveryHeaders(capabilityToken: string | undefined): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (capabilityToken !== undefined) {
    headers.set("authorization", `Bearer ${capabilityToken}`);
  }
  return headers;
}
