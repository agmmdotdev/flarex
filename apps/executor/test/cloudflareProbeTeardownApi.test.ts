import { describe, expect, it } from "vitest";

import { createH05CloudflareProbeTeardownApi } from "../scripts/cloudflareProbeTeardownApi";

const accountId = "a".repeat(32);
const apiToken = "cloudflare-teardown-test-token";
const probePublicOrigin =
  "https://flarex-executor-h05-probe.example.workers.dev";
const scriptUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/flarex-executor-h05-probe`;
const scriptsAccessUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts?tags=flarex-h05-teardown-access-check-v1%3Ayes`;
const publicUrl = `${probePublicOrigin}/__flarex_h05/invoke/run_a`;

describe("fixed H05 Cloudflare probe teardown API", () => {
  it("deletes only the fixed probe without force and checks both absence surfaces", async () => {
    const requests: ObservedRequest[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(observedRequest(input, init));
      const method = init?.method;
      if (String(input) === scriptsAccessUrl) {
        return Response.json({ success: true, errors: [], result: [] });
      }
      if (method === "DELETE") {
        return Response.json({ success: true, errors: [], result: {} });
      }
      return new Response("discarded-provider-secret", { status: 404 });
    };
    const api = validApi(fetcher);

    await expect(api.verifyAccountAccess()).resolves.toBe(200);
    await expect(api.deleteProbe()).resolves.toEqual({
      outcome: "deleted",
      status: 200,
    });
    await expect(api.probeScriptStatus()).resolves.toBe(404);
    await expect(api.publicProbeStatus()).resolves.toBe(404);

    expect(requests).toEqual([
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
        method: "GET",
        redirect: "error",
        url: scriptsAccessUrl,
      },
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
        method: "DELETE",
        redirect: "error",
        url: scriptUrl,
      },
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
        method: "GET",
        redirect: "error",
        url: scriptUrl,
      },
      {
        headers: { accept: "application/json" },
        method: "POST",
        redirect: "manual",
        url: publicUrl,
      },
    ]);
    expect(requests[1]?.url).not.toContain("force");
  });

  it("rejects an all-404 token before teardown can be treated as a retry", async () => {
    const api = validApi(
      async () => new Response("hidden provider detail", { status: 404 }),
    );

    await expect(api.verifyAccountAccess()).rejects.toThrow(
      "Scripts account access check returned HTTP 404",
    );
    await expect(api.verifyAccountAccess()).rejects.not.toThrow(
      "hidden provider detail",
    );
  });

  it("accepts the documented empty success body and an idempotent 404 retry", async () => {
    const empty = validApi(async () => new Response(null, { status: 200 }));
    await expect(empty.deleteProbe()).resolves.toEqual({
      outcome: "deleted",
      status: 200,
    });

    const absent = validApi(
      async () => new Response("private provider detail", { status: 404 }),
    );
    await expect(absent.deleteProbe()).resolves.toEqual({
      outcome: "already-absent",
      status: 404,
    });
  });

  it("fails closed on malformed successful deletion envelopes", async () => {
    const invalidJson = validApi(
      async () => new Response("not-json", { status: 200 }),
    );
    await expect(invalidJson.deleteProbe()).rejects.toThrow(
      "deletion returned an invalid response",
    );

    const invalidUtf8Deletion = validApi(
      async () =>
        new Response(Uint8Array.of(0xc3, 0x28), { status: 200 }),
    );
    await expect(invalidUtf8Deletion.deleteProbe()).rejects.toThrow(
      "deletion returned an invalid response",
    );

    const invalidUtf8AccountAccess = validApi(
      async () =>
        new Response(Uint8Array.of(0xc3, 0x28), { status: 200 }),
    );
    await expect(
      invalidUtf8AccountAccess.verifyAccountAccess(),
    ).rejects.toThrow(
      "Scripts account access returned an invalid response",
    );

    const unsuccessful = validApi(
      async () =>
        Response.json({
          success: false,
          errors: [{ message: "secret-provider-detail" }],
        }),
    );
    await expect(unsuccessful.deleteProbe()).rejects.toThrow(
      "deletion returned an invalid response",
    );
    await expect(unsuccessful.deleteProbe()).rejects.not.toThrow(
      "secret-provider-detail",
    );
  });

  it("bounds successful bodies and redacts provider and transport failures", async () => {
    const oversized = validApi(
      async () =>
        new Response("x".repeat(65), {
          status: 200,
          headers: { "content-length": "65" },
        }),
      64,
    );
    await expect(oversized.deleteProbe()).rejects.toThrow(
      "exceeded the H05 teardown size limit",
    );

    const forbidden = "secret-provider-detail";
    const httpFailure = validApi(
      async () => new Response(forbidden, { status: 403 }),
    );
    await expect(httpFailure.deleteProbe()).rejects.toThrow(
      "deletion returned HTTP 403",
    );
    await expect(httpFailure.deleteProbe()).rejects.not.toThrow(forbidden);

    const transportFailure = validApi(async () => {
      throw new Error(forbidden);
    });
    await expect(transportFailure.probeScriptStatus()).rejects.toThrow(
      "Cloudflare probe get request failed",
    );
    await expect(transportFailure.probeScriptStatus()).rejects.not.toThrow(
      forbidden,
    );
  });

  it("returns a live public 401 as status-only evidence without authorization", async () => {
    const observedHeaders: Record<string, string>[] = [];
    const api = validApi(async (_input, init) => {
      observedHeaders.push(
        Object.fromEntries(new Headers(init?.headers).entries()),
      );
      return new Response("private body", { status: 401 });
    });

    await expect(api.publicProbeStatus()).resolves.toBe(401);
    expect(observedHeaders).toEqual([{ accept: "application/json" }]);
  });

  it("rejects unsafe configuration before issuing a request", () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    };

    expect(() =>
      createH05CloudflareProbeTeardownApi({
        accountId: "wrong-account",
        apiToken,
        fetch: fetcher,
        probePublicOrigin,
        runId: "run_a",
      }),
    ).toThrow("CLOUDFLARE_ACCOUNT_ID");
    expect(() =>
      createH05CloudflareProbeTeardownApi({
        accountId,
        apiToken: " short ",
        fetch: fetcher,
        probePublicOrigin,
        runId: "run_a",
      }),
    ).toThrow("FLAREX_H05_TEARDOWN_API_TOKEN is invalid.");
    expect(() =>
      createH05CloudflareProbeTeardownApi({
        accountId,
        apiToken,
        fetch: fetcher,
        probePublicOrigin: "https://attacker.example.test",
        runId: "run_a",
      }),
    ).toThrow("public origin is invalid");
    expect(() =>
      createH05CloudflareProbeTeardownApi({
        accountId,
        apiToken,
        fetch: fetcher,
        probePublicOrigin,
        runId: "other/run",
      }),
    ).toThrow("FLAREX_H05_RUN_ID");
    expect(calls).toBe(0);
  });
});

interface ObservedRequest {
  readonly headers: Record<string, string>;
  readonly method: string | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly url: string;
}

function validApi(fetcher: typeof fetch, maximumResponseBytes?: number) {
  return createH05CloudflareProbeTeardownApi({
    accountId,
    apiToken,
    fetch: fetcher,
    ...(maximumResponseBytes === undefined ? {} : { maximumResponseBytes }),
    probePublicOrigin,
    runId: "run_a",
  });
}

function observedRequest(
  input: URL | RequestInfo,
  init: RequestInit | undefined,
): ObservedRequest {
  return {
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
    method: init?.method,
    redirect: init?.redirect,
    url: String(input),
  };
}
