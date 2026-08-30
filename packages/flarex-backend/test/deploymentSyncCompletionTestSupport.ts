import {
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureNamespaceCursor,
  captureQueryAuthorityWitness,
  captureQueryEvaluationEvidence,
  captureQueryPublicationArtifact,
  type AdmittedInvalidationBatch,
  type GenerationRefreshEvidence,
  type QueryEvaluationAttempt,
  type QueryEvaluationEvidence,
  type QueryPublicationArtifact,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { Effect, Encoding } from "effect";

import type { DeploymentQuerySyncBinding } from "../src/deploymentSync/Binding";
import {
  canonicalKey,
  type EvaluationSqlCompletion,
  type EvaluationSqlHooks,
  type EvaluationSqlInvocation,
  type PreparedEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

export type CompletionSqlStage =
  | "contract-read"
  | "scope-read"
  | "complete-query-read"
  | "active-dependencies-read"
  | "completion-dependencies-read"
  | "pending-publication-read"
  | "complete-query-write"
  | "active-dependencies-delete"
  | "active-dependency-insert"
  | "completion-dependencies-delete"
  | "completion-dependency-insert"
  | "pending-publication-delete"
  | "pending-publication-insert"
  | "scope-write";

export const COMPLETION_COMMON_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
  "complete-query-read",
] as const satisfies readonly CompletionSqlStage[]);

export interface CompletionSqlFault {
  readonly phase: "before" | "after";
  readonly writeOrdinal: number;
  readonly cause: Error;
}

export interface CompletionSqlProbe {
  readonly hooks: EvaluationSqlHooks;
  readonly start: (fault?: CompletionSqlFault) => void;
  readonly stop: () => readonly CompletionSqlStage[];
  readonly snapshot: () => readonly CompletionSqlStage[];
}

export interface CompletionEvidenceInput {
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}

export interface CompletionEvidenceOptions {
  readonly dependencyLabels?: readonly string[];
  readonly resultSeed?: number;
  readonly evaluationWitnessSeed?: number;
  readonly refreshWitnessSeed?: number;
  readonly refreshThroughSequence?: bigint;
  readonly refreshBatches?: readonly AdmittedInvalidationBatch[];
  readonly publicationLabel?: string;
}

export function makeCompletionSqlProbe(): CompletionSqlProbe {
  let enabled = false;
  let fault: CompletionSqlFault | undefined;
  let writeOrdinal = 0;
  let stages: CompletionSqlStage[] = [];

  const hooks: EvaluationSqlHooks = Object.freeze({
    beforeExecute: (invocation: EvaluationSqlInvocation) => {
      if (!enabled) return;
      const stage = classifyCompletionSql(invocation);
      stages.push(stage);
      if (!invocation.isWrite) return;
      writeOrdinal += 1;
      if (
        fault?.phase === "before"
        && fault.writeOrdinal === writeOrdinal
      ) {
        throw fault.cause;
      }
    },
    afterExecute: (completion: EvaluationSqlCompletion) => {
      if (
        enabled
        && completion.isWrite
        && fault?.phase === "after"
        && fault.writeOrdinal === writeOrdinal
      ) {
        throw fault.cause;
      }
    },
  });

  return Object.freeze({
    hooks,
    start: (nextFault?: CompletionSqlFault) => {
      stages = [];
      writeOrdinal = 0;
      fault = nextFault;
      enabled = true;
    },
    stop: () => {
      enabled = false;
      fault = undefined;
      return Object.freeze([...stages]);
    },
    snapshot: () => Object.freeze([...stages]),
  });
}

export function captureCompletionBatch(
  binding: DeploymentQuerySyncBinding,
  sourceSequence: bigint,
  dependencyLabels: readonly string[] = [],
): AdmittedInvalidationBatch {
  return success(captureAdmittedInvalidationBatch({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    sourceSequence,
    dependencyKeys: captureDependencies(dependencyLabels),
  }));
}

