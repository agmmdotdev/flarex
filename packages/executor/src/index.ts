import {
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type FlarexPersistenceCheck,
  type InsertDeploymentMetadataInput,
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

export class DeploymentProjectMismatchError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly expectedProjectId: string,
    readonly actualProjectId: string,
  ) {
    super(
      `Deployment ${deploymentId} belongs to project ${actualProjectId}, not ${expectedProjectId}`,
    );
    this.name = "DeploymentProjectMismatchError";
  }
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

const defaultClock: Clock = {
  now: () => new Date(),
};

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const persistence = config.persistence;

  return {
    async ensureDeployment(input) {
      const existingDeployment = await persistence.getDeploymentMetadata(
        input.deploymentId,
      );
      if (existingDeployment !== null) {
        return {
          deployment: assertDeploymentProject(existingDeployment, input),
          created: false,
        };
      }

      try {
        const deployment = await persistence.insertDeploymentMetadata(input);
        return { deployment, created: true };
      } catch (error) {
        if (!(error instanceof DeploymentMetadataAlreadyExistsError)) {
          throw error;
        }

        const racedDeployment = await persistence.getDeploymentMetadata(
          input.deploymentId,
        );
        if (racedDeployment === null) {
          throw error;
        }

        return {
          deployment: assertDeploymentProject(racedDeployment, input),
          created: false,
        };
      }
    },

    async health() {
      const persistenceHealth = await checkPersistence(persistence);

      return {
        service: "executor",
        status: persistenceHealth.status === "ok" ? "ok" : "degraded",
        persistence: persistenceHealth,
        time: clock.now().toISOString(),
      };
    },
  };
}

async function checkPersistence(
  persistence: FlarexExecutorPersistence,
): Promise<FlarexExecutorDependencyHealth> {
  try {
    await persistence.check();
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown persistence error",
    };
  }
}

function assertDeploymentProject(
  deployment: DeploymentMetadataRecord,
  input: EnsureDeploymentInput,
): DeploymentMetadataRecord {
  if (deployment.projectId !== input.projectId) {
    throw new DeploymentProjectMismatchError(
      deployment.deploymentId,
      input.projectId,
      deployment.projectId,
    );
  }

  return deployment;
}
