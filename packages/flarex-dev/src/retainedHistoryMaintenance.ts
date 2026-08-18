import type {
  RetainedHistorySchedulerHostNeutralRun,
  RetainedHistorySchedulerRunResult,
} from "@flarex/executor/internal/retained-history-scheduler-run";
import { Effect } from "effect";
import { isJson, type Json } from "flarex-protocol/json";

type JsonProjection<Shape> = Readonly<Shape> & Json;

export type FlarexRetainedHistoryMaintenanceJson =
  | JsonProjection<{
      readonly operation: "retainedHistoryMaintenance";
      readonly status: "not_due";
      readonly nextRunAt: string;
    }>
  | JsonProjection<{
      readonly operation: "retainedHistoryMaintenance";
      readonly status: "busy";
      readonly claimExpiresAt: string;
    }>
  | JsonProjection<{
      readonly operation: "retainedHistoryMaintenance";
      readonly status: "completed";
      readonly reason: Extract<
        RetainedHistorySchedulerRunResult,
        { readonly kind: "completed" }
      >["reason"];
      readonly invocations: number;
      readonly directoryPagesRead: number;
      readonly maintenancePagesExecuted: number;
      readonly scopeVisits: number;
      readonly scopesFailed: number;
      readonly nextRunAt: string;
    }>;

export interface FlarexRetainedHistoryMaintenanceManualTrigger<Failure> {
  /** Runs exactly one bounded database-checkpointed scheduler invocation. */
  readonly runEffect: () => Effect.Effect<
    FlarexRetainedHistoryMaintenanceJson,
    Failure
  >;
}

/**
 * Private explicit wake adapter. It accepts no cursor, deployment, scope, or
 * deletion authority; those remain owned by the O11-F2 runner and checkpoint.
 */
export function createFlarexRetainedHistoryMaintenanceManualTrigger<Failure>(
  runner: RetainedHistorySchedulerHostNeutralRun<Failure>,
): FlarexRetainedHistoryMaintenanceManualTrigger<Failure> {
  const owner = runner;
  const runMethod = owner.runEffect;
  const runEffect = Effect.fn("FlarexDev.RetainedHistoryMaintenance.run")(
    function* () {
      return projectResult(yield* runMethod.call(owner));
    },
  );
  return Object.freeze({ runEffect });
}

function projectResult(
  result: RetainedHistorySchedulerRunResult,
): FlarexRetainedHistoryMaintenanceJson {
  switch (result.kind) {
    case "notDue":
      return assertJsonProjection(Object.freeze({
        operation: "retainedHistoryMaintenance" as const,
        status: "not_due" as const,
        nextRunAt: Date.prototype.toISOString.call(result.nextRunAt),
      }));
    case "busy":
      return assertJsonProjection(Object.freeze({
        operation: "retainedHistoryMaintenance" as const,
        status: "busy" as const,
        claimExpiresAt: Date.prototype.toISOString.call(result.claimExpiresAt),
      }));
    case "completed": {
      const scopeVisits = result.batches.reduce(
        (total, batch) => total + batch.scopeVisits,
        0,
      );
      const scopesFailed = result.batches.reduce(
        (total, batch) => total + batch.scopesFailed,
        0,
      );
      return assertJsonProjection(Object.freeze({
        operation: "retainedHistoryMaintenance" as const,
        status: "completed" as const,
        reason: result.reason,
        invocations: result.invocations,
        directoryPagesRead: result.directoryPagesRead,
        maintenancePagesExecuted: result.maintenancePagesExecuted,
        scopeVisits,
        scopesFailed,
        nextRunAt: Date.prototype.toISOString.call(result.nextRunAt),
      }));
    }
  }
}

function assertJsonProjection<Projection>(
  projection: Projection,
): Projection & Json {
  if (!isJson(projection)) {
    throw new TypeError(
      "Retained-history maintenance projection violated the JSON contract.",
    );
  }
  return projection;
}
