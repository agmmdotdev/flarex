import type {
  LiveQueryDeliveryRecord,
  LiveQueryInvalidationConfig,
  RunLiveQueryDeliveryBatchInput,
} from "@flarex/executor";
import { Data, Effect } from "effect";

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

type FlarexBackendLiveQueryOperation = "delivery" | "wake" | "trigger";

type FlarexBackendLiveQueryPostContext = {
  readonly operation: FlarexBackendLiveQueryOperation;
  readonly deploymentId: string;
  readonly failedMessagePrefix: string;
  readonly fetcher: typeof fetch;
};

export class FlarexBackendLiveQueryResponseError extends Data.TaggedError(
  "FlarexBackendLiveQueryResponseError",
)<{
  readonly operation: FlarexBackendLiveQueryOperation;
  readonly deploymentId: string;
  readonly status: number;
  readonly body: string;
  readonly message: string;
}> {}

export class FlarexBackendLiveQueryFetchError extends Data.TaggedError(
  "FlarexBackendLiveQueryFetchError",
)<{
  readonly operation: FlarexBackendLiveQueryOperation;
  readonly deploymentId: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type FlarexBackendLiveQueryError =
  | FlarexBackendLiveQueryResponseError
  | FlarexBackendLiveQueryFetchError;

export function createFlarexBackendLiveQueryDelivery(
  config: FlarexBackendLiveQueryDeliveryConfig,
): RunLiveQueryDeliveryBatchInput["deliver"] {
  return deliveries =>
    runFlarexBackendLiveQueryPromise(
      deliverFlarexBackendLiveQueryEffect(config, deliveries),
    );
}

export function createFlarexBackendLiveQueryWakeNotifier(
  config: FlarexBackendLiveQueryWakeConfig,
): (input: FlarexBackendLiveQueryWakeInput) => Promise<void> {
  return input =>
    runFlarexBackendLiveQueryPromise(
      notifyFlarexBackendLiveQueryWakeEffect(config, input),
    );
}

export function createFlarexBackendLiveQueryTriggerNotifier(
  config: FlarexBackendLiveQueryTriggerConfig,
): NonNullable<LiveQueryInvalidationConfig["notifyTrigger"]> {
  return input =>
    runFlarexBackendLiveQueryPromise(
      notifyFlarexBackendLiveQueryTriggerEffect(config, input),
    );
}

export const deliverFlarexBackendLiveQueryEffect = Effect.fn(
  "ExecutorHttp.deliverFlarexBackendLiveQuery",
)(function* (
  config: FlarexBackendLiveQueryDeliveryConfig,
  deliveries: ReadonlyArray<LiveQueryDeliveryRecord>,
) {
  const fetcher = config.fetch ?? fetch;
  const byDeployment = groupDeliveriesByDeployment(deliveries);
  for (const [deploymentId, deploymentDeliveries] of byDeployment) {
    yield* postFlarexBackendLiveQueryEffect(
      {
        operation: "delivery",
        deploymentId,
        failedMessagePrefix: "Flarex backend live query delivery failed",
        fetcher,
      },
      liveQueryDeliveryUrl(config.backendUrl, deploymentId),
      {
        method: "POST",
        headers: liveQueryDeliveryHeaders(config.capabilityToken),
        body: JSON.stringify({
          deliveries: deploymentDeliveries.map(delivery => delivery.payloadJson),
        }),
      },
    );
  }
});

export const notifyFlarexBackendLiveQueryWakeEffect = Effect.fn(
  "ExecutorHttp.notifyFlarexBackendLiveQueryWake",
)(function* (
  config: FlarexBackendLiveQueryWakeConfig,
  input: FlarexBackendLiveQueryWakeInput,
) {
  const fetcher = config.fetch ?? fetch;
  yield* postFlarexBackendLiveQueryEffect(
    {
      operation: "wake",
      deploymentId: input.deploymentId,
      failedMessagePrefix: "Flarex backend live query wake failed",
      fetcher,
    },
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
});

export const notifyFlarexBackendLiveQueryTriggerEffect = Effect.fn(
  "ExecutorHttp.notifyFlarexBackendLiveQueryTrigger",
)(function* (
  config: FlarexBackendLiveQueryTriggerConfig,
  input: FlarexBackendLiveQueryTriggerInput,
) {
  const fetcher = config.fetch ?? fetch;
  yield* postFlarexBackendLiveQueryEffect(
    {
      operation: "trigger",
      deploymentId: input.deploymentId,
      failedMessagePrefix: "Flarex backend live query trigger failed",
      fetcher,
    },
    liveQueryTriggerUrl(config.backendUrl),
    {
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
    },
  );
});

function runFlarexBackendLiveQueryPromise(
  effect: Effect.Effect<void, FlarexBackendLiveQueryError>,
): Promise<void> {
  // Deliberate runtime bridge: executor service ports expose Promise helpers.
  return Effect.runPromise(
    effect.pipe(Effect.mapError(flarexBackendLiveQueryErrorToError)),
  );
}

const postFlarexBackendLiveQueryEffect = Effect.fn(
  "ExecutorHttp.postFlarexBackendLiveQuery",
)(
  function* (
    context: FlarexBackendLiveQueryPostContext,
    input: RequestInfo | URL,
    init: RequestInit,
  ) {
    const response = yield* Effect.tryPromise({
      try: () => context.fetcher(input, init),
      catch: cause => new FlarexBackendLiveQueryFetchError({
        operation: context.operation,
        deploymentId: context.deploymentId,
        message: `${context.failedMessagePrefix} for ${context.deploymentId}: ${errorMessage(cause)}`,
        cause,
      }),
    });
    if (response.ok) return;
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: cause => new FlarexBackendLiveQueryFetchError({
        operation: context.operation,
        deploymentId: context.deploymentId,
        message: `${context.failedMessagePrefix} for ${context.deploymentId}: ${response.status} ${errorMessage(cause)}`,
        cause,
      }),
    });
    return yield* Effect.fail(new FlarexBackendLiveQueryResponseError({
      operation: context.operation,
      deploymentId: context.deploymentId,
      status: response.status,
      body,
      message: `${context.failedMessagePrefix} for ${context.deploymentId}: ${response.status} ${body}`,
    }));
  },
);

function flarexBackendLiveQueryErrorToError(error: FlarexBackendLiveQueryError): Error {
  if (error instanceof FlarexBackendLiveQueryFetchError && error.cause instanceof Error) {
    return error.cause;
  }
  return new Error(error.message);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function groupDeliveriesByDeployment(
  deliveries: ReadonlyArray<LiveQueryDeliveryRecord>,
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
