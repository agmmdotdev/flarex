import { describe, expect, it } from "vitest";

import {
  canonicalFlarexRuntimeValueToJsonV1,
  createOwnedCanonicalFlarexRuntimeValueReaderV1,
  createOwnedCanonicalFlarexRuntimeValueProjectionV1,
  FlarexValueRuntimeCoreV1Error,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexRuntimeValueV1,
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
});
