import { describe, expect, it, vi } from "vitest";

import { decodeExactH05StringTuple } from "../h05/exactStringTuple";

function unexpectedFailure(message: string): never {
  throw new Error(`Unexpected H05 tuple failure: ${message}`);
}

describe("H05 exact string tuple policy", () => {
  it("returns the expected tuple by identity for exact and empty arrays", () => {
    const fail = vi.fn(unexpectedFailure);
    const expected = ["first", "second"] as const;
    const empty = [] as const;

    expect(decodeExactH05StringTuple(
      ["first", "second"],
      expected,
      "services",
      fail,
    )).toBe(expected);
    expect(decodeExactH05StringTuple([], empty, "flags", fail)).toBe(empty);
    expect(fail).not.toHaveBeenCalled();
  });

  it.each([
    { value: "first", name: "a non-array" },
    { value: ["first"], name: "a shorter array" },
    { value: ["first", "second", "third"], name: "a longer array" },
    { value: ["second", "first"], name: "different ordering" },
  ])("rejects $name with the exact owner diagnostic", ({ value }) => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });

    expect(() => decodeExactH05StringTuple(
      value,
      ["first", "second"],
      "services",
      fail,
    )).toThrow(failure);
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(
      'services must equal ["first","second"].',
    );
  });

  it("preserves sparse-array skipping and returns the expected tuple", () => {
    const fail = vi.fn(unexpectedFailure);
    const value = new Array<string>(2);
    value[1] = "second";
    const expected = ["first", "second"] as const;

    expect(decodeExactH05StringTuple(value, expected, "services", fail)).toBe(
      expected,
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it("preserves array-owned some dispatch", () => {
    const fail = vi.fn(unexpectedFailure);
    const value = ["wrong"];
    const some = vi.fn(() => false);
    Object.defineProperty(value, "some", { value: some });
    const expected = ["expected"] as const;

    expect(decodeExactH05StringTuple(value, expected, "services", fail)).toBe(
      expected,
    );
    expect(some).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
  });

  it("stops element reads after the first mismatch", () => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });
    const value = ["wrong", "second"];
    const secondRead = vi.fn(() => "second");
    Object.defineProperty(value, 1, { get: secondRead });

    expect(() => decodeExactH05StringTuple(
      value,
      ["first", "second"],
      "services",
      fail,
    )).toThrow(failure);
    expect(secondRead).not.toHaveBeenCalled();
  });

  it("preserves native failures from an invalid array-owned some method", () => {
    const fail = vi.fn(unexpectedFailure);
    const value = ["first"];
    Object.defineProperty(value, "some", { value: undefined });

    expect(() => decodeExactH05StringTuple(
      value,
      ["first"],
      "services",
      fail,
    )).toThrow(TypeError);
    expect(fail).not.toHaveBeenCalled();
  });
});