export async function applyCompletionBatch(
  prepared: PreparedEvaluationState,
  batch: AdmittedInvalidationBatch,
): Promise<void> {
  await Effect.runPromise(prepared.state.applyAdmittedBatchAndAdvance(batch));
}

export function makeCompletionEvidence(
  prepared: PreparedEvaluationState,
  attempt: QueryEvaluationAttempt,
  options: CompletionEvidenceOptions = {},
): CompletionEvidenceInput {
  const authorityWitness = success(captureQueryAuthorityWitness(
    canonicalKey(options.evaluationWitnessSeed ?? 90),
  ));
  const evaluation = success(captureQueryEvaluationEvidence({
    namespaceId: prepared.binding.namespaceId,
    syncModelId: prepared.binding.syncModelId,
    sourceEpoch: prepared.binding.sourceEpoch,
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshotSequence: attempt.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalKey(options.resultSeed ?? 80),
    authorityWitness,
    dependencyKeys: captureDependencies(options.dependencyLabels ?? [
      "primary",
    ]),
  }));
  const refreshCursor = options.refreshThroughSequence === undefined
    ? attempt.registrationCursor
    : success(captureNamespaceCursor({
      namespaceId: prepared.binding.namespaceId,
      syncModelId: prepared.binding.syncModelId,
      sourceEpoch: prepared.binding.sourceEpoch,
      appliedThroughSequence: options.refreshThroughSequence,
    }));
  const refreshWitness = options.refreshWitnessSeed === undefined
    ? authorityWitness
    : success(captureQueryAuthorityWitness(
      canonicalKey(options.refreshWitnessSeed),
    ));
  const refresh = success(deriveGenerationRefreshEvidence(
    evaluation,
    refreshCursor,
    options.refreshBatches ?? [],
    refreshWitness,
  ));
  const publication = success(captureQueryPublicationArtifact({
    content: Encoding.encodeBase64Url(
      options.publicationLabel ?? "completion-publication",
    ),
  }));
  return Object.freeze({ evaluation, refresh, publication });
}

export async function completeEvaluation(
  prepared: PreparedEvaluationState,
  attempt: QueryEvaluationAttempt,
  input: CompletionEvidenceInput,
) {
  return Effect.runPromise(prepared.state.completeQueryEvaluation(
    attempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ));
}

function captureDependencies(labels: readonly string[]) {
  return Object.freeze(labels.map(label => success(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url(`dependency:${label}`),
  ))).toSorted());
}

function classifyCompletionSql(
  invocation: EvaluationSqlInvocation,
): CompletionSqlStage {
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
  ) return "complete-query-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_query_dependencies")
  ) {
    return dependencyRole(invocation) === "active"
      ? "active-dependencies-read"
      : "completion-dependencies-read";
  }
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_pending_publications")
  ) return "pending-publication-read";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_queries set")
  ) return "complete-query-write";
  if (
    sql.startsWith("delete")
    && sql.includes("main.deployment_sync_query_dependencies")
  ) {
    return dependencyRole(invocation) === "active"
      ? "active-dependencies-delete"
      : "completion-dependencies-delete";
  }
  if (
    sql.startsWith("insert")
    && sql.includes("main.deployment_sync_query_dependencies")
  ) {
    return dependencyRole(invocation) === "active"
      ? "active-dependency-insert"
      : "completion-dependency-insert";
  }
  if (
    sql.startsWith("delete")
    && sql.includes("main.deployment_sync_pending_publications")
  ) return "pending-publication-delete";
  if (
    sql.startsWith("insert")
    && sql.includes("main.deployment_sync_pending_publications")
  ) return "pending-publication-insert";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_scope_state set")
  ) return "scope-write";
  throw new Error(`Unexpected completion SQL while tracing: ${sql}`);
}

function dependencyRole(
  invocation: EvaluationSqlInvocation,
): "active" | "completion" {
  const role = invocation.bindings[0];
  if (role === "active" || role === "completion") return role;
  throw new Error(`Unexpected completion dependency role: ${String(role)}`);
}
