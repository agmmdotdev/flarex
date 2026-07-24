import {
  assertExecutionArtifactRefMatchesMaterializedSourcePackage,
  cloneArtifactSourcePackage,
  executionArtifactManifestKey,
  executionArtifactRefForSourcePackage,
  executionArtifactSourcePackageKey,
  SOURCE_MODULE_DIGEST_FORMAT_V1,
  validateStoredExecutionArtifactManifest,
  type ExecutionArtifactRef,
  type StoredExecutionArtifactManifest,
} from "flarex/artifacts";
import { Data } from "effect";
import type { PushSourcePackage } from "./types.ts";

export interface BackendExecutionArtifactStore {
  put(sourcePackage: PushSourcePackage): Promise<ExecutionArtifactRef>;
  get(ref: ExecutionArtifactRef): Promise<PushSourcePackage>;
}

export type R2BucketLike = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string | string[]): Promise<unknown>;
};

export class BackendExecutionArtifactIntegrityError extends Data.TaggedError(
  "BackendExecutionArtifactIntegrityError",
)<{
  readonly artifactId: string;
  readonly cause: unknown;
}> {}

export class R2BackendExecutionArtifactStore implements BackendExecutionArtifactStore {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async put(sourcePackage: PushSourcePackage): Promise<ExecutionArtifactRef> {
    const ownedSourcePackage = cloneArtifactSourcePackage(sourcePackage);
    if (
      ownedSourcePackage.sourceModuleDigestFormat !==
        SOURCE_MODULE_DIGEST_FORMAT_V1
    ) {
      throw new Error(
        "New execution artifacts require framed V1 source-module digests.",
      );
    }
    const ref = await executionArtifactRefForSourcePackage(ownedSourcePackage);
    await assertExecutionArtifactRefMatchesMaterializedSourcePackage(
      ref,
      ownedSourcePackage,
    );
    const sourcePackagePath = executionArtifactSourcePackageKey(ref);
    const manifest: StoredExecutionArtifactManifest = {
      version: 1,
      ref,
      sourcePackagePath,
    };
    await Promise.all([
      this.putJson(sourcePackagePath, ownedSourcePackage),
      this.putJson(executionArtifactManifestKey(ref), manifest),
    ]);
    return ref;
  }

  async get(ref: ExecutionArtifactRef): Promise<PushSourcePackage> {
    const manifestObject = await this.bucket.get(
      executionArtifactManifestKey(ref),
    );
    if (manifestObject === null) {
      throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
    }
    const manifestText = await manifestObject.text();
    let manifest: StoredExecutionArtifactManifest;
    try {
      manifest = JSON.parse(manifestText) as StoredExecutionArtifactManifest;
    } catch (cause) {
      throw new BackendExecutionArtifactIntegrityError({
        artifactId: ref.artifactId,
        cause,
      });
    }
    try {
      validateStoredExecutionArtifactManifest(ref, manifest);
    } catch (cause) {
      throw new BackendExecutionArtifactIntegrityError({
        artifactId: ref.artifactId,
        cause,
      });
    }
    const sourcePackageObject = await this.bucket.get(
      manifest.sourcePackagePath,
    );
    if (sourcePackageObject === null) {
      throw new BackendExecutionArtifactIntegrityError({
        artifactId: ref.artifactId,
        cause: new Error(
          `Execution artifact source package is missing: ${ref.artifactId}`,
        ),
      });
    }
    const sourcePackageText = await sourcePackageObject.text();
    let sourcePackage: PushSourcePackage;
    try {
      sourcePackage = JSON.parse(sourcePackageText) as PushSourcePackage;
    } catch (cause) {
      throw new BackendExecutionArtifactIntegrityError({
        artifactId: ref.artifactId,
        cause,
      });
    }
    try {
      await assertExecutionArtifactRefMatchesMaterializedSourcePackage(
        ref,
        sourcePackage,
      );
    } catch (cause) {
      throw new BackendExecutionArtifactIntegrityError({
        artifactId: ref.artifactId,
        cause,
      });
    }
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
}
