import type {
  CanonicalQueryKey,
  QueryGeneration,
  QuerySyncWorkRevision,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../kernel/CanonicalValue.js";
import type { QueryEvaluationAttempt } from "../kernel/EvaluationAttempt.js";
import type { QuerySyncScopeFacts } from "./Model.js";

export interface BlockedEvaluationWorkEvidence {
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly reason: "terminalEvaluatorRefusal";
  readonly resetRequired: true;
}

interface EvaluationWorkScanContinuationFields {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly observedWorkRevision: QuerySyncWorkRevision;
  readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
  readonly lastInspectedQueryKey: CanonicalQueryKey | null;
  readonly wrapped: boolean;
  readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;
}

class IssuedEvaluationWorkScanContinuation
  implements EvaluationWorkScanContinuationFields {
  declare private readonly issuedEvaluationWorkScanContinuation: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly observedWorkRevision: QuerySyncWorkRevision;
  readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
  readonly lastInspectedQueryKey: CanonicalQueryKey | null;
  readonly wrapped: boolean;
  readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;

  constructor(input: EvaluationWorkScanContinuationFields) {
    this.namespaceId = input.namespaceId;
    this.syncModelId = input.syncModelId;
    this.sourceEpoch = input.sourceEpoch;
    this.observedWorkRevision = input.observedWorkRevision;
    this.scanStartFairnessAnchor = input.scanStartFairnessAnchor;
    this.lastInspectedQueryKey = input.lastInspectedQueryKey;
    this.wrapped = input.wrapped;
    this.lowestBlockedWork = input.lowestBlockedWork === null
      ? null
      : freezeBlockedEvaluationWork(input.lowestBlockedWork);
    issuedEvaluationWorkScanContinuations.add(this);
    Object.freeze(this);
  }
}

const issuedEvaluationWorkScanContinuations = new WeakSet<object>();

export type EvaluationWorkScanContinuation =
  IssuedEvaluationWorkScanContinuation;

export interface EvaluationWorkScanRequest {
  readonly maximumQueryInspections: unknown;
  readonly continuation: EvaluationWorkScanContinuation | null;
}

export type EvaluationAttemptOutcome =
  | "transientExhausted"
  | "terminalRefusal";

export type ClaimEvaluationWorkReceipt =
  | Readonly<{
      readonly _tag: "claimed";
      readonly attempt: QueryEvaluationAttempt;
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "continued";
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "scanRestarted";
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly blockedWork: BlockedEvaluationWorkEvidence;
    }>
  | Readonly<{ readonly _tag: "none" }>;

export type RecordEvaluationAttemptOutcomeReceipt =
  | Readonly<{
      readonly _tag: "eligible";
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly blockedWork: BlockedEvaluationWorkEvidence;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
      readonly activeGeneration: QueryGeneration;
    }>
  | Readonly<{
      readonly _tag: "recoveryEvidenceExpired";
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
      readonly activeGeneration: QueryGeneration;
    }>;

export function freezeBlockedEvaluationWork(
  blockedWork: BlockedEvaluationWorkEvidence,
): BlockedEvaluationWorkEvidence {
  return Object.freeze({
    queryKey: blockedWork.queryKey,
    generation: blockedWork.generation,
    reason: "terminalEvaluatorRefusal",
    resetRequired: true,
  });
}

export function issueEvaluationWorkScanContinuation(
  scope: QuerySyncScopeFacts,
  input: {
    readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
    readonly lastInspectedQueryKey: CanonicalQueryKey | null;
    readonly wrapped: boolean;
    readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;
  },
): EvaluationWorkScanContinuation {
  return new IssuedEvaluationWorkScanContinuation({
    namespaceId: scope.cursor.namespaceId,
    syncModelId: scope.cursor.syncModelId,
    sourceEpoch: scope.cursor.sourceEpoch,
    observedWorkRevision: scope.evaluationWork.revision,
    scanStartFairnessAnchor: input.scanStartFairnessAnchor,
    lastInspectedQueryKey: input.lastInspectedQueryKey,
    wrapped: input.wrapped,
    lowestBlockedWork: input.lowestBlockedWork,
  });
}

export function isIssuedEvaluationWorkScanContinuation(
  value: unknown,
): value is EvaluationWorkScanContinuation {
  return typeof value === "object"
    && value !== null
    && issuedEvaluationWorkScanContinuations.has(value);
}

export function claimedEvaluationWorkReceipt(
  attempt: QueryEvaluationAttempt,
  continuation: EvaluationWorkScanContinuation,
): ClaimEvaluationWorkReceipt {
  return Object.freeze({ _tag: "claimed", attempt, continuation });
}

export function continuedEvaluationWorkReceipt(
  tag: "continued" | "scanRestarted",
  continuation: EvaluationWorkScanContinuation,
): ClaimEvaluationWorkReceipt {
  return Object.freeze({ _tag: tag, continuation });
}

export function blockedEvaluationWorkReceipt(
  blockedWork: BlockedEvaluationWorkEvidence,
): Extract<
  ClaimEvaluationWorkReceipt | RecordEvaluationAttemptOutcomeReceipt,
  { readonly _tag: "blocked" }
> {
  return Object.freeze({
    _tag: "blocked",
    blockedWork: freezeBlockedEvaluationWork(blockedWork),
  });
}

export function noneEvaluationWorkReceipt(): ClaimEvaluationWorkReceipt {
  return Object.freeze({ _tag: "none" });
}

export function eligibleEvaluationAttemptOutcomeReceipt(
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
): RecordEvaluationAttemptOutcomeReceipt {
  return Object.freeze({ _tag: "eligible", queryKey, generation });
}

export function historicalEvaluationAttemptOutcomeReceipt(
  tag: "superseded" | "recoveryEvidenceExpired",
  queryKey: CanonicalQueryKey,
  generation: QueryGeneration,
  activeGeneration: QueryGeneration,
): RecordEvaluationAttemptOutcomeReceipt {
  return Object.freeze({
    _tag: tag,
    queryKey,
    generation,
    activeGeneration,
  });
}
