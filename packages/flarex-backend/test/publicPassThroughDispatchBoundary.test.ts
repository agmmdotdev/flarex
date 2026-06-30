import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  dispatchDeploymentSchedulerEffect,
  dispatchRegistryDeploymentsEffect,
  readDeploymentActiveEffect,
  type PublicWorkerPassThroughTarget,
  syncPublicConnectionEffect,
} from "../src/worker/PublicPassThroughDispatchBoundary";

describe("public Worker pass-through dispatch boundary", () => {
  it("dispatches registry deployments through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const request = new Request("https://flarex.test/deployments");
    const forwarded = Response.json({ deployments: [] });

    const response = await Effect.runPromise(dispatchRegistryDeploymentsEffect(
      target(requests, async () => forwarded),
      request,
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{ input: request, init: undefined }]);

    const failure = await Effect.runPromise(Effect.flip(dispatchRegistryDeploymentsEffect(
      failingTarget("registry unavailable"),
      request,
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "registry-deployments",
      status: 500,
      message: "registry unavailable",
    });
  });

  it("dispatches active deployment reads through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ activePushId: "push-a" });

    const response = await Effect.runPromise(readDeploymentActiveEffect(
      target(requests, async () => forwarded),
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/deployment",
      init: undefined,
    }]);

    const failure = await Effect.runPromise(Effect.flip(readDeploymentActiveEffect(
      failingTarget("deployment unavailable"),
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-active-read",
      status: 500,
      message: "deployment unavailable",
    });
  });

  it("dispatches connection sync with public routing headers", async () => {
    const requests: DispatchedRequest[] = [];
    const request = new Request("https://flarex.test/deployments/deployment-a/sync", {
      headers: { "x-client": "client-a" },
    });
    const forwarded = Response.json({ synced: true });

    const response = await Effect.runPromise(syncPublicConnectionEffect(
      target(requests, async () => forwarded),
      request,
      "deployment-a",
      "connection:deployment-a:session-a",
    ));

    expect(response).toBe(forwarded);
    expect(requests).toHaveLength(1);
    const forwardedRequest = requests[0]?.input;
    expect(forwardedRequest).toBeInstanceOf(Request);
    expect((forwardedRequest as Request).headers.get("x-client")).toBe("client-a");
    expect((forwardedRequest as Request).headers.get("x-flarex-deployment")).toBe("deployment-a");
    expect((forwardedRequest as Request).headers.get("x-flarex-connection"))
      .toBe("connection:deployment-a:session-a");

    const failure = await Effect.runPromise(Effect.flip(syncPublicConnectionEffect(
      failingTarget("connection unavailable"),
      request,
      "deployment-a",
      "connection:deployment-a:session-a",
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "connection-sync",
      status: 500,
      message: "connection unavailable",
    });
  });

  it("dispatches deployment scheduler requests through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const request = new Request("https://flarex.test/deployments/deployment-a/scheduler");
    const forwarded = Response.json({ scheduled: true });

    const response = await Effect.runPromise(dispatchDeploymentSchedulerEffect(
      target(requests, async () => forwarded),
      request,
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{ input: request, init: undefined }]);

    const failure = await Effect.runPromise(Effect.flip(dispatchDeploymentSchedulerEffect(
      failingTarget("scheduler unavailable"),
      request,
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "deployment-scheduler",
      status: 500,
      message: "scheduler unavailable",
    });
  });
});

type DispatchedRequest = {
  readonly input: Request | string;
  readonly init: RequestInit | undefined;
};

function target(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicWorkerPassThroughTarget {
  return {
    fetch: async (input, init) => {
      requests.push({ input, init });
      return respond();
    },
  };
}

function failingTarget(message: string): PublicWorkerPassThroughTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}
