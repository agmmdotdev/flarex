import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import type { AuthConfig } from "flarex-protocol/auth";
import { SOURCE_MODULE_DIGEST_FORMAT_V1 } from "flarex-protocol/deployment";

export { SOURCE_MODULE_DIGEST_FORMAT_V1 } from "flarex-protocol/deployment";

export type ArtifactSourceModule = {
  path: string;
  environment: "isolate";
  sha256: string;
};

export type ArtifactSourcePackage = {
  modules: ArtifactSourceModule[];
  functions: string[];
  sourceModuleDigestFormat?: typeof SOURCE_MODULE_DIGEST_FORMAT_V1;
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

const sourceModuleDigestDomainV1 = new TextEncoder().encode(
  "flarex.source-module.v1",
);

/**
 * Frames source-module bytes for the V1 SHA-256 digest.
 *
 * The domain, byte lengths, and source-map presence marker keep every
 * `(source, sourceMap)` representation distinct, including raw NUL bytes and
 * omitted versus empty source maps.
 */
export function sourceModuleDigestInputV1(
  source: string,
  sourceMap: string | undefined,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(source);
  const sourceMapBytes = sourceMap === undefined
    ? undefined
    : encoder.encode(sourceMap);
  const sourceMapByteLength = sourceMapBytes?.byteLength ?? 0;
  const output = new Uint8Array(
    sourceModuleDigestDomainV1.byteLength +
      1 +
      8 +
      sourceBytes.byteLength +
      1 +
      8 +
      sourceMapByteLength,
  );
  const view = new DataView(output.buffer);
  let offset = 0;
  output.set(sourceModuleDigestDomainV1, offset);
  offset += sourceModuleDigestDomainV1.byteLength;
  output[offset] = 0;
  offset += 1;
  view.setBigUint64(offset, BigInt(sourceBytes.byteLength), false);
  offset += 8;
  output.set(sourceBytes, offset);
  offset += sourceBytes.byteLength;
  output[offset] = sourceMapBytes === undefined ? 0 : 1;
  offset += 1;
  view.setBigUint64(offset, BigInt(sourceMapByteLength), false);
  offset += 8;
  if (sourceMapBytes !== undefined) {
    output.set(sourceMapBytes, offset);
  }
  return output;
}

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
    ...(sourcePackage.sourceModuleDigestFormat === undefined
      ? {}
      : {
          sourceModuleDigestFormat: sourcePackage.sourceModuleDigestFormat,
        }),
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

export async function assertExecutionArtifactRefMatchesMaterializedSourcePackage(
  ref: ExecutionArtifactRef,
  sourcePackage: StoredArtifactSourcePackage,
): Promise<void> {
  await assertExecutionArtifactRefMatchesSourcePackage(ref, sourcePackage);
  if (!Array.isArray(sourcePackage.modules)) {
    throw new Error(`Execution artifact modules are invalid: ${ref.artifactId}`);
  }
  for (const module of sourcePackage.modules) {
    if (
      !isNonArrayRecord(module) ||
      typeof module.path !== "string" ||
      typeof module.sha256 !== "string" ||
      typeof module.source !== "string" ||
      (module.sourceMap !== undefined && typeof module.sourceMap !== "string")
    ) {
      throw new Error(`Execution artifact module is not materialized: ${ref.artifactId}`);
    }
    const actualDigest = await sourceModuleSha256(
      module.source,
      module.sourceMap,
      sourcePackage.sourceModuleDigestFormat,
    );
    if (actualDigest !== module.sha256) {
      throw new Error(
        `Execution artifact module digest mismatch for ${module.path}: ${ref.artifactId}`,
      );
    }
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
    ...(sourcePackage.sourceModuleDigestFormat === undefined
      ? {}
      : {
          sourceModuleDigestFormat: sourcePackage.sourceModuleDigestFormat,
        }),
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

function sourceModuleSha256(
  source: string,
  sourceMap: string | undefined,
  format: typeof SOURCE_MODULE_DIGEST_FORMAT_V1 | undefined,
): Promise<string> {
  return format === SOURCE_MODULE_DIGEST_FORMAT_V1
    ? sha256BytesHex(sourceModuleDigestInputV1(source, sourceMap))
    : sha256Hex(`${source}\0${sourceMap ?? ""}`);
}

async function sha256BytesHex(
  value: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return encodeBytesToLowercaseHex(new Uint8Array(digest));
}
