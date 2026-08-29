import type {
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import type {
  NamespaceCursor,
  QueryDescriptor,
} from "./Model.js";

export interface QueryEvaluationAttemptInput {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly expectedActiveGeneration: QueryGeneration | null;
  readonly registrationCursor: NamespaceCursor;
  readonly requestedDirtyThroughSequence: SyncSequence | null;
}

const issuedQueryEvaluationAttempts = new WeakSet<object>();

class IssuedQueryEvaluationAttempt
  implements QueryEvaluationAttemptInput {
  declare private readonly issuedQueryEvaluationAttempt: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly expectedActiveGeneration: QueryGeneration | null;
  readonly registrationCursor: NamespaceCursor;
  readonly requestedDirtyThroughSequence: SyncSequence | null;

  constructor(attempt: QueryEvaluationAttemptInput) {
    this.namespaceId = attempt.namespaceId;
    this.syncModelId = attempt.syncModelId;
    this.sourceEpoch = attempt.sourceEpoch;
    this.descriptor = Object.freeze({
      queryKey: attempt.descriptor.queryKey,
      queryIdentity: attempt.descriptor.queryIdentity,
    });
    this.generation = attempt.generation;
    this.expectedActiveGeneration = attempt.expectedActiveGeneration;
    this.registrationCursor = Object.freeze({
      namespaceId: attempt.registrationCursor.namespaceId,
      syncModelId: attempt.registrationCursor.syncModelId,
      sourceEpoch: attempt.registrationCursor.sourceEpoch,
      appliedThroughSequence:
        attempt.registrationCursor.appliedThroughSequence,
    });
    this.requestedDirtyThroughSequence =
      attempt.requestedDirtyThroughSequence;
    issuedQueryEvaluationAttempts.add(this);
    Object.freeze(this);
  }
}

export type QueryEvaluationAttempt = IssuedQueryEvaluationAttempt;

export function makeQueryEvaluationAttempt(
  attempt: QueryEvaluationAttemptInput,
): QueryEvaluationAttempt {
  return new IssuedQueryEvaluationAttempt(attempt);
}

export function isIssuedQueryEvaluationAttempt(
  value: unknown,
): value is QueryEvaluationAttempt {
  return typeof value === "object"
    && value !== null
    && issuedQueryEvaluationAttempts.has(value);
}
