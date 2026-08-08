import { describe, expect, it } from "vitest";

import {
  canonicalFlarexRuntimeValueToJsonV1,
  FlarexValueRuntimeCoreV1Error,
  normalizeFlarexRuntimeValueV1,
} from "../src/value-runtime-core";
import {
  FlarexValueCodecV1Error,
  normalizeFlarexValueV1,
} from "../src/value";

describe("Effect-free Flarex value runtime core", () => {
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
