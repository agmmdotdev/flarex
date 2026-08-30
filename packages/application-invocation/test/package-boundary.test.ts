import manifest from "../package.json";
import { describe, expect, it } from "vitest";

import * as applicationInvocation from "../src/index.js";

describe("Application invocation package boundary", () => {
  it("ships one unversioned root over the existing invocation owners", () => {
    expect(manifest.name).toBe("@flarex/application-invocation");
    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
      "./internal/task-run": "./src/internal/task-run.ts",
    });
    expect(manifest.dependencies).toEqual({
      "@flarex/application-definition": "workspace:*",
      "@flarex/standard-application-invocation": "workspace:*",
      "effect": "catalog:",
      "flarex-protocol": "workspace:*",
    });
  });

  it("exposes only the plain runtime operations", () => {
    expect(Object.keys(applicationInvocation).toSorted()).toEqual([
      "awaitTask",
      "cancelTask",
      "inspectTask",
      "listTaskAttempts",
      "listTaskEvents",
      "listTaskRuns",
      "readTaskResult",
      "runAction",
      "runMutation",
      "runQuery",
      "startTask",
    ]);
    expect(Object.keys(applicationInvocation).some(name =>
      /standard|point|system|invoke|execute|v\d/iu.test(name)
    )).toBe(false);
  });
});
