import {
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionNotInvokableError,
} from "./errors";
import { getActiveFunction } from "./functions";
import type {
  DeploymentSchemaMetadata,
  FlarexExecutorPersistence,
  InvokableFunctionKind,
  PrepareInvokeInput,
  PrepareInvokeResult,
} from "./types";

export async function prepareInvoke(
  persistence: FlarexExecutorPersistence,
  input: PrepareInvokeInput,
): Promise<PrepareInvokeResult> {
  const active = await getActiveFunction(persistence, input);
  if (!isInvokableFunctionKind(active.function.kind)) {
    throw new FunctionNotInvokableError(
      input.deploymentId,
      input.path,
      active.function.kind,
    );
  }
  if (input.kind !== undefined && input.kind !== active.function.kind) {
    throw new FunctionKindMismatchError(
      input.deploymentId,
      input.path,
      input.kind,
      active.function.kind,
    );
  }

  return {
    ...active,
    function: {
      ...active.function,
      kind: active.function.kind,
    },
    schema: deploymentSchemaFromAnalysis(
      active.package.analysisJson,
      active.package.deploymentId,
      active.package.packageId,
    ),
    executionModule: active.package.executionModule,
  };
}

function deploymentSchemaFromAnalysis(
  analysisJson: unknown,
  deploymentId: string,
  packageId: string,
): DeploymentSchemaMetadata {
  const analysis = asRecord(analysisJson);
  if (analysis === null) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson must be an object",
    );
  }

  const schema = asRecord(analysis.schema);
  if (schema === null) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema must be an object",
    );
  }
  if (typeof schema.version !== "number" || !Number.isInteger(schema.version)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.version must be an integer",
    );
  }
  if (!Array.isArray(schema.tables)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.tables must be an array",
    );
  }
  if (!Array.isArray(schema.indexes)) {
    throw new DeploymentSchemaMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.schema.indexes must be an array",
    );
  }

  return {
    version: schema.version,
    tables: schema.tables,
    indexes: schema.indexes,
  };
}

function isInvokableFunctionKind(value: string): value is InvokableFunctionKind {
  return value === "query" || value === "mutation";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
