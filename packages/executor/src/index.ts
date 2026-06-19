import { ensureDeployment } from "./deployments";
import { defaultClock, getExecutorHealth } from "./health";
import type { FlarexExecutor, FlarexExecutorConfig } from "./types";

export { DeploymentProjectMismatchError } from "./errors";
export type {
  Clock,
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutor,
  FlarexExecutorConfig,
  FlarexExecutorDependencyHealth,
  FlarexExecutorPersistence,
  FlarexHealth,
} from "./types";

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const persistence = config.persistence;

  return {
    ensureDeployment: (input) => ensureDeployment(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}
