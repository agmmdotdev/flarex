import { describe, expect, it } from "vitest";

import { readBoundedJson } from "../src/http";

describe("bounded probe HTTP JSON reader", () => {
  it("decodes a valid chunked JSON body", async () => {
    const result = await readBoundedJson(
      bodySource(["{\"value\":", "1}"]),
      32,
    );
    expect(result).toEqual({ ok: true, value: { value: 1 } });
  });

  it("rejects declared and streamed bodies above the limit", async () => {
    const declared = await readBoundedJson(
      {
        body: stream(["{}"]),
        headers: new Headers({ "content-length": "33" }),
      },
      32,
    );
    const streamed = await readBoundedJson(
      bodySource(["x".repeat(20), "x".repeat(20)]),
      32,
    );

    expect(declared).toEqual({ ok: false, reason: "body_too_large" });
    expect(streamed).toEqual({ ok: false, reason: "body_too_large" });
  });

  it("rejects invalid content lengths, UTF-8, JSON, and absent bodies", async () => {
    const invalidLength = await readBoundedJson(
      {
        body: stream(["{}"]),
        headers: new Headers({ "content-length": "2.5" }),
      },
      32,
    );
    const invalidUtf8 = await readBoundedJson(
      {
        body: byteStream([new Uint8Array([0xff])]),
        headers: new Headers(),
      },
      32,
    );
    const invalidJson = await readBoundedJson(bodySource(["not-json"]), 32);
    const absent = await readBoundedJson(
      { body: null, headers: new Headers() },
      32,
    );

    expect(invalidLength).toEqual({ ok: false, reason: "invalid_body" });
    expect(invalidUtf8).toEqual({ ok: false, reason: "invalid_body" });
    expect(invalidJson).toEqual({ ok: false, reason: "invalid_body" });
    expect(absent).toEqual({ ok: false, reason: "invalid_body" });
  });
});

function bodySource(chunks: ReadonlyArray<string>) {
  return {
    body: stream(chunks),
    headers: new Headers(),
  } satisfies Pick<Request, "body" | "headers">;
}

type BodyBytes = Uint8Array<ArrayBuffer>;

function stream(chunks: ReadonlyArray<string>): ReadableStream<BodyBytes> {
  const encoder = new TextEncoder();
  return byteStream(chunks.map(chunk => encoder.encode(chunk)));
}

function byteStream(
  chunks: ReadonlyArray<BodyBytes>,
): ReadableStream<BodyBytes> {
  return new ReadableStream<BodyBytes>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
