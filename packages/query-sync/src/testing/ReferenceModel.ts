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
  BeginQueryGenerationDecision,
  BuildQuerySyncStateError,
  CompleteQueryGenerationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
  QuerySyncState,
} from "../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryGeneration,
  completeQueryGeneration,
} from "../kernel/Policy.js";
import {
  admitGenerationRefreshEvidenceForOperation,
} from "../change/Admission.js";
import { makeCaughtUpChangeAuthority } from "../change/Model.js";
import type {
  ApplyInvalidationsError,
  BeginQueryGenerationError,
  CompleteQueryGenerationError,
} from "../kernel/Policy.js";

export interface QuerySyncReferenceModel {
  readonly state: QuerySyncState;
}

export type ReferenceModelCommand =
  | Readonly<{
    readonly _tag: "beginQueryGeneration";
    readonly target: QueryOperationTarget;
  }>
  | Readonly<{
    readonly _tag: "applyAdmittedInvalidations";
    readonly batch: AdmittedInvalidationBatch;
  }>
  | Readonly<{
    readonly _tag: "completeQueryGeneration";
    readonly evaluation: QueryEvaluationEvidence;
    readonly refresh: GenerationRefreshEvidence;
  }>;

export type ReferenceModelDecision =
  | BeginQueryGenerationDecision
  | ApplyInvalidationsDecision
  | CompleteQueryGenerationDecision;

export interface ReferenceModelTransition {
  readonly model: QuerySyncReferenceModel;
  readonly decision: ReferenceModelDecision;
}

export type ReferenceModelError =
  | BeginQueryGenerationError
  | ApplyInvalidationsError
  | CompleteQueryGenerationError;

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
    case "beginQueryGeneration":
      return beginQueryGeneration(model.state, command.target).pipe(
        Result.map(freezeTransition),
      );
    case "applyAdmittedInvalidations":
      return applyAdmittedInvalidations(model.state, command.batch).pipe(
        Result.map(freezeTransition),
      );
    case "completeQueryGeneration":
      return completeQueryGeneration(
        model.state,
        command.evaluation,
        command.refresh,
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
