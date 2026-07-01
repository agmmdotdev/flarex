import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodeExecutionFinishRoutePayload,
  decodeExecutionFinishRouteRequest,
} from "../src/execution/FinishRouteBoundary";

describe("execution finish route boundary", () => {
  it("decodes execution finish requests through the protocol parser", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(jsonRequest({
      value: { ok: true, ids: ["1:user", null] },
    })))).resolves.toEqual({
      value: { ok: true, ids: ["1:user", null] },
    });
    await expect(Effect.runPromise(decodeExecutionFinishRoutePayload({ value: null })))
      .resolves.toEqual({ value: null });
    await expect(Effect.runPromise(decodeExecutionFinishRoutePayload({ value: "done" })))
      .resolves.toEqual({ value: "done" });
  });

  it("keeps protocol failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(jsonRequest({}))))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionFinishRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionFinishRoutePayload({ value: Number.NaN })))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("keeps malformed JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionFinishRouteRequest(new Request(
      "https://flarex.test/finish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
