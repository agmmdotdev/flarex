import {
  assertExecutionArtifactRefMatchesSourcePackage,
  executionArtifactRefForSourcePackage,
  executionArtifactRefsEqual,
  type ExecutionArtifactRef,
} from "flarex/artifacts";
import type { SourcePackage } from "./sourcePackage.ts";

export interface ExecutionArtifactStore {
  put(sourcePackage: SourcePackage): Promise<ExecutionArtifactRef>;
  get(ref: ExecutionArtifactRef): Promise<SourcePackage>;
}

export interface DurableExecutionArtifactStore {
  put(ref: ExecutionArtifactRef, sourcePackage: SourcePackage): Promise<void>;
  get(ref: ExecutionArtifactRef): Promise<SourcePackage>;
  delete(ref: ExecutionArtifactRef): Promise<void>;
}

type R2BucketLike = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
  delete(key: string | string[]): Promise<unknown>;
};

type StoredExecutionArtifactManifest = {
  version: 1;
  ref: ExecutionArtifactRef;
  sourcePackagePath: string;
};

export class LocalInMemoryExecutionArtifactStore implements ExecutionArtifactStore {
  private readonly packages = new Map<string, SourcePackage>();

  async put(sourcePackage: SourcePackage): Promise<ExecutionArtifactRef> {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    this.packages.set(ref.artifactId, cloneSourcePackage(sourcePackage));
    return ref;
  }

  async get(ref: ExecutionArtifactRef): Promise<SourcePackage> {
    const sourcePackage = this.packages.get(ref.artifactId);
    if (sourcePackage === undefined) {
      throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
    }
    await assertExecutionArtifactRefMatchesSourcePackage(ref, sourcePackage);
    return cloneSourcePackage(sourcePackage);
  }
}

export class R2ExecutionArtifactStore implements DurableExecutionArtifactStore {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async put(ref: ExecutionArtifactRef, sourcePackage: SourcePackage): Promise<void> {
    await assertExecutionArtifactRefMatchesSourcePackage(ref, sourcePackage);
    const sourcePackagePath = sourcePackageKey(ref);
    const manifest: StoredExecutionArtifactManifest = {
      version: 1,
      ref,
      sourcePackagePath,
    };
    await Promise.all([
      this.putJson(sourcePackagePath, sourcePackage),
      this.putJson(manifestKey(ref), manifest),
    ]);
  }

  async get(ref: ExecutionArtifactRef): Promise<SourcePackage> {
    const manifest = await this.getJson<StoredExecutionArtifactManifest>(manifestKey(ref));
    if (manifest === null) {
      throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
    }
    validateStoredManifest(ref, manifest);
    const sourcePackage = await this.getJson<SourcePackage>(manifest.sourcePackagePath);
    if (sourcePackage === null) {
      throw new Error(`Execution artifact source package is missing: ${ref.artifactId}`);
    }
    await assertExecutionArtifactRefMatchesSourcePackage(ref, sourcePackage);
    return cloneSourcePackage(sourcePackage);
  }

  async delete(ref: ExecutionArtifactRef): Promise<void> {
    await this.bucket.delete([manifestKey(ref), sourcePackageKey(ref)]);
  }

  private putJson(key: string, value: unknown): Promise<unknown> {
    return this.bucket.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const object = await this.bucket.get(key);
    return object === null ? null : object.json<T>();
  }
}

export function manifestKey(ref: ExecutionArtifactRef): string {
  return `artifacts/${ref.artifactId}/manifest.json`;
}

export function sourcePackageKey(ref: ExecutionArtifactRef): string {
  return `artifacts/${ref.artifactId}/source-package.json`;
}

function validateStoredManifest(
  ref: ExecutionArtifactRef,
  manifest: StoredExecutionArtifactManifest,
): void {
  if (manifest.version !== 1) {
    throw new Error(`Unsupported execution artifact manifest version for ${ref.artifactId}.`);
  }
  if (manifest.sourcePackagePath !== sourcePackageKey(ref)) {
    throw new Error(`Execution artifact manifest path mismatch for ${ref.artifactId}.`);
  }
  if (!executionArtifactRefsEqual(manifest.ref, ref)) {
    throw new Error(`Execution artifact manifest ref mismatch for ${ref.artifactId}.`);
  }
}

function cloneSourcePackage(sourcePackage: SourcePackage): SourcePackage {
  return {
    modules: sourcePackage.modules.map(module => ({ ...module })),
    functions: [...sourcePackage.functions],
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  };
}
