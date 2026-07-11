import { describe, expect, it } from "vitest";

import {
  createH05ProbeWorker,
  h05ProbeEndpoint,
  h05ProbeHop,
  type H05ProbeEnv,
  type H05ProbeExecutorBinding,
} from "./h05ProbeWorker";
import {
  decodeH05ProofRunId,
  h05ProofIdentity,
} from "./h05ProofIdentity";

const probeToken = "h05-probe-secret";
const executorToken = "h05-executor-secret";
const decodedRunId = decodeH05ProofRunId("run_a");
if (!decodedRunId.ok) {
  throw new Error(`Invalid H05 probe test run ID: ${decodedRunId.message}`);
}
const runId = decodedRunId.value;
const identity = h05ProofIdentity(decodedRunId.value);

describe("hosted H05 executor proof probe", () => {
  it.each([
    [
      "probe token",
      {
        FLAREX_EXECUTOR_TOKEN: executorToken,
        FLAREX_EXECUTOR: fakeExecutor(),
        FLAREX_H05_RUN_ID: runId,
      },
      "FLAREX_H05_PROBE_TOKEN is required.",
    ],
    [
      "executor token",
      {
        FLAREX_H05_PROBE_TOKEN: probeToken,
        FLAREX_EXECUTOR: fakeExecutor(),
        FLAREX_H05_RUN_ID: runId,
      },
      "FLAREX_EXECUTOR_TOKEN is required.",
    ],
    [
      "executor binding",
      {
        FLAREX_H05_PROBE_TOKEN: probeToken,
        FLAREX_EXECUTOR_TOKEN: executorToken,
        FLAREX_H05_RUN_ID: runId,
      },
      "FLAREX_EXECUTOR service binding is required.",
    ],
    [
      "run ID",
      {
        FLAREX_H05_PROBE_TOKEN: probeToken,
        FLAREX_EXECUTOR_TOKEN: executorToken,
        FLAREX_EXECUTOR: fakeExecutor(),
      },
      "FLAREX_H05_RUN_ID is required.",
    ],
  ] satisfies readonly [string, H05ProbeEnv, string][])(
    "fails closed when the %s is missing",
    async (_, env, message) => {
      const response = await createH05ProbeWorker().fetch(
        probeRequest({ path: "/invoke/start", body: {} }),
        env,
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "probe_misconfigured",
        message,
      });
    },
  );

  it("rejects one token reused across both capability boundaries", async () => {
    const sharedToken = "shared-secret";
    const response = await createH05ProbeWorker().fetch(
      probeRequest({ path: "/invoke/start", body: proofBody() }),
      {
        FLAREX_EXECUTOR: fakeExecutor(),
        FLAREX_EXECUTOR_TOKEN: sharedToken,
        FLAREX_H05_PROBE_TOKEN: sharedToken,
        FLAREX_H05_RUN_ID: runId,
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "probe_misconfigured",
      message: "FLAREX_H05_PROBE_TOKEN must differ from FLAREX_EXECUTOR_TOKEN.",
    });
  });

  it("rejects a caller without the exact probe capability", async () => {
    const calls: CapturedExecutorRequest[] = [];
    const response = await createH05ProbeWorker().fetch(
      probeRequest(
        { path: "/invoke/start", body: {} },
        { authorization: "Bearer wrong-secret" },
      ),
      validEnv(calls),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized H05 executor probe request.",
    });
    expect(calls).toEqual([]);
  });

  it("exposes only the exact authenticated proof endpoint", async () => {
    const worker = createH05ProbeWorker();
    const env = validEnv([]);

    const missing = await worker.fetch(
      new Request("https://probe.test/not-a-proof-route", {
        headers: probeAuthorization(),
      }),
      env,
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "not_found",
      message: "No H05 executor probe route for GET /not-a-proof-route",
    });

    const wrongMethod = await worker.fetch(
      new Request(`https://probe.test${h05ProbeEndpoint}`, {
        method: "PUT",
        headers: probeAuthorization(),
      }),
      env,
    );
    expect(wrongMethod.status).toBe(405);
    await expect(wrongMethod.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: `${h05ProbeEndpoint} only supports POST`,
    });
  });

  it.each([
    ["malformed JSON", "{", "Request body must be valid JSON."],
    ["non-object JSON", "[]", "Request body must be an object."],
    [
      "unsupported path",
      JSON.stringify({ path: "/invoke/prepare", body: {} }),
      "path must be /invoke/start, /invoke/syscall, /invoke/finish, or /invoke/abort.",
    ],
    [
      "missing body",
      JSON.stringify({ path: "/invoke/start" }),
      "body is required.",
    ],
    [
      "non-object body",
      JSON.stringify({ path: "/invoke/start", body: null }),
      "body must be an object.",
    ],
    [
      "another deployment",
      JSON.stringify({
        path: "/invoke/start",
        body: proofBody({ deploymentId: "deployment_not_h05" }),
      }),
      "body must target the probe's configured H05 run.",
    ],
    [
      "another project",
      JSON.stringify({
        path: "/invoke/start",
        body: proofBody({ projectId: "project_not_h05" }),
      }),
      "body must target the probe's configured H05 run.",
    ],
  ])("rejects %s before calling the executor", async (_, body, message) => {
    const calls: CapturedExecutorRequest[] = [];
    const response = await createH05ProbeWorker().fetch(
      new Request(`https://probe.test${h05ProbeEndpoint}`, {
        method: "POST",
        headers: {
          ...probeAuthorization(),
          "content-type": "application/json",
        },
        body,
      }),
      validEnv(calls),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message,
    });
    expect(calls).toEqual([]);
  });

  it("forwards only an allowlisted body with the executor capability", async () => {
    const calls: CapturedExecutorRequest[] = [];
    const response = await createH05ProbeWorker().fetch(
      probeRequest(
        {
          path: "/invoke/syscall",
          body: proofBody({ op: "get", id: "1:team" }),
        },
        {
          authorization: `Bearer ${probeToken}`,
          "x-untrusted-authorization": "Bearer attacker-controlled",
        },
      ),
      validEnv(calls, () =>
        Response.json({ value: { _id: "1:team" } }, { status: 409 }),
      ),
    );

    expect(calls).toHaveLength(1);
    const forwarded = calls[0];
    expect(forwarded).toBeDefined();
    if (forwarded === undefined) {
      throw new Error("Expected one captured executor request.");
    }
    expect(forwarded.url).toBe(
      "https://flarex-executor.internal/invoke/syscall",
    );
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("authorization")).toBe(
      `Bearer ${executorToken}`,
    );
    expect(forwarded.headers.has("x-untrusted-authorization")).toBe(false);
    expect(forwarded.body).toEqual({
      deploymentId: identity.deploymentId,
      projectId: identity.projectId,
      op: "get",
      id: "1:team",
    });
    expect(response.status).toBe(409);
    expect(response.headers.get(h05ProbeHop.header)).toBe(h05ProbeHop.value);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      value: { _id: "1:team" },
    });
  });

  it("maps a failed service-binding call to a redacted gateway error", async () => {
    const executor = {
      fetch: () => Promise.reject(new Error("sensitive binding failure")),
    } satisfies H05ProbeExecutorBinding;
    const response = await createH05ProbeWorker().fetch(
      probeRequest({
        path: "/invoke/abort",
        body: proofBody({ sessionId: "session_h05" }),
      }),
      {
        FLAREX_EXECUTOR: executor,
        FLAREX_EXECUTOR_TOKEN: executorToken,
        FLAREX_H05_PROBE_TOKEN: probeToken,
        FLAREX_H05_RUN_ID: runId,
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "executor_binding_failed",
      message: "H05 probe could not reach the private executor binding.",
    });
  });
});

