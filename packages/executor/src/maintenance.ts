import { Data, Effect } from "effect";

import { MaintenancePolicyError } from "./errors";
import {
  invokeSessionFailureCause,
  type AbortStaleInvokeSessionsEffectError,
  type ConfiguredSessionClockError,
  InvokeSessionDateObservationError,
  type InvokeSessionOperations,
} from "./sessions";
import type {
  FlarexExecutorControlPersistence,
  ListMaintenanceDeploymentsInput,
  ListMaintenanceDeploymentsResult,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
  RunMaintenanceSweepInput,
  RunMaintenanceSweepResult,
} from "./types";

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT = 100;

export class MaintenanceForeignOperationError extends Data.TaggedError(
  "MaintenanceForeignOperationError",
)<{
  readonly operation: "list maintenance deployments";
  readonly cause: unknown;
}> {}

export type ListMaintenanceDeploymentsEffectError =
  | MaintenanceForeignOperationError
  | MaintenancePolicyError;

export type RunInvokeSessionMaintenanceEffectError =
  | AbortStaleInvokeSessionsEffectError
  | ConfiguredSessionClockError
  | InvokeSessionDateObservationError
  | MaintenancePolicyError;

export type RunMaintenanceSweepEffectError =
  | ListMaintenanceDeploymentsEffectError
  | RunInvokeSessionMaintenanceEffectError;

export const listMaintenanceDeploymentsEffect = Effect.fn(
  "Executor.maintenance.listDeployments",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  input: ListMaintenanceDeploymentsInput = {},
): Effect.fn.Return<
  ListMaintenanceDeploymentsResult,
  ListMaintenanceDeploymentsEffectError
> {
  const limit = input.limit ?? DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    return yield* Effect.fail(
      new MaintenancePolicyError("limit must be a positive integer."),
    );
  }

  return yield* Effect.tryPromise({
    try: () => persistence.listDeploymentMetadata({
      limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
    catch: (cause) => new MaintenanceForeignOperationError({
      operation: "list maintenance deployments",
      cause,
    }),
  });
});

export const runInvokeSessionMaintenanceEffect = Effect.fn(
  "Executor.maintenance.runInvokeSession",
)(function* (
  readTime: Effect.Effect<Date, ConfiguredSessionClockError>,
  sessionOperations: InvokeSessionOperations,
  input: RunInvokeSessionMaintenanceInput,
): Effect.fn.Return<
  RunInvokeSessionMaintenanceResult,
  RunInvokeSessionMaintenanceEffectError
> {
  if (
    !Number.isFinite(input.staleAfterMs) ||
    !Number.isInteger(input.staleAfterMs) ||
    input.staleAfterMs <= 0
  ) {
    return yield* Effect.fail(
      new MaintenancePolicyError("staleAfterMs must be a positive integer."),
    );
  }
  const maxSessions = input.maxSessions ?? DEFAULT_MAX_SESSIONS;
  if (
    !Number.isFinite(maxSessions) ||
    !Number.isInteger(maxSessions) ||
    maxSessions <= 0
  ) {
    return yield* Effect.fail(
      new MaintenancePolicyError("maxSessions must be a positive integer."),
    );
  }

  const now = yield* readTime;
  const olderThan = yield* Effect.try({
    try: () => new Date(now.getTime() - input.staleAfterMs),
    catch: (cause) => new InvokeSessionDateObservationError({ cause }),
  });
  const result = yield* sessionOperations.abortStale({
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
});

export const runMaintenanceSweepEffect = Effect.fn(
  "Executor.maintenance.runSweep",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: Effect.Effect<Date, ConfiguredSessionClockError>,
  sessionOperations: InvokeSessionOperations,
  input: RunMaintenanceSweepInput,
): Effect.fn.Return<
  RunMaintenanceSweepResult,
  RunMaintenanceSweepEffectError
> {
  const deploymentPage = yield* listMaintenanceDeploymentsEffect(persistence, {
    limit: input.deploymentLimit ?? DEFAULT_MAINTENANCE_DEPLOYMENT_LIMIT,
    ...(input.deploymentCursor === undefined
      ? {}
      : { cursor: input.deploymentCursor }),
  });

  const results: RunMaintenanceSweepResult["deployments"] = [];
  for (const deployment of deploymentPage.deployments) {
    const maintenance = yield* runInvokeSessionMaintenanceEffect(
      readTime,
      sessionOperations,
      {
        deploymentId: deployment.deploymentId,
        projectId: deployment.projectId,
        staleAfterMs: input.staleAfterMs,
        ...(input.maxSessionsPerDeployment === undefined
          ? {}
          : { maxSessions: input.maxSessionsPerDeployment }),
      },
    );
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
});

export function runMaintenancePromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.mapError((error) =>
      error instanceof MaintenanceForeignOperationError
        ? error.cause
        : invokeSessionFailureCause(error)
    )),
  );
}
