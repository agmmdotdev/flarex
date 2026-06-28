import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseExecutionSyscallRouteRequest,
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

    expect(parseExecutionSyscallRouteRequest({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
    })).toEqual({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
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

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readExecutionSyscallRequest(new Request("https://flarex.test/syscall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
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
