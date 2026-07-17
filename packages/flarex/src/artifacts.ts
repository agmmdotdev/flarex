import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import type { AuthConfig } from "flarex-protocol/auth";

export type ArtifactSourceModule = {
  path: string;
  environment: "isolate";
  sha256: string;
};

export type ArtifactSourcePackage = {
  modules: ArtifactSourceModule[];
  functions: string[];
  schema?: string;
  authConfig?: AuthConfig;
  authConfigModule?: string;
  execution: string;
};

export type StoredArtifactSourceModule = ArtifactSourceModule & {
  source?: string;
  sourceMap?: string;
};

export type MaterializedArtifactSourceModule = ArtifactSourceModule & {
  source: string;
  sourceMap?: string;
};

export type StoredArtifactSourcePackage = Omit<
  ArtifactSourcePackage,
  "modules"
> & {
  modules: StoredArtifactSourceModule[];
};

export type MaterializedArtifactSourcePackage = Omit<
  ArtifactSourcePackage,
  "modules"
> & {
  modules: MaterializedArtifactSourceModule[];
};

export type ExecutionArtifactRef = {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
};

export type StoredExecutionArtifactManifest = {
  version: 1;
  ref: ExecutionArtifactRef;
  sourcePackagePath: string;
};

export function executionArtifactManifestKey(
  ref: ExecutionArtifactRef,
): string {
  return `artifacts/${ref.artifactId}/manifest.json`;
}

export function executionArtifactSourcePackageKey(
  ref: ExecutionArtifactRef,
): string {
  return `artifacts/${ref.artifactId}/source-package.json`;
}

export function validateStoredExecutionArtifactManifest(
  ref: ExecutionArtifactRef,
  manifest: unknown,
): asserts manifest is StoredExecutionArtifactManifest {
  if (!isNonArrayRecord(manifest)) {
    throw new Error(
      `Stored execution artifact manifest is invalid for ${ref.artifactId}.`,
    );
  }
  if (manifest.version !== 1) {
    throw new Error(
      `Unsupported execution artifact manifest version for ${ref.artifactId}.`,
    );
  }
  if (manifest.sourcePackagePath !== executionArtifactSourcePackageKey(ref)) {
    throw new Error(
      `Execution artifact manifest path mismatch for ${ref.artifactId}.`,
    );
  }
  if (!storedExecutionArtifactRefMatches(manifest.ref, ref)) {
    throw new Error(
      `Execution artifact manifest ref mismatch for ${ref.artifactId}.`,
    );
  }
}

export function cloneArtifactSourcePackage(
  sourcePackage: MaterializedArtifactSourcePackage,
): MaterializedArtifactSourcePackage;
export function cloneArtifactSourcePackage(
  sourcePackage: StoredArtifactSourcePackage,
): StoredArtifactSourcePackage;
export function cloneArtifactSourcePackage(
  sourcePackage: StoredArtifactSourcePackage,
): StoredArtifactSourcePackage {
  return {
    modules: sourcePackage.modules.map((module) => ({ ...module })),
    functions: [...sourcePackage.functions],
    ...(sourcePackage.schema === undefined
      ? {}
      : { schema: sourcePackage.schema }),
    ...(sourcePackage.authConfig === undefined
      ? {}
      : { authConfig: structuredClone(sourcePackage.authConfig) }),
    ...(sourcePackage.authConfigModule === undefined
      ? {}
      : { authConfigModule: sourcePackage.authConfigModule }),
    execution: sourcePackage.execution,
  };
}

function storedExecutionArtifactRefMatches(
  value: unknown,
  expected: ExecutionArtifactRef,
): boolean {
  return isNonArrayRecord(value) &&
    value.runtime === expected.runtime &&
    value.artifactId === expected.artifactId &&
    value.sourcePackageHash === expected.sourcePackageHash &&
    value.executionModule === expected.executionModule;
}

export async function executionArtifactRefForSourcePackage(
  sourcePackage: ArtifactSourcePackage,
): Promise<ExecutionArtifactRef> {
  const sourcePackageHash = await sha256Hex(stableSourcePackageManifest(sourcePackage));
  return {
    runtime: "dynamic-worker",
    artifactId: `artifact_${sourcePackageHash.slice(0, 32)}`,
    sourcePackageHash,
    executionModule: sourcePackage.execution,
  };
}

export function executionArtifactRefsEqual(
  left: ExecutionArtifactRef,
  right: ExecutionArtifactRef,
): boolean {
  return (
    left.runtime === right.runtime &&
    left.artifactId === right.artifactId &&
    left.sourcePackageHash === right.sourcePackageHash &&
    left.executionModule === right.executionModule
  );
}

export async function assertExecutionArtifactRefMatchesSourcePackage(
  ref: ExecutionArtifactRef,
  sourcePackage: ArtifactSourcePackage,
): Promise<void> {
  const actual = await executionArtifactRefForSourcePackage(sourcePackage);
  if (!executionArtifactRefsEqual(actual, ref)) {
    throw new Error(`Execution artifact ref does not match source package: ${ref.artifactId}`);
  }
}

export function stableSourcePackageManifest(sourcePackage: ArtifactSourcePackage): string {
  return JSON.stringify({
    execution: sourcePackage.execution,
    schema: sourcePackage.schema ?? null,
    authConfig: sourcePackage.authConfig === undefined
      ? null
      : canonicalValue(sourcePackage.authConfig),
    authConfigModule: sourcePackage.authConfigModule ?? null,
    functions: [...sourcePackage.functions].sort(compareUtf16Strings),
    modules: [...sourcePackage.modules]
      .map(module => ({
        path: module.path,
        environment: module.environment,
        sha256: module.sha256,
      }))
      .sort((left, right) => compareUtf16Strings(left.path, right.path)),
  });
}

export function validateExecutionArtifactRef(value: unknown): ExecutionArtifactRef {
  if (!isNonArrayRecord(value)) {
    throw new Error("Stored execution artifact reference is invalid.");
  }
  const ref = value;
  if (ref.runtime !== "dynamic-worker") {
    throw new Error("Stored execution artifact reference has an invalid runtime.");
  }
  if (typeof ref.artifactId !== "string" || !/^artifact_[a-f0-9]{32}$/.test(ref.artifactId)) {
    throw new Error("Stored execution artifact reference has an invalid artifact ID.");
  }
  if (
    typeof ref.sourcePackageHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(ref.sourcePackageHash)
  ) {
    throw new Error("Stored execution artifact reference has an invalid source package hash.");
  }
  if (typeof ref.executionModule !== "string" || ref.executionModule.length === 0) {
    throw new Error("Stored execution artifact reference has an invalid execution module.");
  }
  return {
    runtime: ref.runtime,
    artifactId: ref.artifactId,
    sourcePackageHash: ref.sourcePackageHash,
    executionModule: ref.executionModule,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isNonArrayRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf16Strings(left, right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBytesToLowercaseHex(new Uint8Array(digest));
}
