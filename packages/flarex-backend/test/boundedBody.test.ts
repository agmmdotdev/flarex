import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { readBackendBoundedBody } from "../src/boundedBody";

describe("backend bounded body reader", () => {
  it("copies multiple chunks at the exact limit and rejects limit plus one", async () => {
    const exact = await Effect.runPromise(readBackendBoundedBody(
      stream([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]),
      5,
      errors,
    ));
    expect(exact).toEqual(Uint8Array.of(1, 2, 3, 4, 5));

    const failure = await Effect.runPromise(Effect.flip(readBackendBoundedBody(
      stream([Uint8Array.of(1, 2), Uint8Array.of(3, 4, 5)]),
      4,
      errors,
    )));
    expect(failure).toBe(limitError);
  });

  it("owns chunk bytes instead of retaining mutable producer storage", async () => {
    const chunk = Uint8Array.of(1, 2, 3);
    const body = stream([chunk]);
    const read = await Effect.runPromise(readBackendBoundedBody(body, 3, errors));
    chunk.fill(9);
    expect(read).toEqual(Uint8Array.of(1, 2, 3));
  });
});

const limitError = Object.freeze({ _tag: "LimitError" as const });
const resourceError = Object.freeze({ _tag: "ResourceError" as const });
const errors = Object.freeze({
  limitExceeded: () => limitError,
  resourceFailure: () => resourceError,
});

function stream(chunks: ReadonlyArray<Uint8Array>): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}
