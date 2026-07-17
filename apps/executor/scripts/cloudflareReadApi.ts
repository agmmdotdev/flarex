import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

export interface H05CloudflareReadApi {
  get(
    path: string,
    query?: Readonly<Record<string, string | number>>,
  ): Promise<H05CloudflareReadResult>;
  publicStatus(origin: string): Promise<number>;
}

export interface H05CloudflareReadResult {
  readonly result: unknown;
  readonly resultInfo: unknown | undefined;
}

export interface H05CloudflareReadApiOptions {
  readonly apiToken: string;
  readonly fetch?: typeof fetch;
  readonly maximumResponseBytes?: number;
  readonly timeoutMs?: number;
}

const cloudflareApiOrigin = "https://api.cloudflare.com";
const cloudflareApiPrefix = "/client/v4";
const defaultMaximumResponseBytes = 1024 * 1024;
const defaultTimeoutMs = 15_000;

export function createH05CloudflareReadApi(
  options: H05CloudflareReadApiOptions,
): H05CloudflareReadApi {
  const apiToken = decodeApiToken(options.apiToken);
  const fetchImplementation = options.fetch ?? fetch;
  const maximumResponseBytes = positiveSafeInteger(
    options.maximumResponseBytes ?? defaultMaximumResponseBytes,
    "maximumResponseBytes",
  );
  const timeoutMs = positiveSafeInteger(
    options.timeoutMs ?? defaultTimeoutMs,
    "timeoutMs",
  );
  return {
    async get(path, query = {}) {
      const url = cloudflareApiUrl(path, query);
      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiToken}`,
          },
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error(`Cloudflare API read failed for ${safePath(path)}.`);
      }
      if (response.status !== 200) {
        await discardBoundedBody(response, maximumResponseBytes);
        throw new Error(
          `Cloudflare API read returned HTTP ${response.status} for ${safePath(path)}.`,
        );
      }
      const value = await readBoundedJson(response, maximumResponseBytes, path);
      return unwrapSuccessEnvelope(value, path);
    },
    async publicStatus(origin) {
      const url = decodePublicOrigin(origin);
      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("H05 direct public Worker check failed before a status was returned.");
      }
      await discardBoundedBody(response, maximumResponseBytes);
      return response.status;
    },
  };
}

function cloudflareApiUrl(
  path: string,
  query: Readonly<Record<string, string | number>>,
): URL {
  if (
    !path.startsWith("/") ||
    path.includes("..") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u0020\u007f]/.test(path)
  ) {
    throw new Error("Cloudflare API path is invalid.");
  }
  const url = new URL(`${cloudflareApiPrefix}${path}`, cloudflareApiOrigin);
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function unwrapSuccessEnvelope(
  value: unknown,
  path: string,
): H05CloudflareReadResult {
  if (!isRecord(value)) {
    throw new Error(`Cloudflare API returned a non-object envelope for ${safePath(path)}.`);
  }
  if (value.success !== true || !Array.isArray(value.errors)) {
    throw new Error(`Cloudflare API returned an invalid envelope for ${safePath(path)}.`);
  }
  if (value.errors.length !== 0) {
    throw new Error(`Cloudflare API reported an error for ${safePath(path)}.`);
  }
  if (!Object.hasOwn(value, "result")) {
    throw new Error(`Cloudflare API omitted its result for ${safePath(path)}.`);
  }
  return {
    result: value.result,
    resultInfo: Object.hasOwn(value, "result_info")
      ? value.result_info
      : undefined,
  };
}

async function readBoundedJson(
  response: Response,
  maximumResponseBytes: number,
  path: string,
): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response, maximumResponseBytes);
  } catch (error) {
    if (error instanceof H05ResponseSizeError) throw error;
    throw new Error(
      `Cloudflare API response body could not be read for ${safePath(path)}.`,
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Cloudflare API returned invalid JSON for ${safePath(path)}.`);
  }
}

async function discardBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  try {
    await readBoundedBody(response, maximumResponseBytes);
  } catch {
    // The status is the only retained public/error evidence. Never surface a body.
  }
}

async function readBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!isNonNegativeSafeInteger(parsed) || parsed > maximumResponseBytes) {
      throw new H05ResponseSizeError();
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
          // Preserve the bounded-size failure and never surface a stream error.
        }
        throw new H05ResponseSizeError();
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

class H05ResponseSizeError extends Error {
  constructor() {
    super("Cloudflare response exceeded the H05 evidence size limit.");
    this.name = "H05ResponseSizeError";
  }
}

function decodeApiToken(value: string): string {
  if (value.length < 10 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error("CLOUDFLARE_API_TOKEN is invalid.");
  }
  return value;
}

function decodePublicOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("H05 direct public Worker origin is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    throw new Error("H05 direct public Worker origin is invalid.");
  }
  return url;
}

function safePath(path: string): string {
  return /^\/[A-Za-z0-9_./{}-]+$/.test(path) ? path : "the requested endpoint";
}

function positiveSafeInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
