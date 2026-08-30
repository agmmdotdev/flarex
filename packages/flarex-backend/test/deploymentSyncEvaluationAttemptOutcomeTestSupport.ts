import type {
  EvaluationAttemptOutcome,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import { Effect } from "effect";

import {
  type EvaluationSqlInvocation,
  type EvaluationSqlProbe,
  makeEvaluationSqlProbe,
  type PreparedEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

export type AttemptOutcomeSqlStage =
  | "contract-read"
  | "scope-read"
  | "attempt-outcome-query-read"
  | "attempt-outcome-query-write"
  | "scope-write";

export type AttemptOutcomeSqlProbe =
  EvaluationSqlProbe<AttemptOutcomeSqlStage>;

export const ATTEMPT_OUTCOME_COMMON_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
  "attempt-outcome-query-read",
] as const satisfies readonly AttemptOutcomeSqlStage[]);

export const ATTEMPT_OUTCOME_WRITE_STAGES = Object.freeze([
  ...ATTEMPT_OUTCOME_COMMON_READ_STAGES,
  "attempt-outcome-query-write",
  "scope-write",
] as const satisfies readonly AttemptOutcomeSqlStage[]);

export function makeAttemptOutcomeSqlProbe(): AttemptOutcomeSqlProbe {
  return makeEvaluationSqlProbe(classifyAttemptOutcomeSql);
}

export async function claimEvaluationAttempt(
  prepared: PreparedEvaluationState,
): Promise<QueryEvaluationAttempt> {
  const receipt = await Effect.runPromise(
    prepared.state.claimEvaluationWork({
      maximumQueryInspections: 1,
      continuation: null,
    }),
  );
  if (receipt._tag !== "claimed") {
    throw new Error(`Expected claimed evaluation, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

export async function recordEvaluationOutcome(
  prepared: PreparedEvaluationState,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
) {
  return Effect.runPromise(
    prepared.state.recordEvaluationAttemptOutcome(attempt, outcome),
  );
}

function classifyAttemptOutcomeSql(
  invocation: EvaluationSqlInvocation,
): AttemptOutcomeSqlStage {
  const sql = invocation.query.replace(/\s+/gu, " ").trim().toLowerCase();
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_contract_state")
  ) return "contract-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_scope_state")
  ) return "scope-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
  ) return "attempt-outcome-query-read";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_queries set")
  ) return "attempt-outcome-query-write";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_scope_state set")
  ) return "scope-write";
  throw new Error(`Unexpected attempt-outcome SQL while tracing: ${sql}`);
}
