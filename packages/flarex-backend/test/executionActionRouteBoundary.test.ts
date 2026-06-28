import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import { readPublicExecutionActionRequest } from "../src/execution/ActionRouteBoundary";

describe("public execution action route boundary", () => {
  it("decodes public syscall bodies before forwarding", async () => {
    await expect(readPublicExecutionActionRequest(jsonRequest({
      op: "get",
      id: "1:progress",
    }), "syscall")).resolves.toEqual({
      op: "get",
      id: "1:progress",
    });

    await expect(readPublicExecutionActionRequest(jsonRequest({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    }), "syscall")).rejects.toMatchObject({
      status: 400,
      message:
        "Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.",
    });
  });

  it("decodes public finish bodies before forwarding", async () => {
    await expect(readPublicExecutionActionRequest(jsonRequest({
      value: { ok: true },
    }), "finish")).resolves.toEqual({
      value: { ok: true },
    });

    await expect(readPublicExecutionActionRequest(jsonRequest({}), "finish"))
      .rejects.toMatchObject({
        status: 400,
        message: "Execution finish request must include JSON value.",
      });
  });

  it("keeps public abort as well-formed JSON forwarding", async () => {
    await expect(readPublicExecutionActionRequest(jsonRequest({}), "abort"))
      .resolves.toEqual({});
    await expect(readPublicExecutionActionRequest(jsonRequest({
      ignored: true,
    }), "abort")).resolves.toEqual({ ignored: true });
  });

  it("preserves malformed public action JSON as the shared body error", async () => {
    await expect(readPublicExecutionActionRequest(new Request("https://flarex.test/syscall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "syscall")).rejects.toBeInstanceOf(HttpError);
    await expect(readPublicExecutionActionRequest(new Request("https://flarex.test/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "abort")).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
