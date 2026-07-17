import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import { isH05CloudflareHexId } from "../h05/cloudflareHexId";

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

const cloudflareApiOrigin = "https://api.cloudflare.com";
const cloudflareApiPrefix = "/client/v4";
const defaultMaximumRequestBytes = 64 * 1024;
const defaultMaximumResponseBytes = 4 * 1024 * 1024;
const defaultTimeoutMs = 15_000;

export function createH05CloudflareTelemetryApi(
  options: H05CloudflareTelemetryApiOptions,
): H05CloudflareTelemetryApi {
  const apiToken = decodeApiToken(options.apiToken);
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
        await discardBoundedBody(response, maximumResponseBytes);
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
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Cloudflare telemetry query returned invalid JSON.");
  }
}

async function discardBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  try {
    await readBoundedBody(response, maximumResponseBytes);
  } catch {
    // The status is the only retained error evidence. Never surface a body.
  }
}

async function readBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (
      !isNonNegativeSafeInteger(parsed) ||
      parsed > maximumResponseBytes
    ) {
      throw new H05TelemetryResponseSizeError();
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size failure and never surface a stream error.
        }
        throw new H05TelemetryResponseSizeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

class H05TelemetryResponseSizeError extends Error {
  constructor() {
    super("Cloudflare telemetry response exceeded the H05 evidence size limit.");
    this.name = "H05TelemetryResponseSizeError";
  }
}

function cloudflareAccountId(value: string): string {
  if (!isH05CloudflareHexId(value)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function decodeApiToken(value: string): string {
  if (
    value.length < 10 ||
    value !== value.trim() ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    throw new Error("FLAREX_H05_TELEMETRY_API_TOKEN is invalid.");
  }
  return value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
