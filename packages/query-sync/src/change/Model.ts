import type { Effect, Result } from "effect";

import type {
  QueryAuthorityWitness,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  AdmittedInvalidationBatch,
  NamespaceCursor,
} from "../kernel/Model.js";
import type {
  AdmittedChangeSourceError,
  ChangeProjectionError,
  ChangeBudgetShortfallDimension,
  ChangeSourceReadError,
} from "./Errors.js";

type NonNullishAuthorityObservation = NonNullable<unknown>;

export const MAX_SOURCE_PAGE_BATCHES = 1_024;
export const MAX_SOURCE_TRANSPORT_BYTES = 16 * 1_024 * 1_024;
export const MAX_MODEL_SEMANTIC_WORK_UNITS = 65_536;
export const MAX_MODEL_SEMANTIC_BYTES = 16 * 1_024 * 1_024;
export const MAX_PROJECTED_DEPENDENCY_EXAMINATIONS = 65_536;
export const MAX_PROJECTED_CANONICAL_BYTES = 16 * 1_024 * 1_024;

export interface ChangeReadBudget {
  readonly committedBatches: number;
  readonly sourceTransportBytes: number;
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
  readonly dependencyKeyExaminations: number;
  readonly canonicalDependencyBytes: number;
}

export interface ChangeProjectionBudget {
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
  readonly dependencyKeyExaminations: number;
  readonly canonicalDependencyBytes: number;
}

export interface AuthorityProjectionBudget {
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
}

export interface ChangeProjectionMetrics {
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
  readonly dependencyKeyExaminations: number;
  readonly canonicalDependencyBytes: number;
}

export interface AuthorityProjectionMetrics {
  readonly modelSemanticWorkUnits: number;
  readonly modelSemanticBytes: number;
}

export interface ChangeSourceReadRequest {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly requestedAfterSequenceExclusive: SyncSequence;
}

export interface SourceCommittedBatch<Payload> {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly sourceSequence: SyncSequence;
  readonly payload: Payload;
}

interface ChangeSourcePageFields<Payload> {
  readonly _tag: "page";
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly requestedAfterSequenceExclusive: SyncSequence;
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly retainedFromSequenceInclusive: SyncSequence | null;
  readonly observedLatestSequence: SyncSequence;
  readonly batches: readonly SourceCommittedBatch<Payload>[];
  readonly readThroughSequence: SyncSequence;
  /** Actual bytes consumed by the raw source read, including discarded input. */
  readonly sourceTransportBytes: number;
}

export type ChangeSourcePage<
  Payload,
  AuthorityObservation extends NonNullishAuthorityObservation,
> =
  | Readonly<ChangeSourcePageFields<Payload> & {
    readonly hasMore: true;
    readonly authorityObservation: null;
  }>
  | Readonly<ChangeSourcePageFields<Payload> & {
    readonly hasMore: false;
    readonly authorityObservation: AuthorityObservation;
  }>;

interface ChangeSourceResetFields {
  readonly requestedCursor: NamespaceCursor;
  readonly currentSourceEpoch: SyncEpoch;
  readonly observedLatestSequence: SyncSequence;
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly retainedFromSequenceInclusive: SyncSequence | null;
}

export type ChangeSourceHistoryUnavailable = Readonly<
  ChangeSourceResetFields & {
    readonly _tag: "historyUnavailable";
    readonly reason: "requestedCursorBeforeReplayableHistory";
  }
>;

export type ChangeSourceEpochReplaced = Readonly<
  ChangeSourceResetFields & {
    readonly _tag: "epochReplaced";
    readonly reason: "sourceEpochChanged";
  }
>;

export interface ChangeBudgetInsufficient {
  readonly _tag: "budgetInsufficient";
  readonly requestedCursor: NamespaceCursor;
  readonly dimension: ChangeBudgetShortfallDimension;
  readonly provided: number;
  readonly requiredAtLeast: number;
  readonly reason: "nextIndivisibleUnitExceedsBudget";
}

export type RawChangeBudgetInsufficient = Readonly<
  ChangeBudgetInsufficient & {
    readonly dimension: "sourceTransportBytes";
  }
>;

export type ChangeSourceRead<
  Payload,
  AuthorityObservation extends NonNullishAuthorityObservation,
> =
  | ChangeSourcePage<Payload, AuthorityObservation>
  | ChangeSourceHistoryUnavailable
  | ChangeSourceEpochReplaced
  | RawChangeBudgetInsufficient;

