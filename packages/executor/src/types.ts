import type {
  DeploymentMetadataRecord,
  FlarexPersistenceCheck,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";

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
  health(): Promise<FlarexHealth>;
}

export interface FlarexExecutorPersistence {
  check(): Promise<FlarexPersistenceCheck>;
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
