import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSchedulerCleanupConnectionsResponse,
  decodeSchedulerPendingDeploymentsResponse,
  decodeSchedulerWakeDeliveryJsonResponse,
  schedulerResponseErrorToHttpError,
} from "../src/scheduler/Responses";

describe("scheduler response boundaries", () => {
  it("exposes typed scheduler response successes before payload parsing", async () => {
    await expect(
      Effect.runPromise(decodeSchedulerPendingDeploymentsResponse(Response.json({
        deployments: [],
        nextCursor: null,
        hasMore: false,
      }))),
    ).resolves.toEqual({
      deployments: [],
      nextCursor: null,
      hasMore: false,
    });

    await expect(
      Effect.runPromise(decodeSchedulerWakeDeliveryJsonResponse(Response.json({
        deploymentId: "deployment1",
        claimed: 0,
      }))),
    ).resolves.toEqual({
      deploymentId: "deployment1",
      claimed: 0,
    });
  });

  it("exposes typed scheduler response failures before HTTP mapping", async () => {
    await expect(
      Effect.runPromise(
        decodeSchedulerCleanupConnectionsResponse(new Response("unavailable", { status: 503 })),
      ),
    ).rejects.toMatchObject({
      _tag: "SchedulerResponseError",
      operation: "cleanupConnections",
      status: 503,
      message: "Live query connection cleanup failed with status 503.",
      body: null,
    });
  });

  it("maps scheduler response failures to the existing 502 adapter shape", async () => {
    await expect(
      Effect.runPromise(
        decodeSchedulerPendingDeploymentsResponse(new Response("unavailable", { status: 503 })).pipe(
          Effect.mapError(schedulerResponseErrorToHttpError),
        ),
      ),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 502,
      message: "Live query pending deployment scan failed with status 503.",
    });
  });
});
