import { Result } from "effect";

import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  compareCanonicalBase64Url,
  successorQueryGeneration,
  successorQuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidEvaluationWorkContinuationError,
  InvalidEvaluationWorkScanRequestError,
  QueryGenerationExhaustedError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "../kernel/Errors.js";
import { makeQueryEvaluationAttempt } from "../kernel/EvaluationAttempt.js";
import type { QueryEvaluationAttempt } from "../kernel/EvaluationAttempt.js";
import type {
  ProvisionalQueryState,
  QueryDescriptor,
} from "../kernel/Model.js";
import {
  applyMetricReplacement,
  provisionalMetricContribution,
  scopeMetricContribution,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import {
  blockedEvaluationWorkReceipt,
  claimedEvaluationWorkReceipt,
  continuedEvaluationWorkReceipt,
  freezeBlockedEvaluationWork,
  isIssuedEvaluationWorkScanContinuation,
  issueEvaluationWorkScanContinuation,
  noneEvaluationWorkReceipt,
} from "./EvaluationWork.js";
import type {
  BlockedEvaluationWorkEvidence,
  ClaimEvaluationWorkReceipt,
  EvaluationWorkScanContinuation,
  EvaluationWorkScanRequest,
} from "./EvaluationWork.js";
import {
  QuerySyncTransitionFactError,
  QuerySyncTransitionResumeDefect,
} from "./Errors.js";
import {
  freezeActiveScalarFacts,
  freezeProvisionalFacts,
} from "./Facts.js";
import type { ActiveQueryScalarFacts } from "./Facts.js";
import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_EVALUATION_WORK_QUERY_SENTINEL,
} from "./Limits.js";
import {
  activeScalarFactsValid,
  provisionalQueryFactsValid,
} from "./LocalInvariants.js";
import {
  freezeScopeFacts,
  plannedStep,
  readStep,
} from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
  TransitionStep,
} from "./Model.js";

export {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_EVALUATION_WORK_QUERY_SENTINEL,
} from "./Limits.js";

export type EvaluationWorkScanDisposition =
  | Readonly<{ readonly _tag: "ready" }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly reason: "terminalEvaluatorRefusal";
      readonly resetRequired: true;
    }>;

export interface EvaluationWorkScanFacts {
  readonly queryKey: CanonicalQueryKey;
  readonly active: Readonly<{
    readonly generation: QueryGeneration;
    readonly dirtyThroughSequence: SyncSequence | null;
  }> | null;
  readonly provisional: Readonly<{
    readonly generation: QueryGeneration;
    readonly evaluationDisposition: EvaluationWorkScanDisposition;
  }> | null;
}

export interface EvaluationSelectedQueryFacts {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryScalarFacts | null;
  readonly provisional: ProvisionalQueryState | null;
}

export interface ReadEvaluationWorkScanFactsIntent {
  readonly _tag: "readEvaluationWorkScanFacts";
  readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
  readonly lastInspectedQueryKey: CanonicalQueryKey | null;
  readonly maximumPageQueryInspections: number;
  readonly maximumCombinedQueryFacts:
    typeof MAX_EVALUATION_WORK_QUERY_SENTINEL;
}

export interface ReadEvaluationSelectedQueryFactsIntent {
  readonly _tag: "readEvaluationSelectedQueryFacts";
  readonly queryKey: CanonicalQueryKey;
}

export type EvaluationWorkScanFactsRead =
  | Readonly<{
      readonly _tag: "complete";
      /** Proves that the durable fairness anchor still names a query row. */
      readonly fairnessAnchorPresent: boolean;
      readonly revalidationPrefix: readonly EvaluationWorkScanFacts[];
      readonly page: readonly EvaluationWorkScanFacts[];
      readonly hasMore: boolean;
    }>
  | Readonly<{
      readonly _tag: "limitExceeded";
      readonly observed: number;
    }>;

export interface ClaimEvaluationWorkExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly query: EvaluationSelectedQueryFacts;
}

export type ClaimEvaluationWorkChange =
  | Readonly<{
      readonly _tag: "claimReadyEvaluationWork";
      readonly queryKey: CanonicalQueryKey;
    }>
  | Readonly<{
      readonly _tag: "claimDirtyEvaluationWork";
      readonly queryKey: CanonicalQueryKey;
      readonly provisional: ProvisionalQueryState;
    }>;