function validEnv(
  calls: CapturedExecutorRequest[],
  respond: (request: Request) => Promise<Response> | Response = () =>
    Response.json({ ok: true }),
): H05ProbeEnv {
  return {
    FLAREX_EXECUTOR_TOKEN: executorToken,
    FLAREX_H05_PROBE_TOKEN: probeToken,
    FLAREX_H05_RUN_ID: runId,
    FLAREX_EXECUTOR: fakeExecutor(calls, respond),
  };
}

function fakeExecutor(
  calls: CapturedExecutorRequest[] = [],
  respond: (request: Request) => Promise<Response> | Response = () =>
    Response.json({ ok: true }),
): H05ProbeExecutorBinding {
  return {
    async fetch(request) {
      const body: unknown = await request.clone().json();
      calls.push({
        url: request.url,
        method: request.method,
        headers: new Headers(request.headers),
        body,
      });
      return await respond(request);
    },
  };
}

interface CapturedExecutorRequest {
  readonly body: unknown;
  readonly headers: Headers;
  readonly method: string;
  readonly url: string;
}

function probeRequest(
  body: unknown,
  headers: Record<string, string> = probeAuthorization(),
): Request {
  return new Request(`https://probe.test${h05ProbeEndpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function probeAuthorization(): Record<string, string> {
  return { authorization: `Bearer ${probeToken}` };
}

function proofBody(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    deploymentId: identity.deploymentId,
    projectId: identity.projectId,
    ...overrides,
  };
}
