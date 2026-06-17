import {
  executionArtifactRefForSourcePackage,
  type ExecutionArtifactRef,
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

type StoredExecutionArtifactManifest = {
  version: 1;
  ref: ExecutionArtifactRef;
  sourcePackagePath: string;
};

export class R2BackendExecutionArtifactStore implements BackendExecutionArtifactStore {
  private readonly bucket: R2BucketLike;

  constructor(bucket: R2BucketLike) {
    this.bucket = bucket;
  }

  async put(sourcePackage: PushSourcePackage): Promise<ExecutionArtifactRef> {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
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
    return ref;
  }

  async get(ref: ExecutionArtifactRef): Promise<PushSourcePackage> {
    const manifest = await this.getJson<StoredExecutionArtifactManifest>(manifestKey(ref));
    if (manifest === null) {
      throw new Error(`Unknown execution artifact: ${ref.artifactId}`);
    }
    validateStoredManifest(ref, manifest);
    const sourcePackage = await this.getJson<PushSourcePackage>(manifest.sourcePackagePath);
    if (sourcePackage === null) {
      throw new Error(`Execution artifact source package is missing: ${ref.artifactId}`);
    }
    await assertRefMatchesSourcePackage(ref, sourcePackage);
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

async function assertRefMatchesSourcePackage(
  ref: ExecutionArtifactRef,
  sourcePackage: PushSourcePackage,
): Promise<void> {
  const actual = await executionArtifactRefForSourcePackage(sourcePackage);
  if (
    actual.artifactId !== ref.artifactId ||
    actual.sourcePackageHash !== ref.sourcePackageHash ||
    actual.executionModule !== ref.executionModule ||
    actual.runtime !== ref.runtime
  ) {
    throw new Error(`Execution artifact ref does not match source package: ${ref.artifactId}`);
  }
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
  if (
    manifest.ref.artifactId !== ref.artifactId ||
    manifest.ref.sourcePackageHash !== ref.sourcePackageHash ||
    manifest.ref.executionModule !== ref.executionModule ||
    manifest.ref.runtime !== ref.runtime
  ) {
    throw new Error(`Execution artifact manifest ref mismatch for ${ref.artifactId}.`);
  }
}

function cloneSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  return {
    modules: sourcePackage.modules.map(module => ({ ...module })),
    functions: [...sourcePackage.functions],
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    execution: sourcePackage.execution,
  };
}
