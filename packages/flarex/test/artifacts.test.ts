import { describe, expect, it } from "vitest";
import {
  executionArtifactRefForSourcePackage,
  stableSourcePackageManifest,
  type ArtifactSourcePackage,
} from "../src/artifacts";

describe("execution artifact refs", () => {
  it("derives stable refs from the source package manifest", async () => {
    const first = sourcePackage();
    const reordered = {
      ...first,
      modules: [...first.modules].reverse(),
      functions: [...first.functions].reverse(),
    };

    await expect(executionArtifactRefForSourcePackage(reordered)).resolves.toEqual(
      await executionArtifactRefForSourcePackage(first),
    );
    expect(stableSourcePackageManifest(reordered)).toBe(stableSourcePackageManifest(first));
  });

  it("changes refs when a module hash changes", async () => {
    const first = await executionArtifactRefForSourcePackage(sourcePackage("a".repeat(64)));
    const second = await executionArtifactRefForSourcePackage(sourcePackage("b".repeat(64)));

    expect(second).not.toEqual(first);
    expect(second).toMatchObject({
      runtime: "dynamic-worker",
      artifactId: expect.stringMatching(/^artifact_[a-f0-9]{32}$/),
      sourcePackageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      executionModule: "_flarex/execution.js",
    });
  });
});

function sourcePackage(functionHash = "a".repeat(64)): ArtifactSourcePackage {
  return {
    modules: [
      { path: "_flarex/execution.js", environment: "isolate", sha256: "0".repeat(64) },
      { path: "_flarex/schema.js", environment: "isolate", sha256: "1".repeat(64) },
      { path: "lessons.js", environment: "isolate", sha256: functionHash },
    ],
    functions: ["lessons.js"],
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}
