import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodePublicExecutionActionRequest,
  decodePublicExecutionActionRoutePayload,
  MissingExecutionActionError,
  MissingExecutionSessionIdError,
  publicExecutionActionRouteErrorToHttpError,
  publicExecutionActionRouteErrorToHttpErrorEffect,
  publicExecutionRoutePathErrorToHttpError,
  publicExecutionRoutePathErrorToHttpErrorEffect,
  publicExecutionRoutePathFromPartsEffect,
} from "../src/execution/ActionRouteBoundary";

describe("public execution action route boundary", () => {
  it("decodes public syscall bodies before forwarding", async () => {
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
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload({}, "finish")))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("keeps public abort as well-formed JSON forwarding", async () => {
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(jsonRequest({
      ignored: true,
    }), "abort"))).resolves.toEqual({ ignored: true });
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload(null, "abort")))
      .resolves.toBeNull();
  });

  it("keeps malformed public action JSON in the typed body error channel", async () => {
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(new Request("https://flarex.test/syscall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "syscall"))).rejects.toBeInstanceOf(RequestJsonError);
    await expect(Effect.runPromise(decodePublicExecutionActionRequest(new Request("https://flarex.test/abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), "abort"))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("exposes typed public action failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicExecutionActionRoutePayload({
      op: "query",
      request: {
        table: "lessonProgress",
        order: "sideways",
      },
    }, "syscall"))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

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
