import type {
  AcceptedQueryPublicationEvidence,
  PublicationAttempt,
  PublicationAttemptInstant,
} from "@flarex/query-sync/internal/kernel";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "@flarex/query-sync/testing/conformance";
import { Effect } from "effect";

import {
  DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
} from "../src/deploymentSync/PublicationClock";
import {
  makeDeploymentQuerySyncPublicationOperations,
} from "../src/deploymentSync/PublicationState";
import {
  bindDeploymentQuerySyncStorage,
} from "../src/deploymentSync/StateStorage";
import type {
  DeploymentQuerySyncState,
} from "../src/deploymentSync/Store";
import {
  beginEvaluation,
  completionInput,
  type EvaluationSqlInvocation,
  makeEvaluationSqlProbe,
  type PreparedEvaluationState,
  queryDescriptor,
} from "./deploymentSyncEvaluationStateTestSupport";

export type DeploymentQuerySyncPublicationOperations = Pick<
  DeploymentQuerySyncState,
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
>;

export type PublicationSqlStage =
  | "contract-read"
  | "scope-read"
  | "clock-read"
  | "in-flight-read"
  | "publication-state-read"
  | "pending-selection-read"
  | "pending-owner-read"
  | "owner-read"
  | "pending-publication-delete"
  | "in-flight-publication-insert"
  | "in-flight-publication-delete"
  | "publication-state-cas"
  | "scope-cas";

const expectedClockSql = normalizeSql(
  DEPLOYMENT_QUERY_SYNC_PUBLICATION_CLOCK_SQL,
);

export const EMPTY_CLAIM_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
  "clock-read",
  "in-flight-read",
  "publication-state-read",
  "pending-selection-read",
] as const satisfies readonly PublicationSqlStage[]);

export const IN_FLIGHT_CLAIM_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
  "clock-read",
  "in-flight-read",
  "publication-state-read",
  "owner-read",
] as const satisfies readonly PublicationSqlStage[]);

export const PENDING_CLAIM_READ_STAGES = Object.freeze([
  ...EMPTY_CLAIM_READ_STAGES,
  "pending-owner-read",
] as const satisfies readonly PublicationSqlStage[]);

export const OUTCOME_READ_STAGES = IN_FLIGHT_CLAIM_READ_STAGES;

export const COMPLETION_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
  "in-flight-read",
  "publication-state-read",
  "owner-read",
] as const satisfies readonly PublicationSqlStage[]);

export function makePublicationSqlProbe() {
  return makeEvaluationSqlProbe(classifyPublicationSql);
}

export function makeDeterministicPublicationOperations(
  prepared: PreparedEvaluationState,
  instants: readonly PublicationAttemptInstant[],
): Readonly<{
  readonly operations: DeploymentQuerySyncPublicationOperations;
  readonly clockReads: () => number;
}> {
  let clockReads = 0;
  const operations = makeDeploymentQuerySyncPublicationOperations(
    bindDeploymentQuerySyncStorage(prepared.storage),
    prepared.binding,
    () => {
      const instant = instants[clockReads];
      if (instant === undefined) {
        throw new Error("Deterministic publication clock was exhausted.");
      }
      clockReads += 1;
      return instant;
    },
  );
  return Object.freeze({ operations, clockReads: () => clockReads });
}

export async function installPendingPublication(
  prepared: PreparedEvaluationState,
  seed: number,
  label: string,
): Promise<void> {
  const evaluationAttempt = await beginEvaluation(
    prepared,
    queryDescriptor(seed),
  );
  const input = completionInput(prepared, evaluationAttempt, label);
  const receipt = await Effect.runPromise(prepared.state.completeQueryEvaluation(
    evaluationAttempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ));
  if (receipt._tag !== "completed") {
    throw new Error(
      `Expected completed evaluation, received ${receipt._tag}.`,
    );
  }
}

export async function claimInstalledPublication(
  prepared: PreparedEvaluationState,
  operations: DeploymentQuerySyncPublicationOperations = prepared.state,
): Promise<PublicationAttempt> {
  const receipt = await Effect.runPromise(operations.claimPublication());
  if (receipt._tag !== "claimed") {
    throw new Error(`Expected publication claim, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

export function acceptanceFor(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence {
  return makeAcceptedQueryPublicationEvidenceForTesting({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

export function classifyPublicationSql(
  invocation: EvaluationSqlInvocation,
): PublicationSqlStage {
  const query = normalizeSql(invocation.query);
  if (invocation.isWrite) {
    if (query.startsWith(
      "delete from main.deployment_sync_pending_publications",
    )) return "pending-publication-delete";
    if (query.startsWith(
      "insert into main.deployment_sync_in_flight_publication",
    )) return "in-flight-publication-insert";
    if (query.startsWith(
      "delete from main.deployment_sync_in_flight_publication",
    )) return "in-flight-publication-delete";
    if (query.startsWith(
      "update main.deployment_sync_publication_state",
    )) return "publication-state-cas";
    if (query.startsWith(
      "update main.deployment_sync_scope_state",
    )) return "scope-cas";
    throw new Error(`Unexpected publication write SQL: ${query}`);
  }
  if (query === expectedClockSql) return "clock-read";
  if (query.includes(
    "from main.deployment_sync_contract_state",
  )) return "contract-read";
  if (query.includes(
    "from main.deployment_sync_scope_state",
  )) return "scope-read";
  if (query.includes(
    "from main.deployment_sync_in_flight_publication",
  )) return "in-flight-read";
  if (query.includes(
    "from main.deployment_sync_publication_state",
  )) return "publication-state-read";
  if (query.includes("from main.deployment_sync_queries")
    && query.includes(
      "select query_key from main.deployment_sync_pending_publications",
    )) return "pending-owner-read";
  if (query.includes(
    "from main.deployment_sync_pending_publications",
  )) return "pending-selection-read";
  if (query.includes(
    "from main.deployment_sync_queries",
  )) return "owner-read";
  throw new Error(`Unexpected publication read SQL: ${query}`);
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/gu, " ").trim().toLowerCase();
}
