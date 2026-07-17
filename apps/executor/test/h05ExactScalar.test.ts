import { describe, expect, it, vi } from "vitest";

import { decodeExactH05Scalar } from "../h05/exactScalar";

function unexpectedFailure(message: string): never {
  throw new Error(`Unexpected H05 scalar failure: ${message}`);
}

describe("H05 exact scalar policy", () => {
  it("accepts exact string, number, and boolean values", () => {
    const fail = vi.fn(unexpectedFailure);

    expect(decodeExactH05Scalar("ready", "ready", "state", fail)).toBe(
      "ready",
    );
    expect(decodeExactH05Scalar(200, 200, "status", fail)).toBe(200);
    expect(decodeExactH05Scalar(false, false, "cached", fail)).toBe(false);
    expect(fail).not.toHaveBeenCalled();
  });

  it("uses strict equality without coercion", () => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });

    expect(() => decodeExactH05Scalar("200", 200, "status", fail)).toThrow(
      failure,
    );
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith("status must equal 200.");
  });

  it("preserves strict-equality edge cases and returns the expected value", () => {
    const fail = vi.fn(unexpectedFailure);
    const decoded = decodeExactH05Scalar(0, -0, "offset", fail);

    expect(Object.is(decoded, -0)).toBe(true);
    expect(fail).not.toHaveBeenCalled();

    expect(() => decodeExactH05Scalar(
      Number.NaN,
      Number.NaN,
      "measurement",
      fail,
    )).toThrow("measurement must equal null.");
  });

  it("renders string and boolean diagnostics with JSON spelling", () => {
    const messages: string[] = [];
    const fail = (message: string): never => {
      messages.push(message);
      throw new Error(message);
    };

    expect(() => decodeExactH05Scalar("no", "yes", "answer", fail)).toThrow();
    expect(() => decodeExactH05Scalar(true, false, "cached", fail)).toThrow();
    expect(messages).toEqual([
      'answer must equal "yes".',
      "cached must equal false.",
    ]);
  });
});
