import { Effect } from "effect";
import { executionIdentityFingerprint } from "flarex-protocol/auth";
import { describe, expect, it } from "vitest";
import {
  dispatchPublicLiveQueryDeliveryEffect,
} from "../src/liveQueryDelivery/PublicDispatchBoundary";
import type { LiveQueryDeliveryChange } from "../src/liveQueryDelivery";
import type { Env } from "../src/types";

const anonymousIdentityFingerprint = executionIdentityFingerprint({ kind: "anonymous" });

describe("public live query delivery dispatch boundary", () => {
  it("dispatches public live query deliveries to scoped connections", async () => {
    const requests: Array<{
      connectionId: string;
      input: string;
      init: RequestInit | undefined;
    }> = [];
    const env = liveQueryDispatchEnv(async (connectionId, input, init) => {
      requests.push({ connectionId, input, init });
      return Response.json({ delivered: 1, skipped: 0 });
    });

    await expect(Effect.runPromise(dispatchPublicLiveQueryDeliveryEffect(
      env,
      "deployment-a",
      [liveQueryDeliveryChange()],
    ))).resolves.toEqual({
      delivered: 1,
      skipped: 0,
      connections: 1,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.connectionId).toBe("connection:deployment-a:session-a");
    expect(requests[0]?.input).toBe("https://flarex.internal/deliver/live-query");
    expect(requests[0]?.init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      deliveries: [liveQueryDeliveryChange()],
    });
  });

  it("preserves target validation failures before dispatch mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(dispatchPublicLiveQueryDeliveryEffect(
      liveQueryDispatchEnv(async () => Response.json({ delivered: 0, skipped: 0 })),
      "deployment-a",
      [{
        ...liveQueryDeliveryChange(),
        deploymentId: "deployment-b",
      }],
    )));

    expect(failure).toMatchObject({
      _tag: "LiveQueryDeliveryTargetError",
      deploymentId: "deployment-a",
      deliveryDeploymentId: "deployment-b",
      connectionId: "connection:deployment-a:session-a",
    });
  });

  it("maps connection dispatch failures at the public dispatch source", async () => {
    const failure = await Effect.runPromise(Effect.flip(dispatchPublicLiveQueryDeliveryEffect(
      liveQueryDispatchEnv(async () => {
        throw new Error("connection unavailable");
      }),
      "deployment-a",
      [liveQueryDeliveryChange()],
    )));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "live-query-delivery",
      status: 500,
      message: "connection unavailable",
    });
  });
});

function liveQueryDeliveryChange(): LiveQueryDeliveryChange {
  return {
    kind: "updated",
    deploymentId: "deployment-a",
    connectionId: "connection:deployment-a:session-a",
    queryId: 1,
    functionPath: "users:get",
    argsJson: { id: "1" },
    identityFingerprint: anonymousIdentityFingerprint,
    resultJson: { name: "Ada" },
    previousResultHash: "previous",
    resultHash: "result",
  };
}

function liveQueryDispatchEnv(
  fetch: (connectionId: string, input: string, init?: RequestInit) => Promise<Response>,
): Env {
  return {
    CONNECTIONS: {
      getByName: (connectionId: string) => ({
        fetch: (input: string, init?: RequestInit) => fetch(connectionId, input, init),
      }),
    },
  } as unknown as Env;
}
