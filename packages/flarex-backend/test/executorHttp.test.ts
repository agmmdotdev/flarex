import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchExecutorJson } from "../src/executorHttp";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchExecutorJson", () => {
  it("posts authenticated JSON through the configured service binding", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Global fetch must not run when the binding is configured."),
    );
    const requests: Request[] = [];
    const expectedResponse = Response.json({ ok: true });

    const response = await fetchExecutorJson(
      {
        FLAREX_EXECUTOR: {
          async fetch(request) {
            requests.push(request);
            return expectedResponse;
          },
        },
        FLAREX_EXECUTOR_URL:
          "https://executor.example/root/?ignored=yes#ignored",
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
      },
      "/maintenance/live-queries/claim",
      { deploymentId: "deployment-a" },
    );

    expect(response).toBe(expectedResponse);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (request === undefined) throw new Error("Expected an executor request.");
    expect(request.url).toBe(
      "https://executor.example/root/maintenance/live-queries/claim",
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("authorization")).toBe(
      "Bearer executor-secret",
    );
    await expect(request.json()).resolves.toEqual({
      deploymentId: "deployment-a",
    });
  });

  it("uses unauthenticated global fetch when no binding is configured", async () => {
    const expectedResponse = Response.json({ ok: true });
    const globalFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      expectedResponse,
    );

    const response = await fetchExecutorJson(
      {},
      "/maintenance/live-queries/rerun",
      { deploymentId: "deployment-b" },
    );

    expect(response).toBe(expectedResponse);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const input = globalFetch.mock.calls[0]?.[0];
    expect(input).toBeInstanceOf(Request);
    if (!(input instanceof Request)) throw new Error("Expected a Request.");
    expect(input.url).toBe(
      "https://flarex-executor.internal/maintenance/live-queries/rerun",
    );
    expect(input.headers.get("authorization")).toBeNull();
    await expect(input.json()).resolves.toEqual({
      deploymentId: "deployment-b",
    });
  });
});
