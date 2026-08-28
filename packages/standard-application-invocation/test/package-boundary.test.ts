import manifest from "../package.json";
import { describe, expect, it } from "vitest";

describe("Standard Application invocation package boundary", () => {
  it("exposes only internal owner contracts", () => {
    const exports = Object.entries(manifest.exports);

    expect(exports).not.toContainEqual(["./v1", "./src/v1.ts"]);
    expect(exports.every(([subpath]) => subpath.startsWith("./internal/")))
      .toBe(true);
    expect(exports.some(([, source]) => source === "./src/v1.ts")).toBe(false);
  });
});
