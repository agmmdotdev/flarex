/// <reference types="node" />

import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  OrderedIndexKeyTooLargeError,
  encodeOrderedIndexComponentsV1,
  orderedIndexValueFromFlarexValueV1,
} from "../src/ordered-index";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  canonicalizeFlarexValueJsonV1,
  canonicalizeFlarexValueV1,
  flarexValueToJsonV1,
  jsonToFlarexValueV1,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  verifyFlarexValueEvidenceV1,
} from "../src/value";

describe("Flarex value codec v1", () => {
  it("round-trips the complete portable value domain with exact tags", () => {
    const bytes = new Uint8Array([0, 127, 255]).buffer;
    const source = {
      nullValue: null,
      integer: -1n,
      ordinaryFloat: 1.25,
      negativeZero: -0,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      notANumber: Number.NaN,
      boolean: true,
      ordinaryString: "hello",
      nulString: "a\u0000b",
      bytes,
      array: [1n, false, "nested"],
      omitted: undefined,
    };

    const json = flarexValueToJsonV1(source);

    expect(json).toEqual({
      array: [{ $integer: "AQAAAAAAAAA=" }, false, "nested"],
      boolean: true,
      bytes: { $bytes: "AH//" },
      integer: { $integer: "//////////8=" },
      negativeInfinity: { $float: "AAAAAAAA8P8=" },
      negativeZero: { $float: "AAAAAAAAAIA=" },
      notANumber: { $float: "AAAAAAAA+H8=" },
      nullValue: null,
      nulString: { $string: "YQBi" },
      ordinaryFloat: 1.25,
      ordinaryString: "hello",
      positiveInfinity: { $float: "AAAAAAAA8H8=" },
    });

    const decoded = jsonToFlarexValueV1(json);
    expect(decoded).toEqual({
      array: [1n, false, "nested"],
      boolean: true,
      bytes,
      integer: -1n,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      negativeZero: -0,
      notANumber: Number.NaN,
      nullValue: null,
      nulString: "a\u0000b",
      ordinaryFloat: 1.25,
      ordinaryString: "hello",
      positiveInfinity: Number.POSITIVE_INFINITY,
    });
    expect(Object.is(
      jsonToFlarexValueV1({ $float: "AAAAAAAAAIA=" }),
      -0,
    )).toBe(true);
    expect(Number.isNaN(
      jsonToFlarexValueV1({ $float: "AAAAAAAA+H8=" }),
    )).toBe(true);
  });

  it("conditionally tags NUL strings so canonical JSON survives jsonb", () => {
    expect(flarexValueToJsonV1("ordinary")).toBe("ordinary");
    expect(flarexValueToJsonV1("before\u0000after")).toEqual({
      $string: "YmVmb3JlAGFmdGVy",
    });
    expect(
      jsonToFlarexValueV1({ $string: "YmVmb3JlAGFmdGVy" }),
    ).toBe("before\u0000after");
    expect(() => jsonToFlarexValueV1("before\u0000after")).toThrowError(
      FlarexValueCodecV1Error,
    );
    expect(() => jsonToFlarexValueV1({ $string: "b3JkaW5hcnk=" }))
      .toThrowError(FlarexValueCodecV1Error);
  });

  it("pins canonical envelope bytes independently of object insertion order and profile", async () => {
    const first = await canonicalizeFlarexValueV1({
      z: "last",
      a: 1n,
    });
    const second = await canonicalizeFlarexValueV1({
      a: 1n,
      z: "last",
    }, "appDocument");

    expect(first.codecVersion).toBe(FLAREX_VALUE_CODEC_VERSION_V1);
    expect(first.canonicalText).toBe(
      '{"format":"flarex-value","value":{"a":{"$integer":"AQAAAAAAAAA="},"z":"last"},"valueCodecVersion":1}',
    );
    expect(new TextDecoder().decode(first.canonicalBytes)).toBe(
      first.canonicalText,
    );
    expect(first.canonicalBytes).toEqual(second.canonicalBytes);
    expect(first.sha256).toEqual(second.sha256);
    expect(toHex(first.sha256)).toBe(
      "13a5fe92a089b4539a1523646899224e8fee89c6bf38a31cbfa07643de711394",
    );
  });

  it("verifies stored codec evidence and rejects every mismatch class", async () => {
    const canonical = await canonicalizeFlarexValueV1({ value: 7n });

    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: canonical.valueJson,
      sha256: canonical.sha256,
      canonicalBytes: canonical.canonicalBytes,
    })).resolves.toEqual(canonical);
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 2,
      valueJson: canonical.valueJson,
      sha256: canonical.sha256,
    })).rejects.toMatchObject({
      issue: { reason: "unsupportedCodecVersion" },
    });
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: canonical.valueJson,
      sha256: new Uint8Array(31),
    })).rejects.toMatchObject({ issue: { reason: "invalidSha256" } });
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: canonical.valueJson,
      sha256: new Uint8Array(32),
    })).rejects.toMatchObject({ issue: { reason: "sha256Mismatch" } });
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: canonical.valueJson,
      sha256: canonical.sha256,
      canonicalBytes: "not bytes",
    })).rejects.toMatchObject({
      issue: { reason: "invalidCanonicalBytes" },
    });
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: canonical.valueJson,
      sha256: canonical.sha256,
      canonicalBytes: new Uint8Array([1]),
    })).rejects.toMatchObject({
      issue: { reason: "canonicalBytesMismatch" },
    });
  });

  it("normalizes parsed tagged JSON back to one canonical form", async () => {
    const parsed: unknown = JSON.parse(
      '{"z":{"$bytes":"AAE="},"a":{"$integer":"AQAAAAAAAAA="}}',
    );
    const normalized = normalizeFlarexValueJsonV1(parsed);
    const canonical = await canonicalizeFlarexValueJsonV1(parsed);

    expect(normalized.value).toEqual({
      a: 1n,
      z: new Uint8Array([0, 1]).buffer,
    });
    expect(canonical.canonicalText).toContain(
      '"value":{"a":{"$integer":"AQAAAAAAAAA="},"z":{"$bytes":"AAE="}}',
    );
    expect(Object.isFrozen(normalized.valueJson)).toBe(true);
  });

  it("applies the app-document profile to the complete logical object", () => {
    const maximumBody = "x".repeat(
      MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1 - 9,
    );
    expect(normalizeFlarexValueV1({ body: maximumBody }, "appDocument"))
      .toMatchObject({
        semanticSizeBytes: MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
        nestingDepth: 1,
      });
    expect(() => normalizeFlarexValueV1(
      { body: `${maximumBody}x` },
      "appDocument",
    )).toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1("not an object", "appDocument"))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1(nestedValue(17), "appDocument"))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1(nestedValue(16), "appDocument"))
      .not.toThrow();
  });

  it("enforces cardinality, field, Unicode, and container invariants", () => {
    expect(() => normalizeFlarexValueV1(
      Array.from({ length: MAX_FLAREX_VALUE_ARRAY_ITEMS_V1 + 1 }, () => null),
    )).toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1(Object.fromEntries(
      Array.from(
        { length: MAX_FLAREX_VALUE_OBJECT_FIELDS_V1 + 1 },
        (_, index) => [`field${index}`, null],
      ),
    ))).toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1({ "$reserved": true }))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1({ "non-ascii-é": true }))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1("\ud800"))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1(1n << 63n))
      .toThrowError(FlarexValueCodecV1Error);
    expect(() => normalizeFlarexValueV1(new Date()))
      .toThrowError(FlarexValueCodecV1Error);

    const sparse = new Array<unknown>(1);
    expect(() => normalizeFlarexValueV1(sparse))
      .toThrowError(FlarexValueCodecV1Error);

    let getterCalled = false;
    const accessor = Object.defineProperty({}, "unsafe", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return true;
      },
    });
    expect(() => normalizeFlarexValueV1(accessor))
      .toThrowError(FlarexValueCodecV1Error);
    expect(getterCalled).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizeFlarexValueV1(cyclic))
      .toThrowError(FlarexValueCodecV1Error);
  });

  it("accepts Convex-style arrays and plain objects from another realm", () => {
    const foreignValue: unknown = runInNewContext(`({
      array: [1n, { value: "nested" }],
      object: { enabled: true }
    })`);

    expect(flarexValueToJsonV1(foreignValue)).toEqual({
      array: [{ $integer: "AQAAAAAAAAA=" }, { value: "nested" }],
      object: { enabled: true },
    });
  });

  it("rejects non-canonical or unknown tagged JSON", () => {
    for (const invalid of [
      { $integer: "AQAAAAAAAA" },
      { $integer: 1 },
      { $float: "AAAAAAAA8D8=" },
      { $bytes: "AAE" },
      { $unknown: "" },
      { $integer: "AQAAAAAAAAA=", extra: true },
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      undefined,
    ]) {
      expect(() => jsonToFlarexValueV1(invalid))
        .toThrowError(FlarexValueCodecV1Error);
    }
  });

  it("rejects oversized tagged payloads before Base64 allocation", () => {
    const numericError = captureCodecError(() => jsonToFlarexValueV1({
      $integer: "A".repeat(16),
    }));
    expect(numericError.issue).toMatchObject({
      reason: "invalidTaggedValue",
      tag: "$integer",
      detail: "eight-byte numeric tag must contain exactly 12 Base64 characters",
    });

    const maximumDecodedBytes =
      MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1 - 2;
    const maximumEncodedCharacters =
      Math.ceil(maximumDecodedBytes / 3) * 4;
    const binaryError = captureCodecError(() => jsonToFlarexValueV1({
      $bytes: "A".repeat(maximumEncodedCharacters + 4),
    }, "appDocument"));
    expect(binaryError.issue).toMatchObject({
      reason: "valueTooLarge",
      profile: "appDocument",
      maximumBytes: MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
    });
  });

  it("copies binary inputs and keeps S05-A authoritative for ordered bytes", () => {
    const source = new Uint8Array([1, 2, 3]);
    const normalized = normalizeFlarexValueV1(source.buffer);
    source[0] = 9;
    if (!(normalized.value instanceof ArrayBuffer)) {
      throw new Error("Expected a normalized ArrayBuffer.");
    }
    expect(new Uint8Array(normalized.value)).toEqual(new Uint8Array([1, 2, 3]));

    const ordered = orderedIndexValueFromFlarexValueV1({ b: 2n, a: 1n });
    expect(ordered).toMatchObject({
      kind: "object",
      entries: [
        { field: "a", value: { kind: "int64", value: 1n } },
        { field: "b", value: { kind: "int64", value: 2n } },
      ],
    });
    expect(encodeOrderedIndexComponentsV1([ordered])).toMatch(/^[0-9a-f]+$/);
    expect(() => orderedIndexValueFromFlarexValueV1("x".repeat(2_100)))
      .toThrowError(OrderedIndexKeyTooLargeError);
  });

  it("surfaces typed codec and evidence failures", async () => {
    expect(() => normalizeFlarexValueV1(undefined))
      .toThrowError(FlarexValueCodecV1Error);
    await expect(verifyFlarexValueEvidenceV1({
      codecVersion: 1,
      valueJson: null,
      sha256: "invalid",
    })).rejects.toThrowError(FlarexValueEvidenceV1Error);
  });
});

function nestedValue(depth: number): unknown {
  let value: unknown = true;
  for (let index = 0; index < depth; index += 1) {
    value = { value };
  }
  return value;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function captureCodecError(operation: () => unknown): FlarexValueCodecV1Error {
  try {
    operation();
  } catch (error) {
    if (error instanceof FlarexValueCodecV1Error) return error;
    throw error;
  }
  throw new Error("Expected Flarex value codec rejection.");
}