export type ClaimEvaluationWorkPlan = TransitionPlan<
  ClaimEvaluationWorkReceipt,
  ClaimEvaluationWorkExpectation,
  ClaimEvaluationWorkChange
>;

interface ClaimEvaluationWorkScanResumeState {
  readonly scope: QuerySyncScopeFacts;
  readonly maximumQueryInspections: number;
  readonly continuation: EvaluationWorkScanContinuation;
}

class IssuedClaimEvaluationWorkScanResume {
  declare private readonly issuedClaimEvaluationWorkScanResume: void;
}

export type ClaimEvaluationWorkScanResume =
  IssuedClaimEvaluationWorkScanResume;

type RunnableEvaluationWorkCandidate =
  | Readonly<{
      readonly _tag: "readyProvisional";
      readonly scanFacts: EvaluationWorkScanFacts;
    }>
  | Readonly<{
      readonly _tag: "dirtyActive";
      readonly scanFacts: EvaluationWorkScanFacts;
    }>;

interface ClaimEvaluationWorkSelectedQueryResumeState {
  readonly scope: QuerySyncScopeFacts;
  readonly candidate: RunnableEvaluationWorkCandidate;
}

class IssuedClaimEvaluationWorkSelectedQueryResume {
  declare private readonly issuedClaimEvaluationWorkSelectedQueryResume: void;
}

export type ClaimEvaluationWorkSelectedQueryResume =
  IssuedClaimEvaluationWorkSelectedQueryResume;

const scanResumes = new WeakMap<
  IssuedClaimEvaluationWorkScanResume,
  ClaimEvaluationWorkScanResumeState
>();

const selectedQueryResumes = new WeakMap<
  IssuedClaimEvaluationWorkSelectedQueryResume,
  ClaimEvaluationWorkSelectedQueryResumeState
>();

export type StartClaimEvaluationWorkError =
  | InvalidEvaluationWorkScanRequestError
  | InvalidEvaluationWorkContinuationError
  | QuerySyncAuthorityError<"claimEvaluationWork">
  | QuerySyncTransitionFactError;

export type ResumeClaimEvaluationWorkScanError =
  | InvalidEvaluationWorkContinuationError
  | QuerySyncTransitionFactError;

export type ResumeClaimEvaluationWorkSelectedQueryError =
  | QueryGenerationExhaustedError<"claimEvaluationWork">
  | QuerySyncWorkRevisionExhaustedError<"claimEvaluationWork">
  | QuerySyncStateLimitError
  | QuerySyncTransitionFactError;

function factFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "claimEvaluationWork",
    reason: "evaluationScanFactsInvalid",
  });
}

function selectedQueryFactFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "claimEvaluationWork",
    reason: "evaluationSelectedQueryFactsInvalid",
  });
}

function invalidContinuation(): InvalidEvaluationWorkContinuationError {
  return new InvalidEvaluationWorkContinuationError({
    operation: "claimEvaluationWork",
    reason: "notStateIssued",
  });
}

function noWritePlan(
  receipt: ClaimEvaluationWorkReceipt,
): ClaimEvaluationWorkPlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function freezeScanDisposition(
  disposition: EvaluationWorkScanDisposition,
): EvaluationWorkScanDisposition {
  return disposition._tag === "ready"
    ? Object.freeze({ _tag: "ready" })
    : Object.freeze({
      _tag: "blocked",
      reason: disposition.reason,
      resetRequired: disposition.resetRequired,
    });
}

export function freezeEvaluationWorkScanFacts(
  facts: EvaluationWorkScanFacts,
): EvaluationWorkScanFacts {
  return Object.freeze({
    queryKey: facts.queryKey,
    active: facts.active === null
      ? null
      : Object.freeze({
        generation: facts.active.generation,
        dirtyThroughSequence: facts.active.dirtyThroughSequence,
      }),
    provisional: facts.provisional === null
      ? null
      : Object.freeze({
        generation: facts.provisional.generation,
        evaluationDisposition: freezeScanDisposition(
          facts.provisional.evaluationDisposition,
        ),
      }),
  });
}

function freezeDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

export function freezeEvaluationSelectedQueryFacts(
  facts: EvaluationSelectedQueryFacts,
): EvaluationSelectedQueryFacts {
  return Object.freeze({
    descriptor: freezeDescriptor(facts.descriptor),
    active: facts.active === null
      ? null
      : freezeActiveScalarFacts(facts.active),
    provisional: facts.provisional === null
      ? null
      : freezeProvisionalFacts(facts.provisional),
  });
}

