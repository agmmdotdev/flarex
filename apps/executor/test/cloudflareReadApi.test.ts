import { describe, expect, it } from "vitest";

import { createH05CloudflareReadApi } from "../scripts/cloudflareReadApi";

const apiToken = "cloudflare-test-token";

describe("bounded H05 Cloudflare read API", () => {
  it("retains the Cloudflare read token diagnostic", () => {
    expect(() => createH05CloudflareReadApi({ apiToken: " short " })).toThrow(
      "CLOUDFLARE_API_TOKEN is invalid.",
    );
  });

  it("uses the fixed API origin, canonical query order, and bearer auth", async () => {
    const requests: Array<{
      readonly headers: Record<string, string>;
      readonly method: string | undefined;
      readonly url: string;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return Response.json({
        success: true,
        errors: [],
        result: { id: "result-id" },
        result_info: { page: 1 },
      });
    };
    const api = createH05CloudflareReadApi({ apiToken, fetch: fetcher });

    await expect(
      api.get("/accounts/account/workers/scripts/worker", { z: 2, a: "one" }),
    ).resolves.toEqual({
      result: { id: "result-id" },
      resultInfo: { page: 1 },
    });
    expect(requests).toEqual([
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account/workers/scripts/worker?a=one&z=2",
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
        },
      },
    ]);
  });

  it("never sends API authorization to a validated workers.dev origin", async () => {
    const observedHeaders: Record<string, string>[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      observedHeaders.push(
        Object.fromEntries(new Headers(init?.headers).entries()),
      );
      return new Response("discarded private body", { status: 404 });
    };
    const api = createH05CloudflareReadApi({ apiToken, fetch: fetcher });

    await expect(
      api.publicStatus("https://flarex-executor.example.workers.dev"),
    ).resolves.toBe(404);
    expect(observedHeaders).toEqual([{ accept: "application/json" }]);
  });

  it("redacts provider bodies and transport errors", async () => {
    const forbidden = "provider-secret-value";
    const httpApi = createH05CloudflareReadApi({
      apiToken,
      fetch: async () =>
        new Response(forbidden, {
          status: 403,
          headers: { "content-length": String(forbidden.length) },
        }),
    });
    const transportApi = createH05CloudflareReadApi({
      apiToken,
      fetch: async () => {
        throw new Error(forbidden);
      },
    });

    await expect(httpApi.get("/accounts/account/secrets")).rejects.toThrow(
      "Cloudflare API read returned HTTP 403 for /accounts/account/secrets.",
    );
    await expect(httpApi.get("/accounts/account/secrets")).rejects.not.toThrow(
      forbidden,
    );
    await expect(
      transportApi.get("/accounts/account/secrets"),
    ).rejects.toThrow(
      "Cloudflare API read failed for /accounts/account/secrets.",
    );
  });

  it("rejects malformed success envelopes without surfacing error details", async () => {
    const providerDetail = "secret response diagnostic";
    const api = createH05CloudflareReadApi({
      apiToken,
      fetch: async () =>
        Response.json({
          success: false,
          errors: [{ message: providerDetail }],
          result: null,
        }),
    });

    await expect(api.get("/accounts/account/workers")).rejects.toThrow(
      "Cloudflare API returned an invalid envelope for /accounts/account/workers.",
    );
    await expect(api.get("/accounts/account/workers")).rejects.not.toThrow(
      providerDetail,
    );
  });

  it("rejects malformed UTF-8 through the redacted JSON boundary", async () => {
    const api = createH05CloudflareReadApi({
      apiToken,
      fetch: async () =>
        new Response(Uint8Array.of(0xc3, 0x28), { status: 200 }),
    });

    await expect(api.get("/accounts/account/workers")).rejects.toThrow(
      "Cloudflare API returned invalid JSON for /accounts/account/workers.",
    );
  });

  it("stops reading an unbounded response stream", async () => {
    const marker = "LEAK_FROM_CANCEL";
    const api = createH05CloudflareReadApi({
      apiToken,
      maximumResponseBytes: 32,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(64)));
            },
            cancel() {
              throw new Error(marker);
            },
          }),
          { status: 200 },
        ),
    });

    await expect(api.get("/accounts/account/workers")).rejects.toThrow(
      "Cloudflare response exceeded the H05 evidence size limit.",
    );
    await expect(api.get("/accounts/account/workers")).rejects.not.toThrow(
      marker,
    );
  });

  it("redacts successful-response stream errors", async () => {
    const marker = "LEAK_FROM_STREAM";
    const api = createH05CloudflareReadApi({
      apiToken,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error(marker));
            },
          }),
          { status: 200 },
        ),
    });
    const failure = api.get("/accounts/account/workers");

    await expect(failure).rejects.toThrow(
      "Cloudflare API response body could not be read for /accounts/account/workers.",
    );
    await expect(failure).rejects.not.toThrow(marker);
  });

  it("rejects unsafe paths and non-workers.dev public origins before fetch", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json({ success: true, errors: [], result: {} });
    };
    const api = createH05CloudflareReadApi({ apiToken, fetch: fetcher });

    await expect(api.get("https://attacker.example/path")).rejects.toThrow(
      "Cloudflare API path is invalid.",
    );
    await expect(
      api.publicStatus("https://flarex-executor.example.test"),
    ).rejects.toThrow("H05 direct public Worker origin is invalid.");
    expect(calls).toBe(0);
  });
});
