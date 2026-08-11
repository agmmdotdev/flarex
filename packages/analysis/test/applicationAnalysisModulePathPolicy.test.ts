import { describe, expect, it } from "vitest";

import { findApplicationAnalysisFrameworkShimCollision } from "../src/applicationAnalysisModulePathPolicy";

describe("Application Analysis module path policy", () => {
  it("finds root, nested, and generated-directory shim collisions", () => {
    expect(findApplicationAnalysisFrameworkShimCollision([
      "functions.js",
      "flarex/server",
    ])).toBe("flarex/server");
    expect(findApplicationAnalysisFrameworkShimCollision([
      "nested/functions.js",
      "nested/flarex/values",
    ])).toBe("nested/flarex/values");
    expect(findApplicationAnalysisFrameworkShimCollision([
      "_flarex/application.js",
      "_flarex/flarex/server",
    ])).toBe("_flarex/flarex/server");
  });

  it("accepts framework-like paths outside an importing directory", () => {
    expect(findApplicationAnalysisFrameworkShimCollision([
      "nested/functions.js",
      "other/flarex/server",
    ])).toBeUndefined();
  });
});