function issueScanResume(
  state: ClaimEvaluationWorkScanResumeState,
): ClaimEvaluationWorkScanResume {
  const resume = new IssuedClaimEvaluationWorkScanResume();
  scanResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function issueSelectedQueryResume(
  state: ClaimEvaluationWorkSelectedQueryResumeState,
): ClaimEvaluationWorkSelectedQueryResume {
  const resume = new IssuedClaimEvaluationWorkSelectedQueryResume();
  selectedQueryResumes.set(resume, state);
  Object.freeze(resume);
  return resume;
}

function scanResumeState(
  resume: ClaimEvaluationWorkScanResume,
): ClaimEvaluationWorkScanResumeState {
  const state = scanResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "claimEvaluationWork",
      stage: "evaluationScanFacts",
    });
  }
  return state;
}

function selectedQueryResumeState(
  resume: ClaimEvaluationWorkSelectedQueryResume,
): ClaimEvaluationWorkSelectedQueryResumeState {
  const state = selectedQueryResumes.get(resume);
  if (state === undefined) {
    throw new QuerySyncTransitionResumeDefect({
      operation: "claimEvaluationWork",
      stage: "evaluationSelectedQueryFacts",
    });
  }
  return state;
}

function freshContinuation(
  scope: QuerySyncScopeFacts,
): EvaluationWorkScanContinuation {
  return issueEvaluationWorkScanContinuation(scope, {
    scanStartFairnessAnchor: scope.evaluationWork.fairnessAnchor,
    lastInspectedQueryKey: null,
    wrapped: false,
    lowestBlockedWork: null,
  });
}

function scanIntent(
  continuation: EvaluationWorkScanContinuation,
  maximumQueryInspections: number,
): ReadEvaluationWorkScanFactsIntent {
  return Object.freeze({
    _tag: "readEvaluationWorkScanFacts",
    scanStartFairnessAnchor: continuation.scanStartFairnessAnchor,
    lastInspectedQueryKey: continuation.lastInspectedQueryKey,
    maximumPageQueryInspections: maximumQueryInspections,
    maximumCombinedQueryFacts: MAX_EVALUATION_WORK_QUERY_SENTINEL,
  });
}

function scanStep(
  state: ClaimEvaluationWorkScanResumeState,
): Readonly<{
  readonly _tag: "read";
  readonly intent: ReadEvaluationWorkScanFactsIntent;
  readonly resume: ClaimEvaluationWorkScanResume;
}> {
  const captured = Object.freeze({
    scope: state.scope,
    maximumQueryInspections: state.maximumQueryInspections,
    continuation: state.continuation,
  });
  return readStep(
    scanIntent(state.continuation, state.maximumQueryInspections),
    issueScanResume(captured),
  );
}

function scanDispositionValid(
  disposition: EvaluationWorkScanDisposition,
): boolean {
  return disposition._tag === "ready"
    || (
      disposition._tag === "blocked"
      && disposition.reason === "terminalEvaluatorRefusal"
      && disposition.resetRequired === true
    );
}

function scanFactsValid(
  scope: QuerySyncScopeFacts,
  facts: EvaluationWorkScanFacts,
): boolean {
  const active = facts.active;
  const provisional = facts.provisional;
  if (active === null && provisional === null) return false;
  const provisionalGenerationValid = provisional === null
    || (active === null
      ? provisional.generation === 1n
      : successorQueryGeneration(active.generation) === provisional.generation);
  return provisionalGenerationValid
    && (
      active?.dirtyThroughSequence === null
      || active?.dirtyThroughSequence === undefined
      || active.dirtyThroughSequence
        <= scope.cursor.appliedThroughSequence
    )
    && (
      provisional === null
      || scanDispositionValid(provisional.evaluationDisposition)
    );
}

function isWrapped(
  anchor: CanonicalQueryKey | null,
  queryKey: CanonicalQueryKey,
): boolean {
  return anchor !== null
    && compareCanonicalBase64Url(queryKey, anchor) <= 0;
}

