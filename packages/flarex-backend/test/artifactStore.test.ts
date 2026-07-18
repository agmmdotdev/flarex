import {
  executionArtifactManifestKey,
  executionArtifactRefForSourcePackage,
  executionArtifactSourcePackageKey,
} from "flarex/artifacts";
import { describe, expect, it } from "vitest";
import { R2BackendExecutionArtifactStore } from "../src/artifactStore";
import type { PushSourcePackage } from "../src/types";

describe("backend execution artifact store", () => {
  it("stores source packages by deterministic execution artifact reference", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await store.put(sourcePackage);

    expect(ref).toEqual(await executionArtifactRefForSourcePackage(sourcePackage));
    expect(bucket.keys()).toEqual([
      executionArtifactManifestKey(ref),
      executionArtifactSourcePackageKey(ref),
    ]);
    expect(bucket.contentType(executionArtifactManifestKey(ref))).toBe(
      "application/json",
    );
    expect(bucket.contentType(executionArtifactSourcePackageKey(ref))).toBe(
      "application/json",
    );
    await expect(store.get(ref)).resolves.toEqual(sourcePackage);
  });

  it("rejects missing artifacts", async () => {
    const sourcePackage = testSourcePackage();
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);

    await expect(
      new R2BackendExecutionArtifactStore(new FakeR2Bucket()).get(ref),
    ).rejects.toThrow(`Unknown execution artifact: ${ref.artifactId}`);
  });

  it("rejects source packages that no longer match the requested ref", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await store.put(sourcePackage);
    await bucket.put(
      executionArtifactSourcePackageKey(ref),
      JSON.stringify(testSourcePackage("f".repeat(64))),
    );

    await expect(store.get(ref)).rejects.toThrow(
      `Execution artifact ref does not match source package: ${ref.artifactId}`,
    );
  });

  it("rejects manifest ref mismatches", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await store.put(sourcePackage);
    await bucket.put(executionArtifactManifestKey(ref), JSON.stringify({
      version: 1,
      ref: { ...ref, sourcePackageHash: "0".repeat(64) },
      sourcePackagePath: executionArtifactSourcePackageKey(ref),
    }));

    await expect(store.get(ref)).rejects.toThrow(
      `Execution artifact manifest ref mismatch for ${ref.artifactId}`,
    );
  });

  it("deletes artifact source package and manifest objects", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const ref = await store.put(testSourcePackage());

    await store.delete(ref);

    expect(bucket.keys()).toEqual([]);
  });
});

function testSourcePackage(functionModuleHash = "c".repeat(64)): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "_flarex/schema.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export default {};",
      },
      {
        path: "lessons.js",
        environment: "isolate",
        sha256: functionModuleHash,
        source: "export const list = {};",
      },
    ],
    functions: ["lessons.js"],
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

class FakeR2Bucket {
  private readonly objects = new Map<string, { value: unknown; contentType?: string }>();

  async put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const contentType = options?.httpMetadata?.contentType;
    this.objects.set(key, {
      value: JSON.parse(value) as unknown,
      ...(contentType === undefined ? {} : { contentType }),
    });
  }

  async get(key: string): Promise<{ json<T>(): Promise<T> } | null> {
    const object = this.objects.get(key);
    if (object === undefined) return null;
    return {
      json: async <T>() => object.value as T,
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
