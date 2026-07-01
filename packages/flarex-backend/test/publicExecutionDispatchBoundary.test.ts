import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  dispatchExecutionEffect,
  dispatchPublicExecutionActionEffect,
  type PublicExecutionDispatchTarget,
  startPublicExecutionEffect,
} from "../src/execution/PublicDispatchBoundary";
import type { ExecutionStartRequest } from "../src/types";

describe("public execution dispatch boundary", () => {
  it("dispatches public execution start requests and wraps successful responses with the session id", async () => {
    const requests: DispatchedRequest[] = [];
    const execution = executionTarget(requests, async () => Response.json({
      state: "running",
      startedAt: 1_000,
    }));

    const response = await Effect.runPromise(startPublicExecutionEffect(
      execution,
      executionStartRequest(),
      "session-a",
    ));

    expect(requests).toEqual([{
      input: "https://flarex.internal/start",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(executionStartRequest()),
    }]);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session-a",
      state: "running",
      startedAt: 1_000,
    });
  });

  it("returns non-ok execution start responses without rewriting the body", async () => {
    const rejected = Response.json({ error: "Execution rejected." }, { status: 409 });
    const response = await Effect.runPromise(startPublicExecutionEffect(
      executionTarget([], async () => rejected),
      executionStartRequest(),
      "session-rejected",
    ));

    expect(response).toBe(rejected);
    await expect(response.json()).resolves.toEqual({ error: "Execution rejected." });
  });

  it("keeps execution start dispatch and response JSON failures in typed worker error channels", async () => {
    const dispatchFailure = await Effect.runPromise(Effect.flip(startPublicExecutionEffect(
      failingExecutionTarget("execution unavailable"),
      executionStartRequest(),
      "session-a",
    )));
    expect(dispatchFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "execution-start",
      status: 500,
      message: "execution unavailable",
    });

    const jsonFailure = await Effect.runPromise(Effect.flip(startPublicExecutionEffect(
      executionTarget([], async () => new Response("{", { status: 200 })),
      executionStartRequest(),
      "session-a",
    )));
    expect(jsonFailure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "execution-start-response",
      status: 500,
    });
  });

  it("dispatches public execution actions through the typed worker error channel", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ ok: true });
    const response = await Effect.runPromise(dispatchPublicExecutionActionEffect(
      executionTarget(requests, async () => forwarded),
      "syscall",
      { op: "get", id: "1:progress" },
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/syscall",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ op: "get", id: "1:progress" }),
    }]);

    const failure = await Effect.runPromise(Effect.flip(dispatchPublicExecutionActionEffect(
      failingExecutionTarget("action unavailable"),
      "finish",
      { value: "done" },
    )));
    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "execution-action",
      status: 500,
      message: "action unavailable",
    });
  });

  it("runs the shared execution dispatch helper with operation-specific failure tagging", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ ok: true });

    const response = await Effect.runPromise(dispatchExecutionEffect(
      executionTarget(requests, async () => forwarded),
      "execution-action",
      "abort",
      { reason: "client cancel" },
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/abort",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ reason: "client cancel" }),
    }]);

    const failure = await Effect.runPromise(Effect.flip(dispatchExecutionEffect(
      failingExecutionTarget("shared execution unavailable"),
      "execution-start",
      "start",
      executionStartRequest(),
    )));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "execution-start",
      status: 500,
      message: "shared execution unavailable",
    });
  });
});

type DispatchedRequest = {
  readonly input: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: BodyInit | null | undefined;
};

function executionTarget(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicExecutionDispatchTarget {
  return {
    fetch: async (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body,
      });
      return respond();
    },
  };
}

function failingExecutionTarget(message: string): PublicExecutionDispatchTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}

function executionStartRequest(): ExecutionStartRequest {
  return {
    deploymentId: "deployment-a",
    path: "users:get",
    args: { id: "1:user" },
    partitionKey: "1:user",
    kind: "query",
  };
}