function cyclicSegment(
  anchor: CanonicalQueryKey | null,
  queryKey: CanonicalQueryKey,
): 0 | 1 {
  return anchor !== null
      && compareCanonicalBase64Url(queryKey, anchor) <= 0
    ? 1
    : 0;
}

function factsAreInCanonicalCyclicOrder(
  facts: readonly EvaluationWorkScanFacts[],
  anchor: CanonicalQueryKey | null,
): boolean {
  for (let index = 1; index < facts.length; index += 1) {
    const previous = facts[index - 1];
    const current = facts[index];
    if (previous === undefined || current === undefined) return false;
    const previousSegment = cyclicSegment(anchor, previous.queryKey);
    const currentSegment = cyclicSegment(anchor, current.queryKey);
    if (
      previousSegment > currentSegment
      || (
        previousSegment === currentSegment
        && compareCanonicalBase64Url(
          previous.queryKey,
          current.queryKey,
        ) >= 0
      )
    ) {
      return false;
    }
  }
  return true;
}

function blockedWorkForScanFacts(
  facts: EvaluationWorkScanFacts,
): BlockedEvaluationWorkEvidence | null {
  const provisional = facts.provisional;
  return provisional?.evaluationDisposition._tag === "blocked"
    ? freezeBlockedEvaluationWork({
      queryKey: facts.queryKey,
      generation: provisional.generation,
      reason: "terminalEvaluatorRefusal",
      resetRequired: true,
    })
    : null;
}

function lowerBlockedWork(
  current: BlockedEvaluationWorkEvidence | null,
  candidate: BlockedEvaluationWorkEvidence | null,
): BlockedEvaluationWorkEvidence | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return compareCanonicalBase64Url(candidate.queryKey, current.queryKey) < 0
    ? candidate
    : current;
}

function blockedWorkEquals(
  left: BlockedEvaluationWorkEvidence | null,
  right: BlockedEvaluationWorkEvidence | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.queryKey === right.queryKey
    && left.generation === right.generation
    && left.reason === right.reason
    && left.resetRequired === right.resetRequired;
}

function revalidatePrefix(
  continuation: EvaluationWorkScanContinuation,
  prefix: readonly EvaluationWorkScanFacts[],
): Result.Result<
  BlockedEvaluationWorkEvidence | null,
  InvalidEvaluationWorkContinuationError
> {
  if (!factsAreInCanonicalCyclicOrder(
    prefix,
    continuation.scanStartFairnessAnchor,
  )) {
    return Result.fail(invalidContinuation());
  }
  if (continuation.lastInspectedQueryKey === null) {
    return prefix.length === 0
        && continuation.wrapped === false
        && continuation.lowestBlockedWork === null
      ? Result.succeed(null)
      : Result.fail(invalidContinuation());
  }
  const last = prefix[prefix.length - 1];
  if (
    last === undefined
    || last.queryKey !== continuation.lastInspectedQueryKey
    || continuation.wrapped !== isWrapped(
      continuation.scanStartFairnessAnchor,
      last.queryKey,
    )
  ) {
    return Result.fail(invalidContinuation());
  }
  let lowestBlocked: BlockedEvaluationWorkEvidence | null = null;
  for (const facts of prefix) {
    lowestBlocked = lowerBlockedWork(
      lowestBlocked,
      blockedWorkForScanFacts(facts),
    );
  }
  return blockedWorkEquals(
    continuation.lowestBlockedWork,
    lowestBlocked,
  )
    ? Result.succeed(lowestBlocked)
    : Result.fail(invalidContinuation());
}

function candidateForScanFacts(
  facts: EvaluationWorkScanFacts,
): RunnableEvaluationWorkCandidate | null {
  if (facts.provisional !== null) {
    return facts.provisional.evaluationDisposition._tag === "ready"
      ? Object.freeze({
        _tag: "readyProvisional",
        scanFacts: facts,
      })
      : null;
  }
  return facts.active?.dirtyThroughSequence === null
      || facts.active?.dirtyThroughSequence === undefined
    ? null
    : Object.freeze({ _tag: "dirtyActive", scanFacts: facts });
}

function selectedQueryReadStep(
  scope: QuerySyncScopeFacts,
  candidate: RunnableEvaluationWorkCandidate,
): Readonly<{
  readonly _tag: "read";
  readonly intent: ReadEvaluationSelectedQueryFactsIntent;
  readonly resume: ClaimEvaluationWorkSelectedQueryResume;
}> {
  const state = Object.freeze({ scope, candidate });
  return readStep(Object.freeze({
    _tag: "readEvaluationSelectedQueryFacts",
    queryKey: candidate.scanFacts.queryKey,
  }), issueSelectedQueryResume(state));
}

