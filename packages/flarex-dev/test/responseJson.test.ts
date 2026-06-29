import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  DevResponseJsonError,
  readDevResponseJsonEffect,
  readDevResponseJsonOrNullEffect,
} from "../src/responseJson";

describe("dev response JSON boundary", () => {
  it("reads response JSON through a typed boundary", async () => {
    await expect(
      Effect.runPromise(readDevResponseJsonEffect(Response.json({ ok: true }))),
    ).resolves.toEqual({ ok: true });
  });

  it("exposes malformed response JSON before compatibility fallback", async () => {
    const response = new Response("not json", {
      headers: { "content-type": "application/json" },
    });

    await expect(
      Effect.runPromise(readDevResponseJsonEffect(response)),
    ).rejects.toBeInstanceOf(DevResponseJsonError);
  });

  it("preserves compatibility by falling back malformed response bodies to null", async () => {
    const response = new Response("not json", {
      headers: { "content-type": "application/json" },
    });

    await expect(
      Effect.runPromise(readDevResponseJsonOrNullEffect(response)),
    ).resolves.toBeNull();
  });
});
