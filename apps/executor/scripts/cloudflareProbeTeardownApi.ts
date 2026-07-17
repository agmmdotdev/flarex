import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord as isRecord } from "@flarex/utils/records";

import { isH05CloudflareHexId } from "../h05/cloudflareHexId";
import {
  decodeH05ProofRunId,
  type H05ProofRunId,
} from "../h05/proofIdentity";
import { h05ProbeEndpoint } from "../h05/probeProtocol";
import { h05ProbeWorkerName } from "../h05/receipt";

export type H05CloudflareProbeDeletionResult =
  | { readonly outcome: "deleted"; readonly status: 200 }
  | { readonly outcome: "already-absent"; readonly status: 404 };

export interface H05CloudflareProbeTeardownApi {
  verifyAccountAccess(): Promise<200>;
  deleteProbe(): Promise<H05CloudflareProbeDeletionResult>;
  probeScriptStatus(): Promise<200 | 404>;
  publicProbeStatus(): Promise<number>;
}

export interface H05CloudflareProbeTeardownApiOptions {
  readonly accountId: string;
  readonly apiToken: string;
  readonly fetch?: typeof fetch;
  readonly maximumResponseBytes?: number;
  readonly probePublicOrigin: string;
  readonly runId: string;
  readonly timeoutMs?: number;
}

const cloudflareApiOrigin = "https://api.cloudflare.com";
const cloudflareApiPrefix = "/client/v4";
const defaultMaximumResponseBytes = 64 * 1024;
const defaultTimeoutMs = 15_000;
const accessCheckTag = "flarex-h05-teardown-access-check-v1:yes";

export function createH05CloudflareProbeTeardownApi(
  options: H05CloudflareProbeTeardownApiOptions,
): H05CloudflareProbeTeardownApi {
  const accountId = cloudflareAccountId(options.accountId);
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
  const probePublicOrigin = workersDevOrigin(options.probePublicOrigin);
  const runId = proofRunId(options.runId);
  const scriptUrl = new URL(
    `${cloudflareApiPrefix}/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(h05ProbeWorkerName)}`,
    cloudflareApiOrigin,
  );
  const scriptsAccessUrl = new URL(
    `${cloudflareApiPrefix}/accounts/${encodeURIComponent(accountId)}/workers/scripts`,
    cloudflareApiOrigin,
  );
  scriptsAccessUrl.searchParams.set("tags", accessCheckTag);
  const publicProbeUrl = new URL(
    h05ProbeEndpoint(runId),
    `${probePublicOrigin}/`,
  );

  return {
    async verifyAccountAccess() {
      const response = await apiRequest(
        fetchImplementation,
        scriptsAccessUrl,
        "GET",
        apiToken,
        timeoutMs,
      );
      if (response.status !== 200) {
        await discardBoundedBody(response, maximumResponseBytes);
        throw new Error(
          `Cloudflare Scripts account access check returned HTTP ${response.status}.`,
        );
      }
      await validateAccountAccess(response, maximumResponseBytes);
      return 200;
    },

    async deleteProbe() {
      const response = await apiRequest(
        fetchImplementation,
        scriptUrl,
        "DELETE",
        apiToken,
        timeoutMs,
      );
      if (response.status === 404) {
        await discardBoundedBody(response, maximumResponseBytes);
        return { outcome: "already-absent", status: 404 };
      }
      if (response.status !== 200) {
        await discardBoundedBody(response, maximumResponseBytes);
        throw new Error(
          `Cloudflare probe deletion returned HTTP ${response.status}.`,
        );
      }
      await validateDeleteSuccess(response, maximumResponseBytes);
      return { outcome: "deleted", status: 200 };
    },

    async probeScriptStatus() {
      const response = await apiRequest(
        fetchImplementation,
        scriptUrl,
        "GET",
        apiToken,
        timeoutMs,
      );
      await discardBoundedBody(response, maximumResponseBytes);
      if (response.status === 200 || response.status === 404) {
        return response.status;
      }
      throw new Error(
        `Cloudflare probe lookup returned HTTP ${response.status}.`,
      );
    },

    async publicProbeStatus() {
      let response: Response;
      try {
        response = await fetchImplementation(publicProbeUrl, {
          method: "POST",
          headers: { accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error(
          "H05 public probe teardown check failed before a status was returned.",
        );
      }
      await discardBoundedBody(response, maximumResponseBytes);
      return httpStatus(response.status, "public probe status");
    },
  };
}

async function validateAccountAccess(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response, maximumResponseBytes);
  } catch (error) {
    if (error instanceof H05ResponseSizeError) throw error;
    throw new Error("Cloudflare Scripts account access response could not be read.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Cloudflare Scripts account access returned an invalid response.");
  }
  if (
    !isRecord(value) ||
    value.success !== true ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0 ||
    !Array.isArray(value.result)
  ) {
    throw new Error("Cloudflare Scripts account access returned an invalid response.");
  }
}

async function apiRequest(
  fetchImplementation: typeof fetch,
  url: URL,
  method: "DELETE" | "GET",
  apiToken: string,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImplementation(url, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`Cloudflare probe ${method.toLowerCase()} request failed.`);
  }
}

async function validateDeleteSuccess(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(response, maximumResponseBytes);
  } catch (error) {
    if (error instanceof H05ResponseSizeError) throw error;
    throw new Error("Cloudflare probe deletion response could not be read.");
  }
  if (bytes.byteLength === 0) return;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Cloudflare probe deletion returned an invalid response.");
  }
  if (
    !isRecord(value) ||
    value.success !== true ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0
  ) {
    throw new Error("Cloudflare probe deletion returned an invalid response.");
  }
}

async function discardBoundedBody(
  response: Response,
  maximumResponseBytes: number,
): Promise<void> {
  try {
    await readBoundedBody(response, maximumResponseBytes);
  } catch {
    // Only the status is evidence. Never retain or surface provider/public bodies.
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
          // Preserve the bounded-size failure and omit stream details.
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
    super("Cloudflare response exceeded the H05 teardown size limit.");
    this.name = "H05ResponseSizeError";
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
    throw new Error("FLAREX_H05_TEARDOWN_API_TOKEN is invalid.");
  }
  return value;
}

function proofRunId(value: string): H05ProofRunId {
  const decoded = decodeH05ProofRunId(value);
  if (!decoded.ok) throw new Error(decoded.message);
  return decoded.value;
}

function workersDevOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("H05 probe public origin is invalid.");
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
    throw new Error("H05 probe public origin is invalid.");
  }
  return url.origin;
}

function httpStatus(value: number, path: string): number {
  if (!isPositiveSafeInteger(value) || value < 100 || value > 599) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