function pointMatchesCandidate(
  query: EvaluationSelectedQueryFacts,
  candidate: RunnableEvaluationWorkCandidate,
): boolean {
  const scan = candidate.scanFacts;
  if (query.descriptor.queryKey !== scan.queryKey) return false;
  if (
    (query.active === null) !== (scan.active === null)
    || (
      query.active !== null
      && scan.active !== null
      && (
        query.active.generation !== scan.active.generation
        || query.active.dirtyThroughSequence
          !== scan.active.dirtyThroughSequence
      )
    )
  ) {
    return false;
  }
  const provisional = query.provisional;
  const scannedProvisional = scan.provisional;
  if (provisional === null || scannedProvisional === null) {
    return provisional === scannedProvisional
      && candidate._tag === "dirtyActive"
      && query.active !== null
      && query.active.dirtyThroughSequence !== null;
  }
  if (
    provisional.generation !== scannedProvisional.generation
    || provisional.evaluationDisposition._tag
      !== scannedProvisional.evaluationDisposition._tag
  ) {
    return false;
  }
  if (provisional.evaluationDisposition._tag === "blocked") {
    const scannedDisposition = scannedProvisional.evaluationDisposition;
    if (
      scannedDisposition._tag !== "blocked"
      || provisional.evaluationDisposition.reason
        !== scannedDisposition.reason
      || provisional.evaluationDisposition.resetRequired
        !== scannedDisposition.resetRequired
    ) {
      return false;
    }
  }
  return candidate._tag === "readyProvisional"
    && provisional.evaluationDisposition._tag === "ready";
}

function selectedQueryFactsValid(
  scope: QuerySyncScopeFacts,
  query: EvaluationSelectedQueryFacts,
): boolean {
  if (query.active === null && query.provisional === null) return false;
  if (
    query.active !== null
    && !activeScalarFactsValid(scope, query.active)
  ) {
    return false;
  }
  return query.provisional === null
    || provisionalQueryFactsValid(scope, query.active, query.provisional);
}

function makeAttempt(
  scope: QuerySyncScopeFacts,
  query: EvaluationSelectedQueryFacts,
  provisional: ProvisionalQueryState,
): QueryEvaluationAttempt {
  return makeQueryEvaluationAttempt({
    namespaceId: scope.cursor.namespaceId,
    syncModelId: scope.cursor.syncModelId,
    sourceEpoch: scope.cursor.sourceEpoch,
    descriptor: query.descriptor,
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: provisional.registrationCursor,
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
  });
}

function planClaimWrite(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly query: EvaluationSelectedQueryFacts;
  readonly provisional: ProvisionalQueryState;
  readonly revision: QuerySyncScopeFacts["evaluationWork"]["revision"];
  readonly change: ClaimEvaluationWorkChange;
}): Result.Result<ClaimEvaluationWorkPlan, QuerySyncStateLimitError> {
  const nextEvaluationWork = Object.freeze({
    revision: input.revision,
    fairnessAnchor: input.query.descriptor.queryKey,
  });
  let nextMetrics = applyMetricReplacement(
    input.scope.metrics,
    scopeMetricContribution(input.scope.cursor, input.scope.evaluationWork),
    scopeMetricContribution(input.scope.cursor, nextEvaluationWork),
  );
  if (input.change._tag === "claimDirtyEvaluationWork") {
    nextMetrics = applyMetricReplacement(
      nextMetrics,
      provisionalMetricContribution(input.query.provisional),
      provisionalMetricContribution(input.provisional),
    );
  }
  return Result.gen(function* () {
    yield* validateQuerySyncStateMetrics(nextMetrics);
    const nextScope = freezeScopeFacts({
      cursor: input.scope.cursor,
      evaluationWork: nextEvaluationWork,
      metrics: nextMetrics,
    });
    const attempt = makeAttempt(nextScope, input.query, input.provisional);
    const continuation = freshContinuation(nextScope);
    return Object.freeze({
      _tag: "write",
      receipt: claimedEvaluationWorkReceipt(attempt, continuation),
      expected: Object.freeze({
        scope: input.scope,
        query: input.query,
      }),
      nextScope,
      change: input.change,
    });
  });
}

