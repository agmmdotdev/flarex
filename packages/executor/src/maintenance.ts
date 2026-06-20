import { MaintenancePolicyError } from "./errors";
import { abortStaleInvokeSessions } from "./sessions";
import type {
  Clock,
  FlarexExecutorPersistence,
  ListMaintenanceDeploymentsInput,
  ListMaintenanceDeploymentsResult,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
} from "./types";

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT = 100;

export async function listMaintenanceDeployments(
  persistence: FlarexExecutorPersistence,
  input: ListMaintenanceDeploymentsInput = {},
): Promise<ListMaintenanceDeploymentsResult> {
  const limit = input.limit ?? DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new MaintenancePolicyError("limit must be a positive integer.");
  }

  return await persistence.listDeploymentMetadata({
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function runInvokeSessionMaintenance(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunInvokeSessionMaintenanceInput,
): Promise<RunInvokeSessionMaintenanceResult> {
  if (
    !Number.isFinite(input.staleAfterMs) ||
    !Number.isInteger(input.staleAfterMs) ||
    input.staleAfterMs <= 0
  ) {
    throw new MaintenancePolicyError("staleAfterMs must be a positive integer.");
  }
  const maxSessions = input.maxSessions ?? DEFAULT_MAX_SESSIONS;
  if (
    !Number.isFinite(maxSessions) ||
    !Number.isInteger(maxSessions) ||
    maxSessions <= 0
  ) {
    throw new MaintenancePolicyError("maxSessions must be a positive integer.");
  }

  const now = clock.now();
  const olderThan = new Date(now.getTime() - input.staleAfterMs);
  const result = await abortStaleInvokeSessions(persistence, clock, {
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    olderThan,
    limit: maxSessions,
  });

  return {
    staleAborted: result.aborted,
    sessions: result.sessions,
    hasMore: result.hasMore,
  };
}
