import { describe, expect, it } from "vitest";

import {
  canonicalFlarexRuntimeValueToJsonV1,
  createOwnedCanonicalFlarexRuntimeValueReaderV1,
  createOwnedCanonicalFlarexRuntimeValueProjectionV1,
  FLAREX_GENERAL_VALUE_LIMITS_V1,
  FlarexValueRuntimeCoreV1Error,
  isCanonicalFlarexRuntimeObjectV1,
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1,
  normalizeFlarexRuntimeValueV1,
  normalizeFlarexRuntimeValueWithLimitsV1,
} from "../src/value-runtime-core";
import {
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
  canonicalizeFlarexValueV1,
  inspectCanonicalFlarexValueOwnershipV1,
} from "../src/value";

describe("Effect-free Flarex value runtime core", () => {
  it("retains only exact codec issuance and protects every escaped binary loan without changing the public result", async () => {
    const document = await canonicalizeFlarexValueV1({ bytes: new Uint8Array([1, 2, 3]).buffer,
      immutable: { values: [42n, -0, NaN, Infinity, -Infinity] } }, "appDocument");
    const evidence = inspectCanonicalFlarexValueOwnershipV1(document);
    if (evidence === undefined) throw new Error("Missing actual codec issuance");
    expect(evidence.intact).toBe(true);
    expect(inspectCanonicalFlarexValueOwnershipV1(structuredClone(document))).toBeUndefined();
    expect(inspectCanonicalFlarexValueOwnershipV1(Object.freeze({ ...document }))).toBeUndefined();
    const foreign = structuredClone(document);
    foreign.canonicalBytes.fill(9);
    foreign.sha256.fill(7);
    const foreignProjection = createOwnedCanonicalFlarexRuntimeValueProjectionV1(foreign.value);
    expect(foreignProjection.binaryMatches()).toBe(true);
    expect(inspectCanonicalFlarexValueOwnershipV1(foreign)).toBeUndefined();
    const first = evidence.read();
    if (!isCanonicalFlarexRuntimeObjectV1(first) || !(first.bytes instanceof ArrayBuffer)) throw new Error("Missing binary loan");
    new Uint8Array(first.bytes).fill(9);
    const second = evidence.read();
    if (!isCanonicalFlarexRuntimeObjectV1(second) || !(second.bytes instanceof ArrayBuffer)) throw new Error("Missing second binary loan");
    expect(new Uint8Array(second.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(second.immutable).toBe(first.immutable);
    expect(second.immutable).toEqual({ values: [42n, -0, NaN, Infinity, -Infinity] });
    expect(inspectCanonicalFlarexValueOwnershipV1(document)?.intact).toBe(true);
    const original = document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(original) || !(original.bytes instanceof ArrayBuffer)) throw new Error("Missing public binary runtime");
    new Uint8Array(original.bytes).fill(8);
    expect(inspectCanonicalFlarexValueOwnershipV1(document)?.intact).toBe(false);
    const retained = evidence.read();
    if (!isCanonicalFlarexRuntimeObjectV1(retained) || !(retained.bytes instanceof ArrayBuffer)) throw new Error("Missing retained binary loan");
    expect(new Uint8Array(retained.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("refreezes privately detached canonical containers and detaches every escaped binary path", () => {
    const businessInput = { bytes: new Uint8Array([1, 2, 3]).buffer,
      unchanged: { name: "retained" }, values: [42n, -0, NaN, Infinity, -Infinity] };
    const owned = structuredClone(normalizeFlarexRuntimeValueV1(businessInput).value);
    const read = createOwnedCanonicalFlarexRuntimeValueReaderV1(owned);
    const first = read();
    if (!isCanonicalFlarexRuntimeObjectV1(first) || !(first.bytes instanceof ArrayBuffer))
      throw new Error("Expected a binary-bearing canonical projection");
    expect(Object.isFrozen(businessInput)).toBe(false);
    expect(Object.isFrozen(businessInput.unchanged)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.unchanged)).toBe(true);
    expect(Object.isFrozen(first.values)).toBe(true);
    new Uint8Array(first.bytes).fill(9);
    const second = read();
    if (!isCanonicalFlarexRuntimeObjectV1(second) || !(second.bytes instanceof ArrayBuffer))
      throw new Error("Expected a second detached binary-bearing projection");
    expect(new Uint8Array(second.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(second.unchanged).toBe(first.unchanged);
    expect(second.values).toBe(first.values);
    expect(second.values).toEqual([42n, -0, NaN, Infinity, -Infinity]);
  });

  it("preserves the public codec value, JSON, size, depth, and ownership semantics", () => {
    const sourceBytes = new Uint8Array([0, 127, 255]).buffer;
    const source = {
      z: [1n, -0, "a\u0000b", sourceBytes],
      omitted: undefined,
      a: { ok: true },
    };

    const core = normalizeFlarexRuntimeValueV1(source);
    const codec = normalizeFlarexValueV1(source);

    expect(core).toEqual({
      profile: codec.profile,
      value: codec.value,
      semanticSizeBytes: codec.semanticSizeBytes,
      nestingDepth: codec.nestingDepth,
    });
    expect(canonicalFlarexRuntimeValueToJsonV1(core.value))
      .toEqual(codec.valueJson);
    expect(core.value).not.toBe(source);
    expect((core.value as { readonly z: readonly unknown[] }).z[3])
      .not.toBe(sourceBytes);
    expect(Object.isFrozen(core)).toBe(true);
    expect(Object.isFrozen(core.value)).toBe(true);
  });

  it.each([
    ["unsupported type", () => Symbol("unsupported"), "unsupportedValue"],
    ["out-of-range bigint", () => 1n << 63n, "unsupportedValue"],
    ["application document root", () => [], "appDocumentRoot"],
    ["symbol property", () => {
      const value = { ok: true };
      Object.defineProperty(value, Symbol("extra"), {
        enumerable: true,
        value: true,
      });
      return value;
    }, "invalidContainer"],
    ["cycle", () => {
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    }, "cyclicValue"],
  ] as const)("maps the %s issue into the existing public error", (
    _label,
    createValue,
    reason,
  ) => {
    const profile = reason === "appDocumentRoot" ? "appDocument" : "generalValue";
    let coreIssue: unknown;
    try {
      normalizeFlarexRuntimeValueV1(createValue(), profile);
    } catch (cause) {
      expect(cause).toBeInstanceOf(FlarexValueRuntimeCoreV1Error);
      coreIssue = (cause as FlarexValueRuntimeCoreV1Error).issue;
    }

    try {
      normalizeFlarexValueV1(createValue(), profile);
      throw new Error("Expected public codec rejection.");
    } catch (cause) {
      expect(cause).toBeInstanceOf(FlarexValueCodecV1Error);
      expect((cause as FlarexValueCodecV1Error).issue).toEqual(coreIssue);
      expect((cause as FlarexValueCodecV1Error).issue.reason).toBe(reason);
    }
  });

  it.each([
    ["empty", "", 0],
    ["ASCII", "abc", 3],
    ["NUL", "a\u0000b", 3],
    ["U+007F", "\u007f", 1],
    ["U+0080", "\u0080", 2],
    ["U+07FF", "\u07ff", 2],
    ["U+0800", "\u0800", 3],
    ["U+D7FF", "\ud7ff", 3],
    ["U+E000", "\ue000", 3],
    ["U+FFFF", "\uffff", 3],
    ["U+10000", "\u{10000}", 4],
    ["U+10FFFF", "\u{10ffff}", 4],
    ["adjacent astral pairs", "\u{1f600}\u{1f601}", 8],
    ["mixed widths", "a\u0080\u0800\u{1f600}\u0000", 11],
  ] as const)("charges a %s string two bytes plus its UTF-8 length", (
    _label,
    value,
    utf8Bytes,
  ) => {
    expect(normalizeFlarexRuntimeValueV1(value)).toMatchObject({
      value,
      semanticSizeBytes: 2 + utf8Bytes,
      nestingDepth: 0,
    });
    expect(normalizeFlarexRuntimeValueV1({ k: [value] }).semanticSizeBytes)
      .toBe(2 + 2 + (2 + 2 + utf8Bytes));
  });

  it.each([
    ["high surrogate alone", "\ud800", "high"],
    ["high surrogate at the start", "\ud800ab", "high"],
    ["high surrogate in the middle", "a\udbffb", "high"],
    ["high surrogate at the end", "ab\ud83d", "high"],
    ["high surrogate before another pair", "\ud800\u{10000}", "high"],
    ["low surrogate alone", "\udc00", "low"],
    ["low surrogate at the start", "\udfffab", "low"],
    ["low surrogate in the middle", "a\udc00b", "low"],
    ["low surrogate at the end", "\u{1f600}\ude00", "low"],
    ["reversed pair", "\udc00\ud800", "low"],
  ] as const)("rejects a %s before any size limit", (_label, value, kind) => {
    const issue = {
      reason: "unsupportedValue",
      path: "$.field[0]",
      detail: `string contains an unpaired ${kind} surrogate`,
    };
    expect(captureStringIssue(value, MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1)).toEqual(issue);
    expect(captureStringIssue(value, 0)).toEqual(issue);
  });

  it("reports the code-unit precheck before the exact UTF-8 string size", () => {
    const withinLimit = (value: string, maxSemanticBytes: number) =>
      normalizeFlarexRuntimeValueWithLimitsV1(
        value,
        { ...FLAREX_GENERAL_VALUE_LIMITS_V1, maxSemanticBytes },
      ).semanticSizeBytes;
    const tooLarge = (observedBytes: number, maximumBytes: number) => ({
      reason: "valueTooLarge",
      path: "$.field[0]",
      profile: "generalValue",
      observedBytes,
      maximumBytes,
    });

    // More code units than the limit: the report is the code-unit count plus two.
    expect(captureStringIssue("\u0800\u0800\u0800\u0800", 3)).toEqual(tooLarge(6, 3));
    expect(captureStringIssue("abcd", 3)).toEqual(tooLarge(6, 3));
    // Exactly as many code units as the limit: the precheck does not apply.
    expect(captureStringIssue("\u0800\u0800\u0800", 3)).toEqual(tooLarge(11, 3));
    // Code units fit, the encoded size does not: the report is the exact size.
    expect(captureStringIssue("abcd", 5)).toEqual(tooLarge(6, 5));
    expect(captureStringIssue("\u0080\u0080", 5)).toEqual(tooLarge(6, 5));
    expect(captureStringIssue("\u0800\u0800", 7)).toEqual(tooLarge(8, 7));
    expect(captureStringIssue("\u{10000}", 5)).toEqual(tooLarge(6, 5));
    expect(withinLimit("abcd", 6)).toBe(6);
    expect(withinLimit("\u0080\u0080", 6)).toBe(6);
    expect(withinLimit("\u0800\u0800", 8)).toBe(8);
    expect(withinLimit("\u{10000}", 6)).toBe(6);

    const unit = "a\u0080\u0800\u{1f600}\u0000";
    const large = unit.repeat(120_000);
    expect(large.length).toBe(720_000);
    expect(normalizeFlarexRuntimeValueV1(large).semanticSizeBytes).toBe(1_320_002);
    expect(() => normalizeFlarexRuntimeValueV1({ body: large }, "appDocument"))
      .toThrowError(expect.objectContaining({
        issue: {
          reason: "valueTooLarge",
          path: '$["body"]',
          profile: "appDocument",
          observedBytes: 1_320_002,
          maximumBytes: MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
        },
      }));
  });
});

function captureStringIssue(value: string, maxSemanticBytes: number): unknown {
  try {
    normalizeFlarexRuntimeValueWithLimitsV1(
      value,
      { ...FLAREX_GENERAL_VALUE_LIMITS_V1, maxSemanticBytes },
      "$.field[0]",
    );
  } catch (cause) {
    expect(cause).toBeInstanceOf(FlarexValueRuntimeCoreV1Error);
    expect((cause as FlarexValueRuntimeCoreV1Error).message)
      .toBe("Flarex Value Codec V1 rejected a runtime value.");
    return (cause as FlarexValueRuntimeCoreV1Error).issue;
  }
  throw new Error("Expected the runtime value core to reject the string.");
}
