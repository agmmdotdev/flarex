import { describe, expect, it } from "vitest";
import { LocalInMemoryExecutionArtifactStore } from "../src/executionArtifactStore";
import type { SourcePackage } from "../src/sourcePackage";

describe("local execution artifact store", () => {
  it("stores and retrieves source packages by deterministic artifact ref", async () => {
    const store = new LocalInMemoryExecutionArtifactStore();
    const sourcePackage = testSourcePackage();

    const ref = await store.put(sourcePackage);
    await expect(store.put(testSourcePackage())).resolves.toEqual(ref);
    await expect(store.get(ref)).resolves.toEqual(sourcePackage);
  });

  it("returns cloned source packages", async () => {
    const store = new LocalInMemoryExecutionArtifactStore();
    const ref = await store.put(testSourcePackage());

    const retrieved = await store.get(ref);
    retrieved.modules[0]!.sha256 = "f".repeat(64);

    await expect(store.get(ref)).resolves.toEqual(testSourcePackage());
  });

  it("fails clearly for unknown artifact refs", async () => {
    const store = new LocalInMemoryExecutionArtifactStore();

    await expect(
      store.get({
        runtime: "dynamic-worker",
        artifactId: "artifact_1234567890abcdef1234567890abcdef",
        sourcePackageHash: "a".repeat(64),
        executionModule: "_flarex/execution.js",
      }),
    ).rejects.toThrow("Unknown execution artifact: artifact_1234567890abcdef1234567890abcdef");
  });
});

function testSourcePackage(): SourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        source: "export default {};",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
      {
        path: "lessons.js",
        source: "export const list = {};",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    functions: ["lessons.js"],
    execution: "_flarex/execution.js",
  };
}
