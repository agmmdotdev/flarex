import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeExecutionSyscallRouteRequest,
  decodeExecutionSyscallRoutePayload,
  parseExecutionSyscallRouteRequest,
  parseExecutionSyscallRouteRequestEffect,
  readExecutionSyscallRequest,
} from "../src/execution/SyscallRouteBoundary";

describe("execution syscall route boundary", () => {
  it("decodes execution syscall requests through the protocol parser", async () => {
    await expect(readExecutionSyscallRequest(jsonRequest({
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
    }))).resolves.toEqual({
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
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(jsonRequest({
      op: "get",
      id: "1:progress",
    })))).resolves.toEqual({
      op: "get",
      id: "1:progress",
    });

    expect(parseExecutionSyscallRouteRequest({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
    })).toEqual({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
    });
    await expect(Effect.runPromise(parseExecutionSyscallRouteRequestEffect({
      op: "replace",
      id: "1:progress",
      value: { completed: false },
    }))).resolves.toEqual({
      op: "replace",
      id: "1:progress",
      value: { completed: false },
    });
    await expect(Effect.runPromise(decodeExecutionSyscallRoutePayload({
      op: "get",
      id: "1:progress",
    }))).resolves.toEqual({
      op: "get",
      id: "1:progress",
    });
  });

  it("maps protocol failures to the backend 400 error boundary", () => {
    expect(() => parseExecutionSyscallRouteRequest(null))
      .toThrow(HttpError);
    try {
      parseExecutionSyscallRouteRequest({
        op: "insert",
        table: "lessonProgress",
        value: Number.NaN,
      });
      throw new Error("Expected parseExecutionSyscallRouteRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message:
          "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
      });
    }
  });

  it("exposes typed protocol failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(jsonRequest({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    })))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionSyscallRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(parseExecutionSyscallRouteRequestEffect(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readExecutionSyscallRequest(new Request("https://flarex.test/syscall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
    await expect(Effect.runPromise(decodeExecutionSyscallRouteRequest(new Request("https://flarex.test/syscall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/syscall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
