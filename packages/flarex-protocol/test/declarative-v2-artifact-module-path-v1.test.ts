import { Result } from "effect";
import { describe, expect, test } from "vitest";

import {
  decodeDeclarativeV2ArtifactModulePathV1,
  isDeclarativeV2ArtifactModulePathV1,
} from "../src/declarative-v2-artifact-module-path-v1";

describe("Declarative V2 artifact module path V1 protocol verdict", () => {
  test.each([
    "a.js",
    "functions/example.js",
    "functions/မြန်မာ.js",
    "é/λ",
  ])("admits the canonical spelling %s", (spelling) => {
    const decoded = decodeDeclarativeV2ArtifactModulePathV1(spelling);
    expect(decoded).toEqual(Result.succeed(spelling));
    expect(isDeclarativeV2ArtifactModulePathV1(spelling)).toBe(true);
  });

  test.each([
    "",
    "/a.js",
    "a.js/",
    "a//b.js",
    "./a.js",
    "../a.js",
    "a/./b.js",
    "a/../b.js",
    ".",
    "..",
    String.raw`a\b.js`,
    "\ud800.js",
    "\udc00.js",
    "a/\ud800",
    "\ud800",
  ])("rejects the noncanonical spelling %j", (spelling) => {
    const decoded = decodeDeclarativeV2ArtifactModulePathV1(spelling);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.reason).toBe("invalidPath");
    }
    expect(isDeclarativeV2ArtifactModulePathV1(spelling)).toBe(false);
  });

  test("distinguishes a non-string input from an invalid spelling", () => {
    const decoded = decodeDeclarativeV2ArtifactModulePathV1(new String("a.js"));
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure.reason).toBe("invalidInput");
    }
  });
});
