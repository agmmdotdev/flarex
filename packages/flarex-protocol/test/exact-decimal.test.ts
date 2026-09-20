import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeExactDecimal, decodeExactDecimalOrderBytes, encodeExactDecimalOrderBytes, ExactDecimalError } from "../src/exact-decimal";
import { decodeSchemaManifestAppDeveloperOrderedIndexSpecV1, decodeSchemaManifestAppIndexDeclarationsV1Result, decodeSchemaManifestAppIndexFieldPath } from "../src/schema-manifest";
import { compileAppOrderedIndexBoundsV1, encodeAppOrderedIndexKeyV1, decodeAppOrderedIndexKeyV1, lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  orderedIndexCreationTimeV1, appOrderedIndexDocumentPathV1, orderedIndexValueFromFlarexValueV1,
  encodeOrderedIndexComponentsV1, orderedIndexPositionInBoundsV1, decodeOrderedIndexRowIdHexV1,
  ORDERED_INDEX_NULL_V1, ORDERED_INDEX_MISSING_V1 } from "../src/ordered-index";

const hex = (text: string) => Buffer.from(Result.getOrThrow(encodeExactDecimalOrderBytes(text))).toString("hex");

describe("exact decimal index projection", () => {
  it("preserves signs, exponent order and significand prefixes beyond binary64", () => {
    const ordered = ["-1e131071", "-100", "-20.001", "-20", "-1.21", "-1.2", "-1e-16383", "0",
      "1e-16383", "1.2", "1.21", "20", "20.001", "100", "9007199254740992", "9007199254740993", "1e131071"];
    expect([...ordered].reverse().sort((a, b) => hex(a).localeCompare(hex(b)))).toEqual(ordered);
    for (const text of ordered) {
      expect(Result.getOrThrow(decodeExactDecimalOrderBytes(Result.getOrThrow(encodeExactDecimalOrderBytes(text)))))
        .toBe(Result.getOrThrow(decodeExactDecimal(text)).canonical);
    }
    for (const variants of [["-0", "+0.00", "0e100"], ["+0020.00", "2e1", "20"], ["-1.20", "-12e-1", "-0.1200e1"]]) {
      expect(new Set(variants.map(hex)).size).toBe(1);
    }
    const values = Array.from({ length: 401 }, (_, i) => BigInt(i - 200) * 123456789012345678901n);
    expect(values.map(v => `${v}e-30`).reverse().sort((a, b) => hex(a).localeCompare(hex(b))))
      .toEqual(values.map(v => `${v}e-30`));
  });

  it("refuses malformed, unbounded and non-text values without rounding", () => {
    for (const value of [NaN, Infinity, 1, null, {}, "", " 1", "1 ", "1\n", "1\r", "1\r\n", "1\u2028", "1\u2029", "NaN", "Infinity", "1_000", "0x10", "1e", "1e9999999"]) {
      expect(decodeExactDecimal(value)).toMatchObject({ _tag: "Failure", failure: { _tag: "ExactDecimalError", reason: "invalidInput" } });
    }
    for (const value of ["1e-16384", "1e131072", "9".repeat(1025)]) {
      expect(decodeExactDecimal(value)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }
    expect(Result.isSuccess(decodeExactDecimal("9".repeat(1024)))).toBe(true);
    expect(Result.getOrThrow(decodeExactDecimal("001.2300"))).toMatchObject({ canonical: "123e-2" });
  });

  it("authenticates projections and compiles operands using the declared comparison domain", () => {
    const logical = decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({ kind: "developerOrdered", specVersion: 1, fields: ["amount"], decimalFields: ["amount"] });
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(logical);
    const field = spec.orderedFields[0]!;
    expect(field).toMatchObject({ path: "amount", valueFormat: "exactDecimal" });
    const key = (text: string) => encodeAppOrderedIndexKeyV1({ spec, values: [orderedIndexValueFromFlarexValueV1(text), orderedIndexCreationTimeV1(1)] });
    expect(key("20.0")).toBe(key("2e1"));
    expect(key("20") < key("100")).toBe(true);
    const bound = (value: string) => compileAppOrderedIndexBoundsV1({ spec, expressions: [{ op: "eq", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("amount")), value: orderedIndexValueFromFlarexValueV1(value) }] });
    expect(bound("2e1")).toEqual(bound("20.00"));
    for (const special of [ORDERED_INDEX_NULL_V1, ORDERED_INDEX_MISSING_V1]) {
      const values = [special, orderedIndexCreationTimeV1(1)];
      expect(decodeAppOrderedIndexKeyV1({ spec, encodedKey: encodeAppOrderedIndexKeyV1({ spec, values }) })).toEqual(values);
    }
    const decoded = decodeAppOrderedIndexKeyV1({ spec, encodedKey: key("20.00") });
    expect(decoded[0]).toEqual({ kind: "string", value: "2e1" });
    expect(encodeAppOrderedIndexKeyV1({ spec, values: decoded })).toBe(key("20"));
    expect(() => decodeAppOrderedIndexKeyV1({ spec, encodedKey: encodeOrderedIndexComponentsV1([
      orderedIndexValueFromFlarexValueV1("20"), orderedIndexCreationTimeV1(1),
    ]) })).toThrow();
    expect(() => bound("bad")).toThrow(ExactDecimalError);
    expect(() => encodeAppOrderedIndexKeyV1({ spec, values: [orderedIndexValueFromFlarexValueV1(20), orderedIndexCreationTimeV1(1)] })).toThrow(ExactDecimalError);
    for (const decimalFields of [[], ["other"], ["amount", "amount"], ["amount", "currency"]]) {
      expect(Result.isFailure(decodeSchemaManifestAppIndexDeclarationsV1Result([{ tableLogicalName: "prices", descriptor: "by_amount", fields: ["currency", "amount"], decimalFields }]))).toBe(true);
    }
  });

  it("refuses malformed decimal key bytes including noncanonical zeros and trailing digits", () => {
    for (const bytes of [[], [0x20, 0], [0x30], [0x11, 0, 0, 0x3f, 0xff, 2, 0],
      [0x30, 0, 0, 0x3f, 0xff, 1, 0], [0x30, 0, 0, 0x3f, 0xff, 2, 1, 0], [0x30, 0, 0, 0x3f, 0xff, 2, 1]]) {
      expect(Result.isFailure(decodeExactDecimalOrderBytes(Uint8Array.from(bytes)))).toBe(true);
    }
  });

  it("combines a native equality prefix with decimal bounds and keeps the tuple byte limit", () => {
    const spec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
      kind: "developerOrdered", specVersion: 1, fields: ["currency", "amount"], decimalFields: ["amount"],
    }));
    const bounds = compileAppOrderedIndexBoundsV1({ spec, expressions: [
      { op: "eq", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("currency")), value: orderedIndexValueFromFlarexValueV1("usd") },
      { op: "gte", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("amount")), value: orderedIndexValueFromFlarexValueV1("-1.20") },
      { op: "lt", field: appOrderedIndexDocumentPathV1(decodeSchemaManifestAppIndexFieldPath("amount")), value: orderedIndexValueFromFlarexValueV1("2e1") },
    ] });
    const key = (currency: string, amount: string) => encodeAppOrderedIndexKeyV1({ spec, values: [
      orderedIndexValueFromFlarexValueV1(currency), orderedIndexValueFromFlarexValueV1(amount), orderedIndexCreationTimeV1(1),
    ] });
    const included = (currency: string, amount: string) => orderedIndexPositionInBoundsV1({
      encodedKey: key(currency, amount), rowId: decodeOrderedIndexRowIdHexV1("01".repeat(16)),
    }, bounds);
    expect(included("usd", "-12e-1")).toBe(true);
    expect(included("usd", "19.9999999999999999999999")).toBe(true);
    expect(included("usd", "20.00")).toBe(false);
    expect(included("usd", "-1.21")).toBe(false);
    expect(included("eur", "3")).toBe(false);
    expect(() => key("u".repeat(1500), "9".repeat(1024))).toThrow();
  });
});
