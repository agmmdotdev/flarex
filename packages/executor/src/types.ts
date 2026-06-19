import type {
  DeploymentPackageMetadataRecord,
  DeploymentMetadataRecord,
  FlarexPersistenceCheck,
  InsertDeploymentPackageMetadataInput,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";
import type { ArtifactSourcePackage } from "flarex/artifacts";

export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  persistence: FlarexExecutorPersistence;
}

export interface FlarexExecutor {
  activateDeploymentPackage(
    input: ActivateDeploymentPackageInput,
  ): Promise<ActivateDeploymentPackageResult>;
  ensureDeployment(input: EnsureDeploymentInput): Promise<EnsureDeploymentResult>;
  getActiveFunction(
    input: GetActiveFunctionInput,
  ): Promise<GetActiveFunctionResult>;
  getActiveDeploymentPackage(
    input: GetActiveDeploymentPackageInput,
  ): Promise<GetActiveDeploymentPackageResult>;
  prepareInvoke(input: PrepareInvokeInput): Promise<PrepareInvokeResult>;
  registerDeploymentPackage(
    input: RegisterDeploymentPackageInput,
  ): Promise<RegisterDeploymentPackageResult>;
  health(): Promise<FlarexHealth>;
}

export interface FlarexExecutorPersistence {
  check(): Promise<FlarexPersistenceCheck>;
  getDeploymentPackageMetadata(
    deploymentId: string,
    packageId: string,
  ): Promise<DeploymentPackageMetadataRecord | null>;
  insertDeploymentPackageMetadata(
    input: InsertDeploymentPackageMetadataInput,
  ): Promise<DeploymentPackageMetadataRecord>;
  getDeploymentMetadata(
    deploymentId: string,
  ): Promise<DeploymentMetadataRecord | null>;
  insertDeploymentMetadata(
    input: InsertDeploymentMetadataInput,
  ): Promise<DeploymentMetadataRecord>;
  updateDeploymentMetadataActivation(
    input: UpdateDeploymentMetadataActivationInput,
  ): Promise<DeploymentMetadataRecord | null>;
}

export interface ActivateDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
  packageId: string;
  schemaVersion: number;
}

export interface ActivateDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  createdDeployment: boolean;
}

export interface RegisterDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
  sourcePackage: ArtifactSourcePackage;
  analysisJson?: Record<string, unknown> | null;
}

export interface RegisterDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  createdDeployment: boolean;
  createdPackage: boolean;
}

export interface GetActiveDeploymentPackageInput {
  deploymentId: string;
  projectId: string;
}

export interface GetActiveDeploymentPackageResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
}

export interface GetActiveFunctionInput {
  deploymentId: string;
  projectId: string;
  path: string;
}

export interface GetActiveFunctionResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  function: DeploymentFunctionMetadata;
}

export type DeploymentFunctionKind =
  | "query"
  | "mutation"
  | "action"
  | "workflowMutation";

export type FunctionVisibility = "public" | "internal";

export interface DeploymentFunctionMetadata {
  path: string;
  kind: DeploymentFunctionKind;
  visibility?: FunctionVisibility;
  args?: unknown;
  returns?: unknown;
  route?: unknown;
  partition?: unknown;
  position?: unknown;
}

export type InvokableFunctionKind = "query" | "mutation";

export interface DeploymentSchemaMetadata {
  version: number;
  tables: unknown[];
  indexes: unknown[];
}

export interface PrepareInvokeInput {
  deploymentId: string;
  projectId: string;
  path: string;
  kind?: InvokableFunctionKind;
}

export interface PrepareInvokeResult {
  deployment: DeploymentMetadataRecord;
  package: DeploymentPackageMetadataRecord;
  function: DeploymentFunctionMetadata & { kind: InvokableFunctionKind };
  schema: DeploymentSchemaMetadata;
  executionModule: string;
}

export interface EnsureDeploymentInput {
  deploymentId: string;
  projectId: string;
}

export interface EnsureDeploymentResult {
  deployment: DeploymentMetadataRecord;
  created: boolean;
}

export interface FlarexHealth {
  service: "executor";
  status: "ok" | "degraded";
  persistence: FlarexExecutorDependencyHealth;
  time: string;
}

export type FlarexExecutorDependencyHealth =
  | {
      status: "ok";
    }
  | {
      status: "error";
      message: string;
    };
