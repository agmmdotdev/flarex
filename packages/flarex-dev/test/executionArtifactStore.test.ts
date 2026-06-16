import { describe, expect, it } from "vitest";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  LocalInMemoryExecutionArtifactStore,
  manifestKey,
  R2ExecutionArtifactStore,
  sourcePackageKey,
} from "../src/executionArtifactStore";
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

  it("writes source packages and manifests to an R2-shaped bucket", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2ExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);

    await store.put(ref, sourcePackage);

    expect(bucket.keys()).toEqual([manifestKey(ref), sourcePackageKey(ref)]);
    expect(bucket.contentType(manifestKey(ref))).toBe("application/json");
    expect(bucket.contentType(sourcePackageKey(ref))).toBe("application/json");
    await expect(store.get(ref)).resolves.toEqual(sourcePackage);
  });

  it("rejects R2 writes when the ref does not match the source package", async () => {
    const store = new R2ExecutionArtifactStore(new FakeR2Bucket());
    const sourcePackage = testSourcePackage();
    const ref = {
      ...(await executionArtifactRefForSourcePackage(sourcePackage)),
      sourcePackageHash: "f".repeat(64),
    };

    await expect(store.put(ref, sourcePackage)).rejects.toThrow(
      `Execution artifact ref does not match source package: ${ref.artifactId}`,
    );
  });

  it("fails clearly when R2 artifact metadata is missing or mismatched", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2ExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);

    await expect(store.get(ref)).rejects.toThrow(`Unknown execution artifact: ${ref.artifactId}`);

    await store.put(ref, sourcePackage);
    await bucket.put(manifestKey(ref), JSON.stringify({
      version: 1,
      ref: { ...ref, sourcePackageHash: "0".repeat(64) },
      sourcePackagePath: sourcePackageKey(ref),
    }));

    await expect(store.get(ref)).rejects.toThrow(
      `Execution artifact manifest ref mismatch for ${ref.artifactId}.`,
    );
  });

  it("deletes R2 artifact source package and manifest objects", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2ExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    await store.put(ref, sourcePackage);

    await store.delete(ref);

    expect(bucket.keys()).toEqual([]);
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

class FakeR2Bucket {
  private readonly objects = new Map<string, { value: string; contentType?: string }>();

  async put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    this.objects.set(key, {
      value,
      ...(options?.httpMetadata?.contentType === undefined
        ? {}
        : { contentType: options.httpMetadata.contentType }),
    });
  }

  async get(key: string): Promise<{ json<T>(): Promise<T> } | null> {
    const object = this.objects.get(key);
    if (object === undefined) return null;
    return {
      json: async <T>() => JSON.parse(object.value) as T,
    };
  }

  async delete(key: string | string[]): Promise<void> {
    for (const item of Array.isArray(key) ? key : [key]) {
      this.objects.delete(item);
    }
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  contentType(key: string): string | undefined {
    return this.objects.get(key)?.contentType;
  }
}
