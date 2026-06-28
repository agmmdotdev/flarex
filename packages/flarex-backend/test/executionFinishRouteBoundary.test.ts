import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeExecutionFinishRouteRequest,
  parseExecutionFinishRouteRequest,
  parseExecutionFinishRouteRequestEffect,
  readExecutionFinishRequest,
} from "../src/execution/FinishRouteBoundary";

describe("execution finish route boundary", () => {
  it("decodes execution finish requests through the protocol parser", async () => {
    await expect(readExecutionFinishRequest(jsonRequest({
      value: { ok: true, ids: ["1:user", null] },
    }))).resolves.toEqual({
      value: { ok: true, ids: ["1:user", null] },
    });
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(jsonRequest({
      value: { ok: false },
    })))).resolves.toEqual({
      value: { ok: false },
    });

    expect(parseExecutionFinishRouteRequest({ value: null }))
      .toEqual({ value: null });
    await expect(Effect.runPromise(parseExecutionFinishRouteRequestEffect({ value: null })))
      .resolves.toEqual({ value: null });
  });

  it("maps protocol failures to the backend 400 error boundary", () => {
    expect(() => parseExecutionFinishRouteRequest(null))
      .toThrow(HttpError);
    try {
      parseExecutionFinishRouteRequest({ value: Number.NaN });
      throw new Error("Expected parseExecutionFinishRouteRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "Execution finish request must include JSON value.",
      });
    }
  });

  it("exposes typed protocol failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(jsonRequest({}))))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(parseExecutionFinishRouteRequestEffect({
      value: Number.NaN,
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readExecutionFinishRequest(new Request("https://flarex.test/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(new Request("https://flarex.test/finish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
