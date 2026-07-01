import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicExecutionActionRequest,
  decodePublicExecutionActionRoutePayload,
  MissingExecutionActionError,
  MissingExecutionSessionIdError,
  parsePublicExecutionActionRequest,
  parsePublicExecutionActionRequestEffect,
  publicExecutionActionRouteErrorToHttpError,
  publicExecutionActionRouteErrorToHttpErrorEffect,
  publicExecutionRoutePathErrorToHttpError,
  publicExecutionRoutePathErrorToHttpErrorEffect,
  publicExecutionRoutePathFromPartsEffect,
  readPublicExecutionActionRequest,
} from "../src/execution/ActionRouteBoundary";

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

    expect(parsePublicExecutionActionRequest({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
    }, "syscall")).toEqual({
      op: "patch",
      id: "1:progress",
      value: { completed: true },
    });
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(jsonRequest({
      op: "delete",
      id: "1:progress",
    }), "syscall"))).resolves.toEqual({
      op: "delete",
      id: "1:progress",
    });
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload({
      op: "get",
      id: "1:progress",
    }, "syscall"))).resolves.toEqual({
      op: "get",
      id: "1:progress",
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

    expect(parsePublicExecutionActionRequest({
      value: null,
    }, "finish")).toEqual({
      value: null,
    });
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(jsonRequest({
      value: "done",
    }), "finish"))).resolves.toEqual({
      value: "done",
    });
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload({
      value: "done",
    }, "finish"))).resolves.toEqual({
      value: "done",
    });
  });

  it("keeps public abort as well-formed JSON forwarding", async () => {
    await expect(readPublicExecutionActionRequest(jsonRequest({}), "abort"))
      .resolves.toEqual({});
    await expect(readPublicExecutionActionRequest(jsonRequest({
      ignored: true,
    }), "abort")).resolves.toEqual({ ignored: true });
    expect(parsePublicExecutionActionRequest(null, "abort")).toBeNull();
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(jsonRequest({
      ignored: true,
    }), "abort"))).resolves.toEqual({ ignored: true });
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

  it("exposes typed public action failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    }, "syscall"))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(parsePublicExecutionActionRequestEffect({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    }, "syscall"))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(parsePublicExecutionActionRequestEffect({}, "finish")))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodePublicExecutionActionRequest(new Request(
      "https://flarex.test/syscall",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "syscall"))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed public action route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicExecutionActionRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new ExecutionProtocolValidationError({
      schema: "ExecutionFinishRequest",
      message: "Execution finish request must include JSON value.",
      cause: null,
    });
    expect(publicExecutionActionRouteErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message: "Execution finish request must include JSON value.",
    });
  });

  it("maps typed public action route errors through named adapter effects", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    const mappedJson = await Effect.runPromise(Effect.flip(
      publicExecutionActionRouteErrorToHttpErrorEffect(jsonError),
    ));
    expect(mappedJson).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new ExecutionProtocolValidationError({
      schema: "ExecutionFinishRequest",
      message: "Execution finish request must include JSON value.",
      cause: null,
    });
    const mappedProtocol = await Effect.runPromise(Effect.flip(
      publicExecutionActionRouteErrorToHttpErrorEffect(protocolError),
    ));
    expect(mappedProtocol).toMatchObject({
      status: 400,
      message: "Execution finish request must include JSON value.",
    });

    const mappedPath = await Effect.runPromise(Effect.flip(
      publicExecutionRoutePathErrorToHttpErrorEffect(new MissingExecutionSessionIdError()),
    ));
    expect(mappedPath).toMatchObject({
      status: 400,
      message: "Missing execution session id.",
    });
  });

  it("keeps public execution route path parsing typed before Worker mapping", async () => {
    await expect(Effect.runPromise(publicExecutionRoutePathFromPartsEffect([
      "session-a",
      "syscall",
    ]))).resolves.toEqual({
      matched: true,
      sessionId: "session-a",
      action: "syscall",
    });

    await expect(Effect.runPromise(publicExecutionRoutePathFromPartsEffect([
      "session-a",
      "unknown",
    ]))).resolves.toEqual({ matched: false });

    await expect(Effect.runPromise(publicExecutionRoutePathFromPartsEffect([])))
      .rejects.toBeInstanceOf(MissingExecutionSessionIdError);

    await expect(Effect.runPromise(publicExecutionRoutePathFromPartsEffect(["session-a"])))
      .rejects.toBeInstanceOf(MissingExecutionActionError);

    expect(publicExecutionRoutePathErrorToHttpError(new MissingExecutionSessionIdError()))
      .toMatchObject({
        status: 400,
        message: "Missing execution session id.",
      });
    expect(publicExecutionRoutePathErrorToHttpError(new MissingExecutionActionError()))
      .toMatchObject({
        status: 400,
        message: "Missing execution action.",
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