export function startClaimEvaluationWork(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly request: EvaluationWorkScanRequest;
}): Result.Result<
  TransitionStep<
    ClaimEvaluationWorkPlan,
    ReadEvaluationWorkScanFactsIntent,
    ClaimEvaluationWorkScanResume
  >,
  StartClaimEvaluationWorkError
> {
  const maximumQueryInspections = input.request.maximumQueryInspections;
  if (
    typeof maximumQueryInspections !== "number"
    || !Number.isSafeInteger(maximumQueryInspections)
    || maximumQueryInspections < 1
    || maximumQueryInspections > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
  ) {
    return Result.fail(new InvalidEvaluationWorkScanRequestError({
      operation: "claimEvaluationWork",
      reason: "maximumQueryInspectionsOutOfRange",
      maximum: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      observed: maximumQueryInspections,
    }));
  }

  const continuationInput = input.request.continuation;
  if (
    continuationInput !== null
    && !isIssuedEvaluationWorkScanContinuation(continuationInput)
  ) {
    return Result.fail(invalidContinuation());
  }

  return Result.gen(function* () {
    const scope = freezeScopeFacts(input.scope);
    let continuation: EvaluationWorkScanContinuation;
    if (continuationInput === null) {
      continuation = freshContinuation(scope);
    } else {
      yield* validateQuerySyncAuthority(
        "claimEvaluationWork",
        scope.cursor,
        continuationInput,
      );
      if (
        continuationInput.observedWorkRevision
          !== scope.evaluationWork.revision
        || continuationInput.scanStartFairnessAnchor
          !== scope.evaluationWork.fairnessAnchor
      ) {
        return plannedStep(noWritePlan(continuedEvaluationWorkReceipt(
          "scanRestarted",
          freshContinuation(scope),
        )));
      }
      continuation = continuationInput;
    }

    if (
      (
        continuation.lastInspectedQueryKey === null
        && (
          continuation.wrapped
          || continuation.lowestBlockedWork !== null
        )
      )
      || (
        scope.metrics.queryCount === 0
        && continuation.lastInspectedQueryKey !== null
      )
    ) {
      return yield* Result.fail(invalidContinuation());
    }
    if (
      scope.metrics.queryCount < 0
      || scope.metrics.queryCount > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
      || (
        scope.metrics.queryCount === 0
        && scope.evaluationWork.fairnessAnchor !== null
      )
    ) {
      return yield* Result.fail(factFailure());
    }
    if (scope.metrics.queryCount === 0) {
      return plannedStep(noWritePlan(noneEvaluationWorkReceipt()));
    }
    return scanStep(Object.freeze({
      scope,
      maximumQueryInspections,
      continuation,
    }));
  });
}

export function resumeClaimEvaluationWorkScan(
  resume: ClaimEvaluationWorkScanResume,
  read: EvaluationWorkScanFactsRead,
): Result.Result<
  | Readonly<{
      readonly _tag: "planned";
      readonly plan: ClaimEvaluationWorkPlan;
    }>
  | Readonly<{
      readonly _tag: "read";
      readonly intent: ReadEvaluationSelectedQueryFactsIntent;
      readonly resume: ClaimEvaluationWorkSelectedQueryResume;
    }>,
  ResumeClaimEvaluationWorkScanError
