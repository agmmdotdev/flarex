import { describe, expect, it } from "vitest";
import {
  assertExecutionArtifactRefMatchesSourcePackage,
  executionArtifactRefForSourcePackage,
  executionArtifactRefsEqual,
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

  it("compares execution artifact ref fields that can differ between typed refs", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());

    expect(executionArtifactRefsEqual(ref, { ...ref })).toBe(true);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        artifactId: "artifact_ffffffffffffffffffffffffffffffff",
      }),
    ).toBe(false);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        executionModule: "_flarex/other-execution.js",
      }),
    ).toBe(false);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        sourcePackageHash: "f".repeat(64),
      }),
    ).toBe(false);
  });

  it("asserts refs against the source package that produced them", async () => {
    const package_ = sourcePackage();
    const ref = await executionArtifactRefForSourcePackage(package_);

    await expect(
      assertExecutionArtifactRefMatchesSourcePackage(ref, package_),
    ).resolves.toBeUndefined();
    await expect(
      assertExecutionArtifactRefMatchesSourcePackage(
        {
          ...ref,
          executionModule: "_flarex/other-execution.js",
        },
        package_,
      ),
    ).rejects.toThrow(`Execution artifact ref does not match source package: ${ref.artifactId}`);
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
