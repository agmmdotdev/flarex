import { afterAll, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import {
  createBackendHarness,
  type BackendHarness,
} from "./backendHarness";

describe("DeliveryDO", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("maps typed executor claim failures into the drain failure envelope", async () => {
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "delivery-do-claim-failure-deployment";
    const harness = await createBackendHarness({
      bindings: { FLAREX_EXECUTOR_TOKEN: "executor-secret" },
      serviceBindings: {
        FLAREX_EXECUTOR: async request => {
          const url = new URL(request.url);
          const body: unknown = await request.json();
          executorRequests.push({
            path: url.pathname,
            authorization: request.headers.get("authorization"),
            body,
          });
          if (url.pathname === "/maintenance/live-queries/claim") {
            return Response.json({ error: "temporary claim failure" }, { status: 503 });
          }
          return Response.json({ error: "not found" }, { status: 404 });
        },
      },
    });
    harnesses.push(harness);
    const env = await harness.mf.getBindings<Env>();
    const delivery = env.DELIVERIES.getByName(`delivery:${deploymentId}`);

    const response = await delivery.fetch("https://flarex.internal/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deploymentId,
        limit: 10,
        maxBatches: 2,
      }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      deploymentId,
      error: "Live query delivery claim failed with status 503.",
      failure: {
        stage: "claim",
        status: 502,
        error: "Live query delivery claim failed with status 503.",
      },
      summary: {
        batches: 0,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 0,
        hasMore: false,
        failure: {
          stage: "claim",
          status: 502,
          error: "Live query delivery claim failed with status 503.",
        },
      },
    });
    expect(executorRequests).toEqual([{
      path: "/maintenance/live-queries/claim",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        limit: 10,
        leaseDurationMs: 30_000,
        claimOwner: expect.stringMatching(/^delivery:delivery-do-claim-failure-deployment:/),
      },
    }]);
  });
});
