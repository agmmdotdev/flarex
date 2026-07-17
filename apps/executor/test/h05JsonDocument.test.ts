import { describe, expect, it } from "vitest";

import { formatH05JsonDocument } from "../h05/jsonDocument";

describe("H05 JSON document format", () => {
  it("preserves key order with two-space indentation and one trailing newline", () => {
    expect(formatH05JsonDocument({ second: 2, first: [1] })).toBe(
      '{\n  "second": 2,\n  "first": [\n    1\n  ]\n}\n',
    );
  });

  it("preserves JSON.stringify undefined behavior", () => {
    expect(formatH05JsonDocument(undefined)).toBe("undefined\n");
  });

  it("preserves native cyclic and bigint failures", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => formatH05JsonDocument(cyclic)).toThrow(TypeError);
    expect(() => formatH05JsonDocument(1n)).toThrow(TypeError);
  });
});
