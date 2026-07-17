import { describe, expect, it, vi } from "vitest";

import { requireExactH05Record } from "../h05/exactRecord";

function failAt(path: string, message: string): never {
  throw new Error(`${path} ${message}`);
}

describe("H05 exact record policy", () => {
  it("returns the same ordinary or null-prototype record independent of key order", () => {
    const ordinary = { second: 2, first: 1 };
    const nullPrototype = Object.assign(Object.create(null), { first: 1 });
    const expectedKeys = ["first", "second"] as const;

    expect(requireExactH05Record(
      ordinary,
      "$",
      expectedKeys,
      failAt,
    )).toBe(ordinary);
    expect(requireExactH05Record(
      nullPrototype,
      "$",
      ["first"],
      failAt,
    )).toBe(nullPrototype);
    expect(expectedKeys).toEqual(["first", "second"]);
  });

  it("ignores symbols and non-enumerable keys without reading accessors", () => {
    const getter = vi.fn(() => 1);
    const record = Object.defineProperties(
      { [Symbol("evidence")]: true },
      {
        visible: { enumerable: true, get: getter },
        hidden: { enumerable: false, value: true },
      },
    );

    expect(requireExactH05Record(
      record,
      "$",
      ["visible"],
      failAt,
    )).toBe(record);
    expect(getter).not.toHaveBeenCalled();
  });

  it("preserves standard object and exact-key failures", () => {
    expect(() => requireExactH05Record([], "$", [], failAt)).toThrow(
      "$ must be an object.",
    );
    expect(() => requireExactH05Record(
      { first: 1 },
      "$",
      ["second", "first"],
      failAt,
    )).toThrow("$ must contain exactly: first, second.");
    expect(() => requireExactH05Record(
      { first: 1 },
      "$",
      ["first", "first"],
      failAt,
    )).toThrow("$ must contain exactly: first, first.");
  });

  it("preserves native key-reflection failures", () => {
    const cause = new Error("ownKeys failed");
    const throwingProxy = new Proxy({}, {
      ownKeys: () => {
        throw cause;
      },
    });
    const { proxy: revokedProxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(() => requireExactH05Record(
      throwingProxy,
      "$",
      [],
      failAt,
    )).toThrow(cause);
    expect(() => requireExactH05Record(
      revokedProxy,
      "$",
      [],
      failAt,
    )).toThrow(TypeError);
  });
});
