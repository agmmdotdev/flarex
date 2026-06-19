import type {
  DeploymentMetadataRecord,
  FlarexPersistenceCheck,
  InsertDeploymentMetadataInput,
} from "@flarex/persistence-postgres";

export interface Clock {
  now(): Date;
}

export interface FlarexExecutorConfig {
  clock?: Clock;
  persistence: FlarexExecutorPersistence;
}

export interface FlarexExecutor {
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
