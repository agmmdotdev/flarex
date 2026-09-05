import { describe, expect, it } from "vitest";
import { frameworkTestWorkers } from "./frameworkTestWorkers";

describe("framework test worker budget", () => {
  const input = { native: false, freeMemoryBytes: 8 * 1024 ** 3,
    availableProcessors: 4, requestedWorkers: undefined };

  it("uses two workers only within the driver memory and CPU budget", () => {
    expect(frameworkTestWorkers(input)).toBe(2);
    expect(frameworkTestWorkers({ ...input, freeMemoryBytes: 6 * 1024 ** 3 })).toBe(1);
    expect(frameworkTestWorkers({ ...input, native: true, freeMemoryBytes: 4 * 1024 ** 3 })).toBe(2);
    expect(frameworkTestWorkers({ ...input, native: true, freeMemoryBytes: 3 * 1024 ** 3 })).toBe(1);
    expect(frameworkTestWorkers({ ...input, availableProcessors: 1 })).toBe(1);
  });

  it("preserves serial override and refuses an invalid worker request", () => {
    expect(frameworkTestWorkers({ ...input, requestedWorkers: "1" })).toBe(1);
    expect(frameworkTestWorkers({ ...input, requestedWorkers: "2", freeMemoryBytes: 0 })).toBe(1);
    expect(() => frameworkTestWorkers({ ...input, requestedWorkers: "8" }))
      .toThrow("FLAREX_TEST_WORKERS must be 1 or 2");
  });
});
