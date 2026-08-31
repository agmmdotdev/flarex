import type {
  EvaluationAttemptOutcome,
  QueryDescriptor,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import {
  makeQueryEvaluationAttemptForTesting,
} from "@flarex/query-sync/testing/conformance";
import { Effect } from "effect";

import {
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  type EvaluationSqlInvocation,
  type EvaluationSqlProbe,
  makeEvaluationSqlProbe,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
} from "./deploymentSyncEvaluationStateTestSupport";

export type AttemptOutcomeSqlStage =
  | "contract-read"
  | "scope-read"
  | "attempt-outcome-query-read"
  | "attempt-outcome-query-write"
  | "scope-write";

export type AttemptOutcomeSqlProbe =
  EvaluationSqlProbe<AttemptOutcomeSqlStage>;

type QueryEvaluationAttemptInput = Parameters<
  typeof makeQueryEvaluationAttemptForTesting
>[0];

export interface AttemptOutcomeFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: AttemptOutcomeSqlProbe;
  readonly descriptor: QueryDescriptor;
  readonly attempt: QueryEvaluationAttempt;
}

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

export async function prepareReadyAttemptOutcomeFixture(
  seed: number,
): Promise<AttemptOutcomeFixture> {
  const probe = makeAttemptOutcomeSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(seed);
  const attempt = await beginEvaluation(prepared, descriptor);
  return Object.freeze({ prepared, probe, descriptor, attempt });
}

export async function prepareCompletedAttemptOutcomeFixture(
  seed: number,
): Promise<AttemptOutcomeFixture> {
  const fixture = await prepareReadyAttemptOutcomeFixture(seed);
  const receipt = await completeEvaluation(
    fixture.prepared,
    fixture.attempt,
    makeCompletionEvidence(fixture.prepared, fixture.attempt, {
      dependencyLabels: ["attempt-outcome-boundary"],
      publicationLabel: `attempt-outcome-boundary-${seed}`,
    }),
  );
  if (receipt._tag !== "completed") {
    fixture.prepared.database.close();
    throw new Error(`Expected completed evaluation, received ${receipt._tag}.`);
  }
  return fixture;
}

export function reissueEvaluationAttemptForTesting(
  attempt: QueryEvaluationAttempt,
  overrides: Partial<QueryEvaluationAttemptInput>,
): QueryEvaluationAttempt {
  const descriptor = overrides.descriptor ?? attempt.descriptor;
  const registrationCursor = overrides.registrationCursor
    ?? attempt.registrationCursor;
  return makeQueryEvaluationAttemptForTesting({
    namespaceId: overrides.namespaceId ?? attempt.namespaceId,
    syncModelId: overrides.syncModelId ?? attempt.syncModelId,
    sourceEpoch: overrides.sourceEpoch ?? attempt.sourceEpoch,
    descriptor: Object.freeze({ ...descriptor }),
    generation: overrides.generation ?? attempt.generation,
    expectedActiveGeneration: Object.hasOwn(overrides, "expectedActiveGeneration")
      ? overrides.expectedActiveGeneration ?? null
      : attempt.expectedActiveGeneration,
    registrationCursor: Object.freeze({ ...registrationCursor }),
    requestedDirtyThroughSequence: Object.hasOwn(
      overrides,
      "requestedDirtyThroughSequence",
    )
      ? overrides.requestedDirtyThroughSequence ?? null
      : attempt.requestedDirtyThroughSequence,
  });
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
