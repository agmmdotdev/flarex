import { describe, expect, it } from "vitest";

import { readH05BoundedResponseBody } from "../scripts/h05BoundedResponseBody";

class TestSizeError extends Error {}

const createSizeError = (): Error => new TestSizeError("too large");

describe("H05 bounded response body reader", () => {
  it.each(["", "-0", "10", " 10 ", "1e1"])(
    "accepts the numeric content-length spelling %j",
    async (contentLength) => {
      const response = new Response("0123456789", {
        headers: { "content-length": contentLength },
      });

      await expect(
        readH05BoundedResponseBody(response, 10, createSizeError),
      ).resolves.toEqual(new TextEncoder().encode("0123456789"));
    },
  );

  it.each(["11", "-1", "1.5", "NaN", "Infinity"])(
    "rejects the declared length %j",
    async (contentLength) => {
      const response = new Response(null, {
        headers: { "content-length": contentLength },
      });

      await expect(
        readH05BoundedResponseBody(response, 10, createSizeError),
      ).rejects.toThrow(TestSizeError);
    },
  );

  it("accepts a null body and concatenates chunks through the exact limit", async () => {
    await expect(
      readH05BoundedResponseBody(new Response(null), 0, createSizeError),
    ).resolves.toEqual(new Uint8Array());

    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2));
          controller.enqueue(Uint8Array.of(3));
          controller.close();
        },
      }),
    );
    await expect(
      readH05BoundedResponseBody(response, 3, createSizeError),
    ).resolves.toEqual(Uint8Array.of(1, 2, 3));
  });

  it("cancels an oversized stream without surfacing cancellation details", async () => {
    const marker = "PRIVATE_CANCEL_DETAIL";
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(Uint8Array.of(1, 2, 3));
        },
        cancel() {
          cancelled = true;
          throw new Error(marker);
        },
      }),
    );

    const failure = readH05BoundedResponseBody(response, 2, createSizeError);
    await expect(failure).rejects.toThrow("too large");
    await expect(failure).rejects.not.toThrow(marker);
    expect(cancelled).toBe(true);
  });

  it("preserves a stream read failure for the owning boundary to redact", async () => {
    const failure = new Error("stream failure");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(failure);
        },
      }),
    );

    await expect(
      readH05BoundedResponseBody(response, 10, createSizeError),
    ).rejects.toBe(failure);
  });
});
