import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import {
  cloudflareAccountId,
  cloudflareApiOrigin,
  cloudflareApiPrefix,
  cloudflareApiToken,
  positiveSafeInteger,
} from "./cloudflareApiConfiguration";
import {
  discardH05BoundedResponseBody,
  readH05BoundedResponseBody,
} from "./h05BoundedResponseBody";
import { decodeH05JsonBytesOrThrow } from "./h05JsonBytes";

export type H05TelemetryView = "events" | "traces";

export interface H05TelemetryTimeframe {
  readonly from: number;
  readonly to: number;
}

export interface H05TelemetryFilter {
  readonly key: string;
  readonly kind: "filter";
  readonly operation: "eq";
  readonly type: "string";
  readonly value: string;
}

export interface H05TelemetryQueryRequest {
  readonly dry: true;
  readonly ignoreSeries: true;
  readonly limit: number;
  readonly offset?: string;
  readonly offsetDirection?: "next";
  readonly parameters: {
    readonly datasets: readonly ["cloudflare-workers"];
    readonly filterCombination: "and";
    readonly filters: readonly H05TelemetryFilter[];
  };
  readonly queryId: string;
  readonly timeframe: H05TelemetryTimeframe;
  readonly view: H05TelemetryView;
}

export interface H05CloudflareTelemetryApi {
  query(accountId: string, request: H05TelemetryQueryRequest): Promise<unknown>;
}

export interface H05CloudflareTelemetryApiOptions {
  readonly apiToken: string;
  readonly fetch?: typeof fetch;
  readonly maximumRequestBytes?: number;
  readonly maximumResponseBytes?: number;
  readonly timeoutMs?: number;
}

const defaultMaximumRequestBytes = 64 * 1024;
const defaultMaximumResponseBytes = 4 * 1024 * 1024;
const defaultTimeoutMs = 15_000;

export function createH05CloudflareTelemetryApi(
  options: H05CloudflareTelemetryApiOptions,
): H05CloudflareTelemetryApi {
  const apiToken = cloudflareApiToken(
    options.apiToken,
    "FLAREX_H05_TELEMETRY_API_TOKEN",
  );
  const fetchImplementation = options.fetch ?? fetch;
  const maximumRequestBytes = positiveSafeInteger(
    options.maximumRequestBytes ?? defaultMaximumRequestBytes,
    "maximumRequestBytes",
  );
  const maximumResponseBytes = positiveSafeInteger(
    options.maximumResponseBytes ?? defaultMaximumResponseBytes,
    "maximumResponseBytes",
  );
  const timeoutMs = positiveSafeInteger(
    options.timeoutMs ?? defaultTimeoutMs,
    "timeoutMs",
  );

  return {
    async query(accountId, request) {
      const validatedAccountId = cloudflareAccountId(accountId);
      const body = JSON.stringify(request);
      if (new TextEncoder().encode(body).byteLength > maximumRequestBytes) {
        throw new Error("Cloudflare telemetry query exceeded the H05 request size limit.");
      }
      const path = `/accounts/${validatedAccountId}/workers/observability/telemetry/query`;
      const url = new URL(`${cloudflareApiPrefix}${path}`, cloudflareApiOrigin);
      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiToken}`,
            "content-type": "application/json",
          },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("Cloudflare telemetry query failed before a response was returned.");
      }
      if (response.status !== 200) {
        await discardH05BoundedResponseBody(response, maximumResponseBytes);
        throw new Error(
          `Cloudflare telemetry query returned HTTP ${response.status}.`,
        );
      }
      const envelope = await readBoundedJson(response, maximumResponseBytes);
      return unwrapSuccessEnvelope(envelope);
    },
  };
}

function unwrapSuccessEnvelope(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new Error("Cloudflare telemetry query returned a non-object envelope.");
  }
  if (value.success !== true || !Array.isArray(value.errors)) {
    throw new Error("Cloudflare telemetry query returned an invalid envelope.");
  }
  if (value.errors.length !== 0) {
    throw new Error("Cloudflare telemetry query reported an error.");
  }
  if (!Object.hasOwn(value, "result")) {
    throw new Error("Cloudflare telemetry query omitted its result.");
  }
  return value.result;
}

async function readBoundedJson(
  response: Response,
  maximumResponseBytes: number,
): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response, maximumResponseBytes);
  } catch (error) {
    if (error instanceof H05TelemetryResponseSizeError) throw error;
    throw new Error("Cloudflare telemetry response body could not be read.");
  }
  return decodeH05JsonBytesOrThrow(
    bytes,
    () => new Error("Cloudflare telemetry query returned invalid JSON."),
  );
}

async function readBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<Uint8Array> {
  return readH05BoundedResponseBody(
    response,
    maximumResponseBytes,
    () => new H05TelemetryResponseSizeError(),
  );
}

class H05TelemetryResponseSizeError extends Error {
  constructor() {
    super("Cloudflare telemetry response exceeded the H05 evidence size limit.");
    this.name = "H05TelemetryResponseSizeError";
  }
}
