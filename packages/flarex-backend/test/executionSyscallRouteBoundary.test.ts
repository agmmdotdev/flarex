import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodeExecutionSyscallRoutePayload,
  decodeExecutionSyscallRouteRequest,
} from "../src/execution/SyscallRouteBoundary";

describe("execution syscall route boundary", () => {
  it("decodes execution syscall requests through the protocol parser", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(jsonRequest({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "u1" },
          ],
        },
        limit: 10,
        cursor: "after:intro",
        order: "asc",
      },
    })))).resolves.toEqual({
      op: "query",
      request: {
        table: "lessonProgress",
        index: "by_user_lesson",
        range: {
          expressions: [
            { op: "eq", field: "userId", value: "u1" },
          ],
        },
        limit: 10,
        cursor: "after:intro",
        order: "asc",
      },
    });

    await expect(Effect.runPromise(decodeExecutionSyscallRoutePayload({
      op: "replace",
      id: "1:progress",
      value: { completed: false },
    }))).resolves.toEqual({
      op: "replace",
      id: "1:progress",
      value: { completed: false },
    });
  });

  it("keeps protocol failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(jsonRequest({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    })))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionSyscallRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionSyscallRoutePayload({
      op: "insert",
      table: "lessonProgress",
      value: Number.NaN,
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("keeps malformed JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(new Request(
      "https://flarex.test/syscall",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/syscall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
