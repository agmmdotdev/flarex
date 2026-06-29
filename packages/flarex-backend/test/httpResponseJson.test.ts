import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  readResponseJsonEffect,
  readResponseJsonOrNullEffect,
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
