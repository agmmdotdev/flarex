import { describe, expect, it } from "vitest";

import { isPlainRecord } from "../src/plainRecord";

describe("executor plain-record policy", () => {
  it("accepts ordinary and null-prototype records", () => {
    expect(isPlainRecord({ value: 1 })).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
  });

  it("rejects non-record and custom-prototype values", () => {
    for (const value of [
      null,
      [],
      new Date(0),
      Object.create({ inherited: true }),
    ]) {
      expect(isPlainRecord(value)).toBe(false);
    }
  });

  it("leaves symbol and property-shape policy to the owning decoder", () => {
    const symbolRecord = { [Symbol("evidence")]: true };
    const accessorRecord = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });

    expect(isPlainRecord(symbolRecord)).toBe(true);
    expect(isPlainRecord(accessorRecord)).toBe(true);
  });

  it("preserves native prototype-reflection failures", () => {
    const cause = new Error("prototype trap failed");
    const throwingProxy = new Proxy({}, {
      getPrototypeOf: () => {
        throw cause;
      },
    });
    const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => isPlainRecord(throwingProxy)).toThrow(cause);
    expect(() => isPlainRecord(revokedProxy)).toThrow(TypeError);
  });
});
