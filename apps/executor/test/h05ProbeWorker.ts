import {
  decodeH05ProofRunId,
  h05ProofIdentity,
  type H05ProofIdentity,
} from "./h05ProofIdentity";

export interface H05ProbeExecutorBinding {
  fetch(request: Request): Promise<Response>;
}

export interface H05ProbeEnv {
  readonly FLAREX_EXECUTOR?: H05ProbeExecutorBinding;
  readonly FLAREX_EXECUTOR_TOKEN?: string;
  readonly FLAREX_H05_PROBE_TOKEN?: string;
  readonly FLAREX_H05_RUN_ID?: string;
}

export interface H05ProbeWorker {
  fetch(request: Request, env: H05ProbeEnv): Promise<Response>;
}

export const h05ProbeEndpoint = "/__flarex_h05/invoke";
export const h05ProbeHop = {
  header: "x-flarex-h05-hop",
  value: "probe-to-executor",
} as const;

const h05AllowedInvokePaths = {
  abort: "/invoke/abort",
  finish: "/invoke/finish",
  start: "/invoke/start",
  syscall: "/invoke/syscall",
} as const;

type H05AllowedInvokePath =
  typeof h05AllowedInvokePaths[keyof typeof h05AllowedInvokePaths];

interface H05ProbeEnvelope {
  readonly path: H05AllowedInvokePath;
  readonly body: Record<string, unknown>;
}

type H05ProbeEnvelopeDecode =
  | { readonly ok: true; readonly value: H05ProbeEnvelope }
  | {
      readonly ok: false;
      readonly message: string;
    };

interface H05ProbeConfiguration {
  readonly executor: H05ProbeExecutorBinding;
  readonly executorToken: string;
  readonly identity: H05ProofIdentity;
  readonly probeToken: string;
}

type H05ProbeConfigurationDecode =
  | { readonly ok: true; readonly value: H05ProbeConfiguration }
  | { readonly ok: false; readonly message: string };

export function createH05ProbeWorker(): H05ProbeWorker {
  return {
    async fetch(request, env) {
      const configuration = decodeProbeConfiguration(env);
      if (!configuration.ok) {
        return probeJson(
          { error: "probe_misconfigured", message: configuration.message },
          500,
        );
      }
      const { executor, executorToken, identity, probeToken } =
        configuration.value;

      if (!(await hasExactBearerCapability(request, probeToken))) {
        return probeJson(
          {
            error: "unauthorized",
            message: "Unauthorized H05 executor probe request.",
          },
          401,
        );
      }

      const pathname = new URL(request.url).pathname;
      if (pathname !== h05ProbeEndpoint) {
        return probeJson(
          {
            error: "not_found",
            message: `No H05 executor probe route for ${request.method} ${pathname}`,
          },
          404,
        );
      }
      if (request.method !== "POST") {
        return probeJson(
          {
            error: "method_not_allowed",
            message: `${h05ProbeEndpoint} only supports POST`,
          },
          405,
        );
      }

      const decoded = await decodeProbeEnvelope(request, identity);
      if (!decoded.ok) {
        return probeJson(
          { error: "bad_request", message: decoded.message },
          400,
        );
      }

      let response: Response;
      try {
        response = await executor.fetch(
          new Request(
            `https://flarex-executor.internal${decoded.value.path}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${executorToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(decoded.value.body),
            },
          ),
        );
      } catch {
        return probeJson(
          {
            error: "executor_binding_failed",
            message: "H05 probe could not reach the private executor binding.",
          },
          502,
        );
      }

      const headers = new Headers(response.headers);
      headers.set(h05ProbeHop.header, h05ProbeHop.value);
      headers.set("cache-control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  };
}

async function decodeProbeEnvelope(
  request: Request,
  identity: H05ProofIdentity,
): Promise<H05ProbeEnvelopeDecode> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!isRecord(value)) {
    return { ok: false, message: "Request body must be an object." };
  }
  if (!isAllowedInvokePath(value.path)) {
    return {
      ok: false,
      message:
        "path must be /invoke/start, /invoke/syscall, /invoke/finish, or /invoke/abort.",
    };
  }
  if (!Object.hasOwn(value, "body")) {
    return { ok: false, message: "body is required." };
  }
  if (!isRecord(value.body)) {
    return { ok: false, message: "body must be an object." };
  }
  if (
    value.body.deploymentId !== identity.deploymentId ||
    value.body.projectId !== identity.projectId
  ) {
    return {
      ok: false,
      message: "body must target the probe's configured H05 run.",
    };
  }
  return { ok: true, value: { path: value.path, body: value.body } };
}

function decodeProbeConfiguration(
  env: H05ProbeEnv,
): H05ProbeConfigurationDecode {
  if (!isConfiguredSecret(env.FLAREX_H05_PROBE_TOKEN)) {
    return { ok: false, message: "FLAREX_H05_PROBE_TOKEN is required." };
  }
  if (!isConfiguredSecret(env.FLAREX_EXECUTOR_TOKEN)) {
    return { ok: false, message: "FLAREX_EXECUTOR_TOKEN is required." };
  }
  if (
    env.FLAREX_H05_PROBE_TOKEN !== env.FLAREX_H05_PROBE_TOKEN.trim() ||
    env.FLAREX_EXECUTOR_TOKEN !== env.FLAREX_EXECUTOR_TOKEN.trim()
  ) {
    return {
      ok: false,
      message: "H05 probe secrets must not contain surrounding whitespace.",
    };
  }
  if (env.FLAREX_H05_PROBE_TOKEN === env.FLAREX_EXECUTOR_TOKEN) {
    return {
      ok: false,
      message: "FLAREX_H05_PROBE_TOKEN must differ from FLAREX_EXECUTOR_TOKEN.",
    };
  }
  if (env.FLAREX_EXECUTOR === undefined) {
    return {
      ok: false,
      message: "FLAREX_EXECUTOR service binding is required.",
    };
  }
  const runId = decodeH05ProofRunId(env.FLAREX_H05_RUN_ID);
  if (!runId.ok) return runId;
  return {
    ok: true,
    value: {
      executor: env.FLAREX_EXECUTOR,
      executorToken: env.FLAREX_EXECUTOR_TOKEN,
      identity: h05ProofIdentity(runId.value),
      probeToken: env.FLAREX_H05_PROBE_TOKEN,
    },
  };
}

function isConfiguredSecret(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

async function hasExactBearerCapability(
  request: Request,
  token: string,
): Promise<boolean> {
  const presented = request.headers.get("authorization");
  if (presented === null) return false;
  const encoder = new TextEncoder();
  const [presentedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${token}`)),
  ]);
  const presentedBytes = new Uint8Array(presentedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  if (presentedBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    const presentedByte = presentedBytes[index];
    const expectedByte = expectedBytes[index];
    if (presentedByte === undefined || expectedByte === undefined) return false;
    difference |= presentedByte ^ expectedByte;
  }
  return difference === 0;
}

function probeJson(body: Record<string, string>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isAllowedInvokePath(value: unknown): value is H05AllowedInvokePath {
  return Object.values(h05AllowedInvokePaths).some((path) => path === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default createH05ProbeWorker() satisfies ExportedHandler<H05ProbeEnv>;
