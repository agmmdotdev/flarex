import { describe, expect, expectTypeOf, it } from "vitest";

import { hasExactOwnDataKeys } from "../src/exactOwnDataKeys";

describe("hasExactOwnDataKeys", () => {
  it("narrows an ordinary object with exactly the expected keys", () => {
    const value: unknown = { id: "document", version: 1 };

    expect(hasExactOwnDataKeys(value, ["id", "version"])).toBe(true);
    if (!hasExactOwnDataKeys(value, ["id", "version"])) return;
    expectTypeOf(value).toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
    expect(value.id).toBe("document");
  });

  it("rejects missing, extra, duplicate expected, and symbol keys", () => {
    expect(hasExactOwnDataKeys({ id: 1 }, ["id", "version"])).toBe(false);
    expect(hasExactOwnDataKeys({ id: 1, version: 2 }, ["id"])).toBe(false);
    expect(hasExactOwnDataKeys({ id: 1 }, ["id", "id"])).toBe(false);
    expect(
      hasExactOwnDataKeys({ id: 1, [Symbol("metadata")]: true }, ["id"]),
    ).toBe(false);
  });

  it("accepts every expected string spelling as an own data key", () => {
    const value = {};
    Object.defineProperty(value, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "data",
      writable: true,
    });

    expect(hasExactOwnDataKeys(value, ["__proto__"])).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  it("rejects accessors and non-enumerable properties without reading them", () => {
    let getterReads = 0;
    const accessor = {};
    Object.defineProperty(accessor, "id", {
      enumerable: true,
      get() {
        getterReads += 1;
        return 1;
      },
    });
    const hidden = {};
    Object.defineProperty(hidden, "id", {
      enumerable: false,
      value: 1,
    });

    expect(hasExactOwnDataKeys(accessor, ["id"])).toBe(false);
    expect(getterReads).toBe(0);
    expect(hasExactOwnDataKeys(hidden, ["id"])).toBe(false);
  });

  it("rejects arrays, non-ordinary prototypes, null, and primitives", () => {
    expect(hasExactOwnDataKeys([], [])).toBe(false);
    expect(hasExactOwnDataKeys(Object.create(null), [])).toBe(false);
    expect(hasExactOwnDataKeys(new Date(0), [])).toBe(false);
    expect(hasExactOwnDataKeys(new (class Example {})(), [])).toBe(false);
    expect(hasExactOwnDataKeys(null, [])).toBe(false);
    expect(hasExactOwnDataKeys("value", [])).toBe(false);
  });

  it("preserves native reflection failures from hostile proxies", () => {
    const failure = new Error("getPrototypeOf failed");
    const value = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw failure;
        },
      },
    );

    expect(() => hasExactOwnDataKeys(value, [])).toThrow(failure);
  });
});