export interface ReplayableChangeSource<
  Payload,
  AuthorityObservation extends NonNullishAuthorityObservation,
> {
  readonly readAfter: (
    request: ChangeSourceReadRequest,
    budget: ChangeReadBudget,
  ) => Effect.Effect<
    ChangeSourceRead<Payload, AuthorityObservation>,
    ChangeSourceReadError,
    never
  >;
}

export interface CommittedBatchProjection {
  readonly admittedBatch: AdmittedInvalidationBatch;
  readonly metrics: ChangeProjectionMetrics;
}

export interface AuthorityObservationProjection {
  readonly authorityWitness: QueryAuthorityWitness;
  readonly metrics: AuthorityProjectionMetrics;
}

export interface AuthorityObservationInput<
  AuthorityObservation extends NonNullishAuthorityObservation,
> {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly observedThroughSequence: SyncSequence;
  readonly observation: AuthorityObservation;
}

export interface InvalidationProjector<
  Payload,
  AuthorityObservation extends NonNullishAuthorityObservation,
> {
  readonly syncModelId: SyncModelId;
  /**
   * The budget is the caller's remaining bounded allowance. Implementations
   * stop at limit-plus-one and return ChangeProjectionLimitError; admission
   * translates that failure to progress-safe budget insufficiency unless the
   * caller is already exercising the portable hard ceiling.
   */
  readonly projectCommittedBatch: (
    batch: SourceCommittedBatch<Payload>,
    budget: ChangeProjectionBudget,
  ) => Result.Result<CommittedBatchProjection, ChangeProjectionError>;
  /** Uses the same remaining-caller-budget and limit-plus-one contract. */
  readonly projectAuthorityObservation: (
    input: AuthorityObservationInput<AuthorityObservation>,
    budget: AuthorityProjectionBudget,
  ) => Result.Result<AuthorityObservationProjection, ChangeProjectionError>;
}

interface CaughtUpChangeAuthorityFields {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly readThroughSequence: SyncSequence;
  readonly authorityWitness: QueryAuthorityWitness;
}

class AdmittedCaughtUpChangeAuthority
  implements CaughtUpChangeAuthorityFields
{
  declare private readonly admittedCaughtUpChangeAuthority: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly readThroughSequence: SyncSequence;
  readonly authorityWitness: QueryAuthorityWitness;

  constructor(input: CaughtUpChangeAuthorityFields) {
    this.namespaceId = input.namespaceId;
    this.syncModelId = input.syncModelId;
    this.sourceEpoch = input.sourceEpoch;
    this.readThroughSequence = input.readThroughSequence;
    this.authorityWitness = input.authorityWitness;
    Object.freeze(this);
  }
}

export type CaughtUpChangeAuthority = AdmittedCaughtUpChangeAuthority;

export function makeCaughtUpChangeAuthority(
  input: CaughtUpChangeAuthorityFields,
): CaughtUpChangeAuthority {
  return new AdmittedCaughtUpChangeAuthority(input);
}

interface AdmittedChangePageFields {
  readonly _tag: "page";
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly requestedAfterSequenceExclusive: SyncSequence;
  readonly replayableAfterSequenceExclusive: SyncSequence;
  readonly retainedFromSequenceInclusive: SyncSequence | null;
  readonly observedLatestSequence: SyncSequence;
  readonly batches: readonly AdmittedInvalidationBatch[];
  readonly readThroughSequence: SyncSequence;
  readonly sourceTransportBytes: number;
  readonly projectionMetrics: ChangeProjectionMetrics;
}

export type AdmittedChangePage =
  | Readonly<AdmittedChangePageFields & {
    readonly hasMore: true;
    readonly caughtUpAuthority: null;
  }>
  | Readonly<AdmittedChangePageFields & {
    readonly hasMore: false;
    readonly caughtUpAuthority: CaughtUpChangeAuthority;
  }>;

export type AdmittedChangeRead =
  | AdmittedChangePage
  | ChangeSourceHistoryUnavailable
  | ChangeSourceEpochReplaced
  | ChangeBudgetInsufficient;

export interface AdmittedChangeSource {
  readonly readAfter: (
    request: ChangeSourceReadRequest,
    budget: ChangeReadBudget,
  ) => Effect.Effect<AdmittedChangeRead, AdmittedChangeSourceError, never>;
}
