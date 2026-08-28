import { Encoding, Result } from "effect";

import { captureCanonicalDependencyKey } from "../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  QueryAuthorityWitness,
} from "../kernel/CanonicalValue.js";
import type {
  InvalidRefreshEvidenceError,
  QuerySyncAuthorityError,
  QuerySyncCanonicalValueError,
  QuerySyncWorkLimitError,
} from "../kernel/Errors.js";
import {
  createEmptyQuerySyncState,
} from "../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  CompleteQueryEvaluationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncState,
} from "../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
} from "../kernel/Policy.js";
import {
  admitGenerationRefreshEvidenceForOperation,
} from "../change/Admission.js";
import { makeCaughtUpChangeAuthority } from "../change/Model.js";
import type {
  ApplyInvalidationsError,
  BeginQueryEvaluationError,
  CompleteQueryEvaluationError,
} from "../kernel/Policy.js";
import type { QueryPublicationArtifact } from "../kernel/Publication.js";

export interface QuerySyncReferenceModel {
  readonly state: QuerySyncState;
}

export type ReferenceModelCommand =
  | Readonly<{
    readonly _tag: "beginQueryEvaluation";
    readonly request: BeginQueryEvaluationRequest;
  }>
  | Readonly<{
    readonly _tag: "applyAdmittedInvalidations";
    readonly batch: AdmittedInvalidationBatch;
  }>
  | Readonly<{
    readonly _tag: "completeQueryEvaluation";
    readonly attempt: QueryEvaluationAttempt;
    readonly evaluation: QueryEvaluationEvidence;
    readonly refresh: GenerationRefreshEvidence;
    readonly publication: QueryPublicationArtifact;
  }>;

export type ReferenceModelDecision =
  | BeginQueryEvaluationDecision
  | ApplyInvalidationsDecision
  | CompleteQueryEvaluationDecision;

export interface ReferenceModelTransition {
  readonly model: QuerySyncReferenceModel;
  readonly decision: ReferenceModelDecision;
}

export type ReferenceModelError =
  | BeginQueryEvaluationError
  | ApplyInvalidationsError
  | CompleteQueryEvaluationError;

export type RefreshEvidenceError =
  | QuerySyncAuthorityError<"deriveGenerationRefreshEvidence">
  | InvalidRefreshEvidenceError<"deriveGenerationRefreshEvidence">
  | QuerySyncWorkLimitError<"deriveGenerationRefreshEvidence">;

function freezeReferenceModel(
  state: QuerySyncState,
): QuerySyncReferenceModel {
  return Object.freeze({ state });
}

function freezeTransition(
  decision: ReferenceModelDecision,
): ReferenceModelTransition {
  return Object.freeze({
    model: freezeReferenceModel(decision.state),
    decision,
  });
}

export function createReferenceModel(
  cursor: NamespaceCursor,
): Result.Result<QuerySyncReferenceModel, BuildQuerySyncStateError> {
  return createEmptyQuerySyncState(cursor).pipe(Result.map(freezeReferenceModel));
}

export function reduceReferenceModel(
  model: QuerySyncReferenceModel,
  command: ReferenceModelCommand,
): Result.Result<ReferenceModelTransition, ReferenceModelError> {
  switch (command._tag) {
    case "beginQueryEvaluation":
      return beginQueryEvaluation(model.state, command.request).pipe(
        Result.map(freezeTransition),
      );
    case "applyAdmittedInvalidations":
      return applyAdmittedInvalidations(model.state, command.batch).pipe(
        Result.map(freezeTransition),
      );
    case "completeQueryEvaluation":
      return completeQueryEvaluation(
        model.state,
        command.attempt,
        command.evaluation,
        command.refresh,
        command.publication,
      ).pipe(Result.map(freezeTransition));
  }
}

export function deriveGenerationRefreshEvidence(
  evaluation: QueryEvaluationEvidence,
  targetCursor: NamespaceCursor,
  batches: readonly AdmittedInvalidationBatch[],
  authorityWitness: QueryAuthorityWitness,
): Result.Result<GenerationRefreshEvidence, RefreshEvidenceError> {
  return admitGenerationRefreshEvidenceForOperation(
    "deriveGenerationRefreshEvidence",
    evaluation,
    batches,
    makeCaughtUpChangeAuthority({
      namespaceId: targetCursor.namespaceId,
      syncModelId: targetCursor.syncModelId,
      sourceEpoch: targetCursor.sourceEpoch,
      readThroughSequence: targetCursor.appliedThroughSequence,
      authorityWitness,
    }),
  );
}

function captureSyntheticDependencyKey(
  modelPrefix: "kv" | "graph",
  canonicalFragment: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureCanonicalDependencyKey(Encoding.encodeBase64Url(
    `${modelPrefix}\0${canonicalFragment}`,
  ));
}

export function captureKeyValueDependencyKey(
  key: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureSyntheticDependencyKey("kv", key);
}

export function captureGraphDependencyKey(
  edge: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureSyntheticDependencyKey("graph", edge);
}

export interface SyntheticReferenceModelFixture {
  readonly syncModelId: string;
  readonly captureDependencyKey: (
    canonicalFragment: string,
  ) => Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError>;
}

export const KEY_VALUE_REFERENCE_MODEL_FIXTURE:
  SyntheticReferenceModelFixture = Object.freeze({
  syncModelId: "synthetic-key-value",
  captureDependencyKey: captureKeyValueDependencyKey,
});

export const GRAPH_REFERENCE_MODEL_FIXTURE:
  SyntheticReferenceModelFixture = Object.freeze({
  syncModelId: "synthetic-graph",
  captureDependencyKey: captureGraphDependencyKey,
});
