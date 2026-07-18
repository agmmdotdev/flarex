import { Result } from "effect";

import { isH05HttpsOriginUrl } from "../h05/httpsOrigin";
import {
  cloudflareApiOrigin,
  cloudflareApiPrefix,
  cloudflareApiToken,
  positiveSafeInteger,
} from "./cloudflareApiConfiguration";
import {
  decodeH05CloudflareSuccessEnvelope,
  type H05CloudflareSuccessEnvelopeIssue,
} from "./cloudflareSuccessEnvelope";
import { discardH05BoundedResponseBody } from "./h05BoundedResponseBody";
import { readH05BoundedJsonResponse } from "./h05BoundedJsonResponse";

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

const defaultMaximumResponseBytes = 1024 * 1024;
const defaultTimeoutMs = 15_000;

export function createH05CloudflareReadApi(
  options: H05CloudflareReadApiOptions,
): H05CloudflareReadApi {
  const apiToken = cloudflareApiToken(options.apiToken, "CLOUDFLARE_API_TOKEN");
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
        await discardH05BoundedResponseBody(response, maximumResponseBytes);
        throw new Error(
          `Cloudflare API read returned HTTP ${response.status} for ${safePath(path)}.`,
        );
      }
      const value = await readH05BoundedJsonResponse(
        response,
        maximumResponseBytes,
        {
          createSizeError: () => new H05ResponseSizeError(),
          mapReadFailure: (cause) =>
            cause instanceof H05ResponseSizeError
              ? cause
              : new Error(
                `Cloudflare API response body could not be read for ${safePath(path)}.`,
              ),
          mapDecodeFailure: () =>
            new Error(
              `Cloudflare API returned invalid JSON for ${safePath(path)}.`,
            ),
        },
      );
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
      await discardH05BoundedResponseBody(response, maximumResponseBytes);
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
  const envelope = Result.getOrThrowWith(
    decodeH05CloudflareSuccessEnvelope(value),
    issue => new Error(cloudflareReadEnvelopeErrorMessage(issue, path)),
  );
  return {
    result: envelope.result,
    resultInfo: Object.hasOwn(envelope.record, "result_info")
      ? envelope.record.result_info
      : undefined,
  };
}

function cloudflareReadEnvelopeErrorMessage(
  issue: H05CloudflareSuccessEnvelopeIssue,
  path: string,
): string {
  const redactedPath = safePath(path);
  switch (issue.reason) {
    case "nonObject":
      return `Cloudflare API returned a non-object envelope for ${redactedPath}.`;
    case "invalidEnvelope":
      return `Cloudflare API returned an invalid envelope for ${redactedPath}.`;
    case "reportedError":
      return `Cloudflare API reported an error for ${redactedPath}.`;
    case "missingResult":
      return `Cloudflare API omitted its result for ${redactedPath}.`;
    default:
      return issue satisfies never;
  }
}

class H05ResponseSizeError extends Error {
  constructor() {
    super("Cloudflare response exceeded the H05 evidence size limit.");
    this.name = "H05ResponseSizeError";
  }
}

function decodePublicOrigin(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("H05 direct public Worker origin is invalid.");
  }
  if (
    !isH05HttpsOriginUrl(url) ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    throw new Error("H05 direct public Worker origin is invalid.");
  }
  return url;
}

function safePath(path: string): string {
  return /^\/[A-Za-z0-9_./{}-]+$/.test(path) ? path : "the requested endpoint";
}
