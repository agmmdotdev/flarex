import { Data, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createResponsePayloadDecoders } from
  "../src/responsePayloadDecoding";

class TestResponsePayloadError extends Data.TaggedError(
  "TestResponsePayloadError",
)<{
  readonly operation: "claim";
  readonly message: string;
}> {}

describe("response payload decoding", () => {
  it("preserves accepted container references and primitive spellings", async () => {
    const decoders = createTestDecoders();
    const record = { value: true };
    const array: unknown[] = [record];

    await expect(Effect.runPromise(
      decoders.record(record, "claim", "record required"),
    )).resolves.toBe(record);
    await expect(Effect.runPromise(
      decoders.array(array, "claim", "array required"),
    )).resolves.toBe(array);
    await expect(Effect.runPromise(
      decoders.nonEmptyString("value", "name", "claim"),
    )).resolves.toBe("value");
    await expect(Effect.runPromise(
      decoders.boolean(false, "enabled", "claim"),
    )).resolves.toBe(false);

    const negativeZero = await Effect.runPromise(
      decoders.nonNegativeInteger(-0, "offset", "claim"),
    );
    expect(Object.is(negativeZero, -0)).toBe(true);
  });

  it("constructs a typed failure only when a structural decoder rejects", async () => {
    let failures = 0;
    const decoders = createResponsePayloadDecoders<
      "claim",
      TestResponsePayloadError
    >((operation, message) => {
      failures += 1;
      return new TestResponsePayloadError({ operation, message });
    });

    await Effect.runPromise(decoders.boolean(true, "enabled", "claim"));
    expect(failures).toBe(0);

    const failure = await Effect.runPromise(Effect.flip(
      decoders.boolean("true", "enabled", "claim"),
    ));
    expect(failure).toMatchObject({
      _tag: "TestResponsePayloadError",
      operation: "claim",
      message: "enabled must be a boolean.",
    });
    expect(failures).toBe(1);
  });

  it("preserves ISO normalization and first-failure order", async () => {
    const decoders = createTestDecoders();

    await expect(Effect.runPromise(decoders.isoDateString(
      "2026-01-01T01:00:00+01:00",
      "cursor.createdAt",
      "claim",
    ))).resolves.toBe("2026-01-01T00:00:00.000Z");

    const nonString = await Effect.runPromise(Effect.flip(
      decoders.isoDateString(42, "cursor.createdAt", "claim"),
    ));
    expect(nonString.message).toBe(
      "cursor.createdAt must be a non-empty string.",
    );

    const invalidDate = await Effect.runPromise(Effect.flip(
      decoders.isoDateString("not-a-date", "cursor.createdAt", "claim"),
    ));
    expect(invalidDate.message).toBe(
      "cursor.createdAt must be an ISO date string.",
    );
  });
});

function createTestDecoders() {
  return createResponsePayloadDecoders<"claim", TestResponsePayloadError>(
    (operation, message) => new TestResponsePayloadError({
      operation,
      message,
    }),
  );
}