> {
  const state = scanResumeState(resume);
  if (read._tag === "limitExceeded") {
    return Result.fail(factFailure());
  }
  const prefixLength = read.revalidationPrefix.length;
  const pageLength = read.page.length;
  if (
    prefixLength > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
    || pageLength > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
    || prefixLength + pageLength > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
  ) {
    return Result.fail(factFailure());
  }
  const prefix = Object.freeze(
    read.revalidationPrefix.map(freezeEvaluationWorkScanFacts),
  );
  const page = Object.freeze(read.page.map(freezeEvaluationWorkScanFacts));
  const combined = Object.freeze([...prefix, ...page]);
  if (
    read.fairnessAnchorPresent
      !== (state.scope.evaluationWork.fairnessAnchor !== null)
    || !combined.every((facts) => scanFactsValid(state.scope, facts))
  ) {
    return Result.fail(factFailure());
  }

  return Result.gen(function* () {
    let lowestBlocked = yield* revalidatePrefix(
      state.continuation,
      prefix,
    );
    if (
      page.length === 0
      || page.length > state.maximumQueryInspections
      || !factsAreInCanonicalCyclicOrder(
        combined,
        state.continuation.scanStartFairnessAnchor,
      )
      || (
        read.hasMore
          ? (
            page.length !== state.maximumQueryInspections
            || combined.length >= state.scope.metrics.queryCount
          )
          : combined.length !== state.scope.metrics.queryCount
      )
      || (
        !read.hasMore
        && state.continuation.scanStartFairnessAnchor !== null
        && combined[combined.length - 1]?.queryKey
          !== state.continuation.scanStartFairnessAnchor
      )
    ) {
      return yield* Result.fail(factFailure());
    }
    for (const facts of page) {
      const candidate = candidateForScanFacts(facts);
      if (candidate !== null) {
        return selectedQueryReadStep(state.scope, candidate);
      }
      lowestBlocked = lowerBlockedWork(
        lowestBlocked,
        blockedWorkForScanFacts(facts),
      );
    }

    if (!read.hasMore) {
      return plannedStep(noWritePlan(
        lowestBlocked === null
          ? noneEvaluationWorkReceipt()
          : blockedEvaluationWorkReceipt(lowestBlocked),
      ));
    }
    const last = page[page.length - 1];
    if (last === undefined) return yield* Result.fail(factFailure());
    const continuation = issueEvaluationWorkScanContinuation(
      state.scope,
      {
        scanStartFairnessAnchor:
          state.continuation.scanStartFairnessAnchor,
        lastInspectedQueryKey: last.queryKey,
        wrapped: isWrapped(
          state.continuation.scanStartFairnessAnchor,
          last.queryKey,
        ),
        lowestBlockedWork: lowestBlocked,
      },
    );
    return plannedStep(noWritePlan(
      continuedEvaluationWorkReceipt("continued", continuation),
    ));
  });
}

export function resumeClaimEvaluationWorkSelectedQuery(
  resume: ClaimEvaluationWorkSelectedQueryResume,
  factsInput: EvaluationSelectedQueryFacts | null,
): Result.Result<
  ClaimEvaluationWorkPlan,
  ResumeClaimEvaluationWorkSelectedQueryError
> {
  const state = selectedQueryResumeState(resume);
  if (factsInput === null) {
    return Result.fail(selectedQueryFactFailure());
  }
  const query = freezeEvaluationSelectedQueryFacts(factsInput);
  if (
    !selectedQueryFactsValid(state.scope, query)
    || !pointMatchesCandidate(query, state.candidate)
  ) {
    return Result.fail(selectedQueryFactFailure());
  }

  const provisional = query.provisional;
  if (state.candidate._tag === "readyProvisional") {
    if (provisional === null) {
      return Result.fail(selectedQueryFactFailure());
    }
    return planClaimWrite({
      scope: state.scope,
      query,
      provisional,
      revision: state.scope.evaluationWork.revision,
      change: Object.freeze({
        _tag: "claimReadyEvaluationWork",
        queryKey: query.descriptor.queryKey,
      }),
    });
  }

  const active = query.active;
  if (active === null || active.dirtyThroughSequence === null) {
    return Result.fail(selectedQueryFactFailure());
  }
  const generation = successorQueryGeneration(active.generation);
  if (generation === null) {
    return Result.fail(new QueryGenerationExhaustedError({
      operation: "claimEvaluationWork",
      queryKey: query.descriptor.queryKey,
      currentGeneration: active.generation,
    }));
  }
  return successorQuerySyncWorkRevision(
    "claimEvaluationWork",
    state.scope.evaluationWork.revision,
  ).pipe(Result.flatMap((revision) => {
    const nextProvisional = freezeProvisionalFacts({
      generation,
      expectedActiveGeneration: active.generation,
      registrationCursor: state.scope.cursor,
      requestedDirtyThroughSequence: active.dirtyThroughSequence,
      evaluationDisposition: Object.freeze({ _tag: "ready" }),
    });
    return planClaimWrite({
      scope: state.scope,
      query,
      provisional: nextProvisional,
      revision,
      change: Object.freeze({
        _tag: "claimDirtyEvaluationWork",
        queryKey: query.descriptor.queryKey,
        provisional: nextProvisional,
      }),
    });
  }));
}
