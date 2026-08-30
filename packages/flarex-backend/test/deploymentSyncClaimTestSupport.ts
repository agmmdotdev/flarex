import type {
  EvaluationWorkScanContinuation,
  EvaluationWorkScanRequest,
} from "@flarex/query-sync/internal/kernel";
import { Effect } from "effect";

import {
  type EvaluationSqlInvocation,
  type EvaluationSqlProbe,
  makeEvaluationSqlProbe,
  type PreparedEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

export type ClaimSqlStage =
  | "contract-read"
  | "scope-read"
  | "anchor-read"
  | "scan-read"
  | "selected-query-read"
  | "selected-query-write"
  | "scope-write";

export type ClaimSqlProbe = EvaluationSqlProbe<ClaimSqlStage>;

export const CLAIM_COMMON_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
] as const satisfies readonly ClaimSqlStage[]);

export function makeClaimSqlProbe(): ClaimSqlProbe {
  return makeEvaluationSqlProbe(classifyClaimSql);
}

export function claimRequest(
  maximumQueryInspections: number,
  continuation: EvaluationWorkScanContinuation | null = null,
): EvaluationWorkScanRequest {
  return Object.freeze({ maximumQueryInspections, continuation });
}

export async function claimEvaluationWork(
  prepared: PreparedEvaluationState,
  request: EvaluationWorkScanRequest,
) {
  return Effect.runPromise(prepared.state.claimEvaluationWork(request));
}

function classifyClaimSql(invocation: EvaluationSqlInvocation): ClaimSqlStage {
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
    && !sql.includes("active_generation")
  ) return "anchor-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
    && sql.includes("active_dirty_through_sequence")
    && !sql.includes("query_identity")
  ) return "scan-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
    && sql.includes("query_identity")
  ) return "selected-query-read";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_queries set")
  ) return "selected-query-write";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_scope_state set")
  ) return "scope-write";
  throw new Error(`Unexpected claim SQL while tracing: ${sql}`);
}
