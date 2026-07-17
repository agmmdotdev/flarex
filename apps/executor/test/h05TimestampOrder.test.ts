import { describe, expect, it, vi } from "vitest";

import { requireOrderedH05Timestamps } from "../h05/timestampOrder";

describe("H05 timestamp ordering policy", () => {
  it("accepts increasing and equal decoded timestamps without failing", () => {
    const fail = vi.fn<(message: string) => never>();

    requireOrderedH05Timestamps(
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:00:01.000Z",
      "window",
      fail,
    );
    requireOrderedH05Timestamps(
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:00:00.000Z",
      "window",
      fail,
    );

    expect(fail).not.toHaveBeenCalled();
  });

  it("delegates the exact out-of-order diagnostic to the owning decoder", () => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });

    expect(() => requireOrderedH05Timestamps(
      "2026-07-18T10:00:01.000Z",
      "2026-07-18T10:00:00.000Z",
      "trace window",
      fail,
    )).toThrow(failure);
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(
      "trace window timestamps are out of order.",
    );
  });

  it("does not become a second timestamp validator", () => {
    const fail = vi.fn<(message: string) => never>();

    requireOrderedH05Timestamps(
      "not-a-timestamp",
      "2026-07-18T10:00:00.000Z",
      "window",
      fail,
    );
    requireOrderedH05Timestamps(
      "2026-07-18T10:00:00.000Z",
      "not-a-timestamp",
      "window",
      fail,
    );

    expect(fail).not.toHaveBeenCalled();
  });
});
