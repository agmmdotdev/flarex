import {
  assertExecutionArtifactRefMatchesSourcePackage,
  cloneArtifactSourcePackage,
  executionArtifactManifestKey,
  executionArtifactRefForSourcePackage,
  executionArtifactSourcePackageKey,
  validateStoredExecutionArtifactManifest,
  type ExecutionArtifactRef,
  type StoredExecutionArtifactManifest,
} from "flarex/artifacts";
import type { PushSourcePackage } from "./types.ts";

export interface BackendExecutionArtifactStore {
  put(sourcePackage: PushSourcePackage): Promise<ExecutionArtifactRef>;
  get(ref: ExecutionArtifactRef): Promise<PushSourcePackage>;
}

export type R2BucketLike = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
  delete(key: string | string[]): Promise<unknown>;
};

export class R2BackendExecutionArtifactStore implements BackendExecutionArtifactStore {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async put(sourcePackage: PushSourcePackage): Promise<ExecutionArtifactRef> {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const sourcePackagePath = executionArtifactSourcePackageKey(ref);
    const manifest: StoredExecutionArtifactManifest = {
      version: 1,
      ref,
      sourcePackagePath,
    };
    await Promise.all([
      this.putJson(sourcePackagePath, sourcePackage),
      this.putJson(executionArtifactManifestKey(ref), manifest),
    ]);
    return ref;
  }

  async get(ref: ExecutionArtifactRef): Promise<PushSourcePackage> {
    const manifest = await this.getJson<unknown>(
      executionArtifactManifestKey(ref),
    );
    if (manifest === null) {
      throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
    }
    validateStoredExecutionArtifactManifest(ref, manifest);
    const sourcePackage = await this.getJson<PushSourcePackage>(manifest.sourcePackagePath);
    if (sourcePackage === null) {
      throw new Error(`Execution artifact source package is missing: ${ref.artifactId}`);
    }
    await assertExecutionArtifactRefMatchesSourcePackage(ref, sourcePackage);
    return cloneArtifactSourcePackage(sourcePackage);
  }

  async delete(ref: ExecutionArtifactRef): Promise<void> {
    await this.bucket.delete([
      executionArtifactManifestKey(ref),
      executionArtifactSourcePackageKey(ref),
    ]);
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
