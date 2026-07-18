import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  badRequestErrorToHttpError,
  HttpError,
  readResponseJsonEffect,
  readResponseJsonOrNullEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
  ResponseJsonError,
} from "../src/http";

describe("HTTP response JSON boundary", () => {
  it("reads response JSON through a typed boundary", async () => {
    await expect(
      Effect.runPromise(readResponseJsonEffect(Response.json({ ok: true }))),
    ).resolves.toEqual({ ok: true });
  });

  it("exposes malformed response JSON before fallback", async () => {
    const response = new Response("not json", {
      headers: { "content-type": "application/json" },
    });

    await expect(
      Effect.runPromise(readResponseJsonEffect(response)),
    ).rejects.toBeInstanceOf(ResponseJsonError);
  });

  it("preserves compatibility by falling back malformed response bodies to null", async () => {
    const response = new Response("not json", {
      headers: { "content-type": "application/json" },
    });

    await expect(
      Effect.runPromise(readResponseJsonOrNullEffect(response)),
    ).resolves.toBeNull();
  });
});

describe("HTTP error projection", () => {
  it("projects message-bearing bad requests without inspecting their domain tag", () => {
    const source = {
      _tag: "DomainValidationError",
      message: "The request is invalid.",
    } as const;

    const first = badRequestErrorToHttpError(source);
    const second = badRequestErrorToHttpError(source);

    expect(first).toBeInstanceOf(HttpError);
    expect(first).toMatchObject({
      status: 400,
      message: "The request is invalid.",
    });
    expect(second).not.toBe(first);
  });

  it("retains the named request JSON projection", () => {
    const error = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });

    expect(requestJsonErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});
