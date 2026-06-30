import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  forceReconnectEffect,
  SchedulerForceReconnectRequestError,
  schedulerForceReconnectBoundaryErrorToHttpError,
  type SchedulerForceReconnectFetch,
} from "../src/scheduler/ForceReconnectBoundary";
import { SchedulerConnectionTargetError } from "../src/scheduler/RuntimeError";

describe("scheduler force reconnect boundary", () => {
  it("decodes successful force-reconnect responses", async () => {
    const requests: Parameters<SchedulerForceReconnectFetch>[0][] = [];
    const fetchReconnect: SchedulerForceReconnectFetch = async input => {
      requests.push(input);
      return Response.json({ closed: 2 });
    };

    await expect(Effect.runPromise(forceReconnectEffect(fetchReconnect, {
      connectionId: "connection:deployment-a:session-a",
      reason: "test reconnect",
    }))).resolves.toEqual({
      ok: true,
      status: 200,
      error: "",
      closed: 2,
    });

    expect(requests).toEqual([{
      connectionId: "connection:deployment-a:session-a",
      reason: "test reconnect",
    }]);
  });

  it("returns non-OK reconnect responses for per-connection aggregation", async () => {
    await expect(Effect.runPromise(forceReconnectEffect(
      async () => new Response("connection unavailable", { status: 503 }),
      {
        connectionId: "connection:deployment-a:session-a",
        reason: "test reconnect",
      },
    ))).resolves.toEqual({
      ok: false,
      status: 503,
      error: "connection unavailable",
      closed: 0,
    });
  });

  it("keeps invalid connection targets as typed scheduler runtime failures", async () => {
    const failure = await Effect.runPromise(Effect.flip(forceReconnectEffect(
      async () => Response.json({ closed: 1 }),
      {
        connectionId: "invalid-connection",
        reason: "test reconnect",
      },
    )));

    expect(failure).toBeInstanceOf(SchedulerConnectionTargetError);
    expect(failure).toMatchObject({
      _tag: "SchedulerConnectionTargetError",
      connectionId: "invalid-connection",
      message: "Invalid live query connection id invalid-connection.",
    });
    expect(schedulerForceReconnectBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "Invalid live query connection id invalid-connection.",
    });
  });

  it("maps request failures without throwing from the boundary", async () => {
    const failure = await Effect.runPromise(Effect.flip(forceReconnectEffect(
      async () => {
        throw new Error("connection object unavailable");
      },
      {
        connectionId: "connection:deployment-a:session-a",
        reason: "test reconnect",
      },
    )));

    expect(failure).toBeInstanceOf(SchedulerForceReconnectRequestError);
    expect(failure).toMatchObject({
      _tag: "SchedulerForceReconnectRequestError",
      connectionId: "connection:deployment-a:session-a",
      message: "connection object unavailable",
    });
    expect(schedulerForceReconnectBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 500,
      message: "connection object unavailable",
    });
  });

  it("keeps malformed success payloads typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(forceReconnectEffect(
      async () => Response.json({ closed: -1 }),
      {
        connectionId: "connection:deployment-a:session-a",
        reason: "test reconnect",
      },
    )));

    expect(failure).toMatchObject({
      _tag: "SchedulerResponsePayloadError",
      operation: "forceReconnect",
      status: 502,
      message: "forceReconnect.closed must be a non-negative integer.",
    });
    expect(schedulerForceReconnectBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "forceReconnect.closed must be a non-negative integer.",
    });
  });
});
