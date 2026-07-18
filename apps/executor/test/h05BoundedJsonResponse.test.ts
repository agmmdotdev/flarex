import { describe, expect, it } from "vitest";

import {
  readH05BoundedJsonResponse,
  type H05BoundedJsonResponseFailurePolicy,
} from "../scripts/h05BoundedJsonResponse";

describe("readH05BoundedJsonResponse", () => {
  it("reads bounded JSON without losing Unicode text", async () => {
    await expect(
      readH05BoundedJsonResponse(
        Response.json({ message: "မင်္ဂလာပါ" }),
        1024,
        unexpectedFailurePolicy(),
      ),
    ).resolves.toEqual({ message: "မင်္ဂလာပါ" });
  });

  it("passes the exact size failure through the adapter mapper", async () => {
    const sizeError = new Error("size");
    let observed: unknown;

    await expect(
      readH05BoundedJsonResponse(
        new Response("oversized", {
          headers: { "content-length": "9" },
        }),
        8,
        {
          createSizeError: () => sizeError,
          mapReadFailure: (cause) => {
            observed = cause;
            return cause === sizeError ? sizeError : new Error("read");
          },
          mapDecodeFailure: () => new Error("decode"),
        },
      ),
    ).rejects.toBe(sizeError);
    expect(observed).toBe(sizeError);
  });

  it("maps foreign stream failures once without exposing their cause", async () => {
    const foreignCause = new Error("private stream detail");
    const readError = new Error("redacted read failure");
    let observed: unknown;

    await expect(
      readH05BoundedJsonResponse(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(foreignCause);
            },
          }),
        ),
        1024,
        {
          createSizeError: () => new Error("size"),
          mapReadFailure: (cause) => {
            observed = cause;
            return readError;
          },
          mapDecodeFailure: () => new Error("decode"),
        },
      ),
    ).rejects.toBe(readError);
    expect(observed).toBe(foreignCause);
  });

  it.each([
    [Uint8Array.of(0xc3, 0x28), "invalidUtf8"],
    [new TextEncoder().encode("not-json"), "invalidJson"],
  ] as const)("maps %s through its exact decode reason", async (body, reason) => {
    const decodeError = new Error(reason);
    let observed: unknown;

    await expect(
      readH05BoundedJsonResponse(
        new Response(body),
        1024,
        {
          createSizeError: () => new Error("size"),
          mapReadFailure: () => new Error("read"),
          mapDecodeFailure: (failure) => {
            observed = failure;
            return decodeError;
          },
        },
      ),
    ).rejects.toBe(decodeError);
    expect(observed).toBe(reason);
  });
});

function unexpectedFailurePolicy(): H05BoundedJsonResponseFailurePolicy {
  return {
    createSizeError: () => new Error("unexpected size failure"),
    mapReadFailure: () => new Error("unexpected read failure"),
    mapDecodeFailure: () => new Error("unexpected decode failure"),
  };
}
