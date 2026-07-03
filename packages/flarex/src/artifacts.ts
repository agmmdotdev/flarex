export type ArtifactSourceModule = {
  path: string;
  environment: "isolate";
  sha256: string;
};

export type ArtifactSourcePackage = {
  modules: ArtifactSourceModule[];
  functions: string[];
  schema?: string;
  execution: string;
};

export type ExecutionArtifactRef = {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
};

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
    functions: [...sourcePackage.functions].sort(),
    modules: [...sourcePackage.modules]
      .map(module => ({
        path: module.path,
        environment: module.environment,
        sha256: module.sha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

export function validateExecutionArtifactRef(value: unknown): ExecutionArtifactRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored execution artifact reference is invalid.");
  }
  const ref = value as Partial<ExecutionArtifactRef>;
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
