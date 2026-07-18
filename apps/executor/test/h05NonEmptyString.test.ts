import { describe, expect, it, vi } from "vitest";

import { decodeNonEmptyH05String } from "../h05/nonEmptyString";

function unexpectedFailure(message: string): never {
  throw new Error(`Unexpected H05 string failure: ${message}`);
}

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the H05 string decoder to fail.");
}

describe("H05 non-empty string policy", () => {
  it("accepts non-empty strings without normalization", () => {
    const fail = vi.fn(unexpectedFailure);

    expect(decodeNonEmptyH05String("value", "field", fail)).toBe("value");
    expect(decodeNonEmptyH05String("   ", "field", fail)).toBe("   ");
    expect(fail).not.toHaveBeenCalled();
  });

  it("delegates empty and non-string failures with the exact path", () => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });

    expect(captureThrown(() =>
      decodeNonEmptyH05String("", "source.commit", fail)
    )).toBe(failure);
    expect(captureThrown(() =>
      decodeNonEmptyH05String(1, "source.commit", fail)
    )).toBe(failure);
    expect(fail).toHaveBeenNthCalledWith(
      1,
      "source.commit must be a non-empty string.",
    );
    expect(fail).toHaveBeenNthCalledWith(
      2,
      "source.commit must be a non-empty string.",
    );
  });
});
