import { afterEach, describe, expect, it, vi } from "vitest";

import { elapsedPerformanceDurationSince } from "../src/performanceDuration";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probe host performance duration", () => {
  it("returns one positive finite elapsed duration", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(12.5);

    expect(elapsedPerformanceDurationSince(10)).toBe(2.5);
    expect(now).toHaveBeenCalledOnce();
  });

  it("clamps non-positive and non-finite durations to positive zero", () => {
    const now = vi.spyOn(performance, "now");

    now.mockReturnValueOnce(10);
    expect(Object.is(elapsedPerformanceDurationSince(10), 0)).toBe(true);
    now.mockReturnValueOnce(9);
    expect(Object.is(elapsedPerformanceDurationSince(10), 0)).toBe(true);
    now.mockReturnValueOnce(Number.POSITIVE_INFINITY);
    expect(Object.is(elapsedPerformanceDurationSince(10), 0)).toBe(true);
    now.mockReturnValueOnce(Number.NaN);
    expect(Object.is(elapsedPerformanceDurationSince(10), 0)).toBe(true);
    now.mockReturnValueOnce(-0);
    expect(Object.is(elapsedPerformanceDurationSince(0), 0)).toBe(true);
    expect(now).toHaveBeenCalledTimes(5);
  });

  it("preserves native host-clock failures", () => {
    const cause = new Error("performance clock failed");
    vi.spyOn(performance, "now").mockImplementation(() => {
      throw cause;
    });

    expect(() => elapsedPerformanceDurationSince(0)).toThrow(cause);
  });
});
