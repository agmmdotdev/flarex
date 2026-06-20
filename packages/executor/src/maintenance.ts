import { MaintenancePolicyError } from "./errors";
import { abortStaleInvokeSessions } from "./sessions";
import type {
  Clock,
  FlarexExecutorPersistence,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
} from "./types";

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

  const now = clock.now();
  const olderThan = new Date(now.getTime() - input.staleAfterMs);
  const result = await abortStaleInvokeSessions(persistence, clock, {
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    olderThan,
  });

  return {
    staleAborted: result.aborted,
    sessions: result.sessions,
  };
}
