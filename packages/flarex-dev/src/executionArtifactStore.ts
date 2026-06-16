import {
  executionArtifactRefForSourcePackage,
  type ExecutionArtifactRef,
} from "flarex/artifacts";
import type { SourcePackage } from "./sourcePackage.ts";

export interface ExecutionArtifactStore {
  put(sourcePackage: SourcePackage): Promise<ExecutionArtifactRef>;
  get(ref: ExecutionArtifactRef): Promise<SourcePackage>;
}

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
    const currentRef = await executionArtifactRefForSourcePackage(sourcePackage);
    if (currentRef.sourcePackageHash !== ref.sourcePackageHash) {
      throw new Error(`Execution artifact hash mismatch for ${ref.artifactId}.`);
    }
    return cloneSourcePackage(sourcePackage);
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
