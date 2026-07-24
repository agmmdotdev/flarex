import {
  executionArtifactManifestKey,
  executionArtifactRefForSourcePackage,
  executionArtifactSourcePackageKey,
} from "flarex/artifacts";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BackendExecutionArtifactIntegrityError,
  R2BackendExecutionArtifactStore,
} from "../src/artifactStore";
import type { PushSourcePackage } from "../src/types";
import { sourceModuleSha256ForTest } from "./sourcePackageHashFixture";

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

    const failure = await store.get(ref).then(
      () => undefined,
      cause => cause,
    );
    expect(failure).toMatchObject({
      _tag: "BackendExecutionArtifactIntegrityError",
      artifactId: ref.artifactId,
    } satisfies Partial<BackendExecutionArtifactIntegrityError>);
    expect(failure.cause).toMatchObject({
      message: `Execution artifact ref does not match source package: ${ref.artifactId}`,
    });
  });

  it("classifies missing or malformed stored source objects as integrity failures", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await store.put(sourcePackage);
    const sourcePackageKey = executionArtifactSourcePackageKey(ref);

    await bucket.delete(sourcePackageKey);
    await expect(store.get(ref)).rejects.toMatchObject({
      _tag: "BackendExecutionArtifactIntegrityError",
      artifactId: ref.artifactId,
      cause: {
        message: `Execution artifact source package is missing: ${ref.artifactId}`,
      },
    } satisfies Partial<BackendExecutionArtifactIntegrityError>);

    await bucket.put(sourcePackageKey, "{");
    await expect(store.get(ref)).rejects.toMatchObject({
      _tag: "BackendExecutionArtifactIntegrityError",
      artifactId: ref.artifactId,
      cause: {
        name: "SyntaxError",
      },
    } satisfies Partial<BackendExecutionArtifactIntegrityError>);
  });

  it("preserves R2 object and body acquisition failures as load failures", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const ref = await store.put(sourcePackage);
    const objectFailure = new Error("R2 unavailable");
    bucket.failGet(executionArtifactManifestKey(ref), objectFailure);

    await expect(store.get(ref)).rejects.toBe(objectFailure);

    bucket.clearGetFailure(executionArtifactManifestKey(ref));
    const bodyFailure = new Error("R2 body unavailable");
    bucket.failText(executionArtifactManifestKey(ref), bodyFailure);
    await expect(store.get(ref)).rejects.toBe(bodyFailure);
  });

  it("rejects mismatched module bytes before publishing any artifact objects", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    sourcePackage.modules[0] = {
      ...sourcePackage.modules[0]!,
      source: "export default { tampered: true };",
    };

    await expect(store.put(sourcePackage)).rejects.toThrow(
      "Execution artifact module digest mismatch for _flarex/execution.js",
    );
    expect(bucket.keys()).toEqual([]);
  });

  it("snapshots caller-owned source packages before asynchronous validation", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const sourcePackage = testSourcePackage();
    const executionModule = sourcePackage.modules[0]!;
    const originalSource = executionModule.source;
    let visibleSource = originalSource;
    Object.defineProperty(executionModule, "source", {
      configurable: true,
      enumerable: true,
      get() {
        queueMicrotask(() => {
          visibleSource = "export default { tampered: true };";
        });
        return visibleSource;
      },
    });

    const ref = await store.put(sourcePackage);

    expect(visibleSource).not.toBe(originalSource);
    const stored = await store.get(ref);
    expect(stored.modules[0]).toMatchObject({
      path: "_flarex/execution.js",
      source: originalSource,
    });
  });

  it("requires framed digests for new artifacts but reads legacy stored artifacts", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const framed = testSourcePackage();
    const {
      sourceModuleDigestFormat: _format,
      ...legacyPackage
    } = framed;
    legacyPackage.modules = legacyPackage.modules.map(module => ({
      ...module,
      sha256: legacySourceModuleSha256(
        module.source ?? "",
        module.sourceMap,
      ),
    }));

    await expect(store.put(legacyPackage)).rejects.toThrow(
      "New execution artifacts require framed V1 source-module digests.",
    );
    expect(bucket.keys()).toEqual([]);

    const legacyRef = await executionArtifactRefForSourcePackage(legacyPackage);
    const sourcePackagePath = executionArtifactSourcePackageKey(legacyRef);
    await bucket.put(sourcePackagePath, JSON.stringify(legacyPackage));
    await bucket.put(
      executionArtifactManifestKey(legacyRef),
      JSON.stringify({
        version: 1,
        ref: legacyRef,
        sourcePackagePath,
      }),
    );
    await expect(store.get(legacyRef)).resolves.toEqual(legacyPackage);
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

    const failure = await store.get(ref).then(
      () => undefined,
      cause => cause,
    );
    expect(failure).toMatchObject({
      _tag: "BackendExecutionArtifactIntegrityError",
      artifactId: ref.artifactId,
    } satisfies Partial<BackendExecutionArtifactIntegrityError>);
    expect(failure.cause).toMatchObject({
      message: `Execution artifact manifest ref mismatch for ${ref.artifactId}.`,
    });
  });

  it("deletes artifact source package and manifest objects", async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BackendExecutionArtifactStore(bucket);
    const ref = await store.put(testSourcePackage());

    await store.delete(ref);

    expect(bucket.keys()).toEqual([]);
  });
});

function testSourcePackage(
  functionModuleHash = sourceModuleSha256ForTest("export const list = {};"),
): PushSourcePackage {
  return {
    sourceModuleDigestFormat: "sha256-framed-v1",
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export default {};"),
        source: "export default {};",
      },
      {
        path: "_flarex/schema.js",
        environment: "isolate",
        sha256: sourceModuleSha256ForTest("export default {};"),
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

function legacySourceModuleSha256(
  source: string,
  sourceMap?: string,
): string {
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(sourceMap ?? "")
    .digest("hex");
}

class FakeR2Bucket {
  private readonly objects = new Map<string, { value: string; contentType?: string }>();
  private readonly getFailures = new Map<string, Error>();
  private readonly textFailures = new Map<string, Error>();

  async put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    const contentType = options?.httpMetadata?.contentType;
    this.objects.set(key, {
      value,
      ...(contentType === undefined ? {} : { contentType }),
    });
  }

  async get(key: string): Promise<{ text(): Promise<string> } | null> {
    const getFailure = this.getFailures.get(key);
    if (getFailure !== undefined) throw getFailure;
    const object = this.objects.get(key);
    if (object === undefined) return null;
    const textFailure = this.textFailures.get(key);
    return {
      text: async () => {
        if (textFailure !== undefined) throw textFailure;
        return object.value;
      },
    };
  }

  async delete(key: string | string[]): Promise<void> {
    for (const item of Array.isArray(key) ? key : [key]) {
      this.objects.delete(item);
      this.textFailures.delete(item);
    }
  }

  failText(key: string, failure: Error): void {
    this.textFailures.set(key, failure);
  }

  failGet(key: string, failure: Error): void {
    this.getFailures.set(key, failure);
  }

  clearGetFailure(key: string): void {
    this.getFailures.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  contentType(key: string): string | undefined {
    return this.objects.get(key)?.contentType;
  }
}
