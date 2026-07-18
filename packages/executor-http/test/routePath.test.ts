import { describe, expect, it } from "vitest";

import { normalizeExecutorHttpRoutePath } from "../src/routePath";

describe("normalizeExecutorHttpRoutePath", () => {
  it.each([
    ["/", "/"],
    ["health", "/health"],
    ["/health", "/health"],
    ["health///", "/health"],
    ["/maintenance//health///", "/maintenance//health"],
    ["", "/"],
  ])("normalizes %j to %j", (path, expected) => {
    expect(normalizeExecutorHttpRoutePath(path)).toBe(expected);
  });
});
