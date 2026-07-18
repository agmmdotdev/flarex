import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeH05JsonBytes,
  decodeH05JsonBytesOrThrow,
} from "../scripts/h05JsonBytes";

describe("H05 JSON byte decoder", () => {
  it("decodes valid UTF-8 JSON as unknown data", () => {
    const bytes = new TextEncoder().encode('{"message":"မင်္ဂလာပါ"}');

    expect(decodeH05JsonBytes(bytes)).toEqual(
      Result.succeed({ message: "မင်္ဂလာပါ" }),
    );
  });

  it("distinguishes malformed UTF-8 from invalid JSON", () => {
    expect(decodeH05JsonBytes(Uint8Array.of(0xc3, 0x28))).toEqual(
      Result.fail("invalidUtf8"),
    );
    expect(
      decodeH05JsonBytes(new TextEncoder().encode("not-json")),
    ).toEqual(Result.fail("invalidJson"));
  });

  it("maps failure only at an explicit throwing compatibility boundary", () => {
    const expected = new Error("redacted H05 response failure");
    let caught: unknown;

    try {
      decodeH05JsonBytesOrThrow(
        Uint8Array.of(0xc3, 0x28),
        () => expected,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(expected);
  });
});
