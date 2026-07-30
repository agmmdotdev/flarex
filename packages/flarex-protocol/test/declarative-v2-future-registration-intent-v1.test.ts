import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECLARATIVE_V2_FUTURE_REGISTRATION_INTENT_IDENTITY_V1,
  decodeDeclarativeV2FutureRegistrationIntentV1,
  encodeDeclarativeV2FutureRegistrationIntentV1,
  type DeclarativeV2FutureRegistrationIntentV1,
} from "../src/declarative-v2-future-registration-intent-v1";

const digest = (value: number): Uint8Array =>
  new Uint8Array(32).fill(value);

const fixture = (): DeclarativeV2FutureRegistrationIntentV1 => ({
  attemptSha256: digest(1),
  candidateSha256: digest(2),
  linkReservationSha256: digest(3),
  linkSequence: 7n,
  registrationSequence: 8n,
  registrationCurrentProgressSha256: digest(4),
  registrationCommandBudgetSha256: digest(5),
  registrationCommandInputSha256: digest(6),
  freshAuthenticatedInputSha256: digest(7),
  parsePagesRootSha256: digest(8),
  analyzerReleaseSha256: digest(9),
  analyzerIdentitySha256: digest(10),
  verifierIdentitySha256: digest(11),
});

describe("DeclarativeV2FutureRegistrationIntentV1", () => {
  it("pins the exact 13-field canonical preimage and digest", () => {
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2FutureRegistrationIntentV1(fixture()),
    );
    const expected = concat(
      new TextEncoder().encode(
        DECLARATIVE_V2_FUTURE_REGISTRATION_INTENT_IDENTITY_V1,
      ),
      u32(13),
      digest(1),
      digest(2),
      digest(3),
      u64(7n),
      u64(8n),
      ...Array.from({ length: 8 }, (_, index) => digest(index + 4)),
    );
    expect(encoded.canonicalBytes).toEqual(expected);
    expect(
      createHash("sha256").update(expected).digest("hex"),
    ).toBe("1db3f0ce4366d307b64575d53d630337c6bd86f77f14c87f0ea21d6a678baa5b");
    expect(
      Result.getOrThrow(
        decodeDeclarativeV2FutureRegistrationIntentV1(expected),
      ).intent,
    ).toEqual(fixture());
  });

  it("changes for every field and rejects malformed input", () => {
    const original = Result.getOrThrow(
      encodeDeclarativeV2FutureRegistrationIntentV1(fixture()),
    ).canonicalBytes;
    for (const field of Object.keys(fixture()) as Array<
      keyof DeclarativeV2FutureRegistrationIntentV1
    >) {
      const input = fixture();
      const value = input[field];
      const changed = {
        ...input,
        [field]: typeof value === "bigint"
          ? value + (field === "linkSequence" ? 1n : 2n)
          : digest(value[0]! + 32),
      };
      if (field === "linkSequence") {
        changed.registrationSequence = changed.linkSequence + 1n;
      } else if (field === "registrationSequence") {
        changed.linkSequence = changed.registrationSequence - 1n;
      }
      const encoded = Result.getOrThrow(
        encodeDeclarativeV2FutureRegistrationIntentV1(changed),
      );
      expect(encoded.canonicalBytes, field).not.toEqual(original);
    }
    expect(Result.isFailure(
      decodeDeclarativeV2FutureRegistrationIntentV1(
        original.subarray(0, original.byteLength - 1),
      ),
    )).toBe(true);
    expect(Result.isFailure(
      encodeDeclarativeV2FutureRegistrationIntentV1({
        ...fixture(),
        unexpected: digest(99),
      }),
    )).toBe(true);
  });

  it("owns decoded and encoded bytes defensively", () => {
    const input = fixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2FutureRegistrationIntentV1(input),
    );
    input.attemptSha256.fill(255);
    expect(encoded.intent.attemptSha256).toEqual(digest(1));

    const bytes = new Uint8Array(encoded.canonicalBytes);
    const decoded = Result.getOrThrow(
      decodeDeclarativeV2FutureRegistrationIntentV1(bytes),
    );
    bytes.fill(0);
    expect(decoded.canonicalBytes).toEqual(encoded.canonicalBytes);
  });

  it("rejects accessor-backed hostile input without invoking getters", () => {
    let reads = 0;
    const hostile = { ...fixture() };
    Object.defineProperty(hostile, "attemptSha256", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(Result.isFailure(
      encodeDeclarativeV2FutureRegistrationIntentV1(hostile),
    )).toBe(true);
    expect(reads).toBe(0);
  });
});

function concat(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  for (let index = 0; index < result.byteLength; index += 1) {
    result[index] =
      Number((value >> BigInt((7 - index) * 8)) & 0xffn);
  }
  return result;
}
