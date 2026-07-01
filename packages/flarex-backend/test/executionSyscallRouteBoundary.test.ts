import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodeExecutionSyscallRoutePayload,
  decodeExecutionSyscallRouteRequest,
  executionSyscallRouteErrorToHttpError,
  executionSyscallRouteErrorToHttpErrorEffect,
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

  it("maps typed execution syscall route errors through named adapter effects", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(executionSyscallRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new ExecutionProtocolValidationError({
      schema: "ExecutionSyscallRequest",
      message:
        "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
      cause: null,
    });
    expect(executionSyscallRouteErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message:
        "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
    });

    await expect(Effect.runPromise(Effect.flip(
      executionSyscallRouteErrorToHttpErrorEffect(protocolError),
    ))).resolves.toMatchObject({
      status: 400,
      message:
        "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/syscall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
