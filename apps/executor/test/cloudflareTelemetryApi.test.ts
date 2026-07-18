import { describe, expect, it } from "vitest";

import {
  createH05CloudflareTelemetryApi,
  type H05TelemetryQueryRequest,
} from "../scripts/cloudflareTelemetryApi";

const apiToken = "telemetry-test-token";
const accountId = "a".repeat(32);

describe("bounded H05 Cloudflare telemetry API", () => {
  it("retains the Cloudflare telemetry token diagnostic", () => {
    expect(() =>
      createH05CloudflareTelemetryApi({ apiToken: " short " }),
    ).toThrow("FLAREX_H05_TELEMETRY_API_TOKEN is invalid.");
  });

  it("posts only to the fixed account telemetry endpoint with bearer auth", async () => {
    const requests: Array<{
      readonly body: string | undefined;
      readonly headers: Record<string, string>;
      readonly method: string | undefined;
      readonly url: string;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method,
        url: String(input),
      });
      return Response.json({ success: true, errors: [], result: { run: {} } });
    };
    const api = createH05CloudflareTelemetryApi({ apiToken, fetch: fetcher });
    const request = validRequest();

    await expect(api.query(accountId, request)).resolves.toEqual({ run: {} });
    expect(requests).toEqual([
      {
        body: JSON.stringify(request),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
      },
    ]);
  });

  it("rejects an invalid account before making a request", async () => {
    let calls = 0;
    const api = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () => {
        calls += 1;
        return Response.json({ success: true, errors: [], result: {} });
      },
    });

    await expect(api.query("../wrong", validRequest())).rejects.toThrow(
      "CLOUDFLARE_ACCOUNT_ID",
    );
    expect(calls).toBe(0);
  });

  it("redacts provider bodies and transport errors", async () => {
    const forbidden = "provider-secret-value";
    const httpApi = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () => new Response(forbidden, { status: 403 }),
    });
    const transportApi = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () => {
        throw new Error(forbidden);
      },
    });

    await expect(httpApi.query(accountId, validRequest())).rejects.toThrow(
      "HTTP 403",
    );
    await expect(httpApi.query(accountId, validRequest())).rejects.not.toThrow(
      forbidden,
    );
    await expect(transportApi.query(accountId, validRequest())).rejects.toThrow(
      "failed before a response",
    );
    await expect(
      transportApi.query(accountId, validRequest()),
    ).rejects.not.toThrow(forbidden);
  });

  it("bounds request and response bodies", async () => {
    let calls = 0;
    const requestApi = createH05CloudflareTelemetryApi({
      apiToken,
      maximumRequestBytes: 10,
      fetch: async () => {
        calls += 1;
        return Response.json({ success: true, errors: [], result: {} });
      },
    });
    const responseApi = createH05CloudflareTelemetryApi({
      apiToken,
      maximumResponseBytes: 32,
      fetch: async () =>
        new Response("x".repeat(33), {
          status: 200,
          headers: { "content-length": "33" },
        }),
    });

    await expect(requestApi.query(accountId, validRequest())).rejects.toThrow(
      "request size limit",
    );
    expect(calls).toBe(0);
    await expect(responseApi.query(accountId, validRequest())).rejects.toThrow(
      "response exceeded",
    );
  });

  it("rejects invalid JSON and malformed success envelopes without surfacing bodies", async () => {
    const invalidJson = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () => new Response("not-json", { status: 200 }),
    });
    const invalidUtf8 = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () =>
        new Response(Uint8Array.of(0xc3, 0x28), { status: 200 }),
    });
    const malformed = createH05CloudflareTelemetryApi({
      apiToken,
      fetch: async () =>
        Response.json({
          success: false,
          errors: [{ message: "provider-secret-value" }],
        }),
    });

    await expect(invalidJson.query(accountId, validRequest())).rejects.toThrow(
      "invalid JSON",
    );
    await expect(invalidUtf8.query(accountId, validRequest())).rejects.toThrow(
      "invalid JSON",
    );
    await expect(malformed.query(accountId, validRequest())).rejects.toThrow(
      "invalid envelope",
    );
    await expect(
      malformed.query(accountId, validRequest()),
    ).rejects.not.toThrow("provider-secret-value");
  });
});

function validRequest(): H05TelemetryQueryRequest {
  return {
    queryId: "flarex-h05-test-query",
    timeframe: { from: 1, to: 2 },
    dry: true,
    ignoreSeries: true,
    limit: 100,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: [
        {
          key: "$metadata.service",
          kind: "filter",
          operation: "eq",
          type: "string",
          value: "flarex-executor-h05-probe",
        },
      ],
    },
    view: "events",
  };
}
