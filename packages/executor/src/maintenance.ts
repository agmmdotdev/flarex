import { MaintenancePolicyError } from "./errors";
import { abortStaleInvokeSessions } from "./sessions";
import type {
  Clock,
  FlarexExecutorPersistence,
  ListMaintenanceDeploymentsInput,
  ListMaintenanceDeploymentsResult,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
  RunMaintenanceSweepInput,
  RunMaintenanceSweepResult,
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

export async function runMaintenanceSweep(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunMaintenanceSweepInput,
): Promise<RunMaintenanceSweepResult> {
  const deploymentPage = await listMaintenanceDeployments(persistence, {
    limit: input.deploymentLimit ?? DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT,
    ...(input.deploymentCursor === undefined
      ? {}
      : { cursor: input.deploymentCursor }),
  });

  const results: RunMaintenanceSweepResult["deployments"] = [];
  for (const deployment of deploymentPage.deployments) {
    const maintenance = await runInvokeSessionMaintenance(persistence, clock, {
      deploymentId: deployment.deploymentId,
      projectId: deployment.projectId,
      staleAfterMs: input.staleAfterMs,
      ...(input.maxSessionsPerDeployment === undefined
        ? {}
        : { maxSessions: input.maxSessionsPerDeployment }),
    });
    results.push({
      deploymentId: deployment.deploymentId,
      projectId: deployment.projectId,
      staleAborted: maintenance.staleAborted,
      sessions: maintenance.sessions,
      hasMoreSessions: maintenance.hasMore,
    });
  }

  return {
    deployments: results,
    nextDeploymentCursor: deploymentPage.nextCursor,
    hasMoreDeployments: deploymentPage.hasMore,
  };
}
