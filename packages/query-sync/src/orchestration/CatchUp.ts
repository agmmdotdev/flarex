import { Clock, Effect } from "effect";

import {
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "../change/Model.js";
import type {
  AdmittedChangePage,
  AdmittedChangeRead,
  AdmittedChangeSource,
  ChangeReadBudget,
  ChangeSourceReadRequest,
} from "../change/Model.js";
import type { AdmittedChangeSourceError } from "../change/Errors.js";
import {
  successorSyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  AdmittedInvalidationBatch,
  BuildQuerySyncStateError,
  NamespaceCursor,
} from "../kernel/Model.js";
import type { ApplyInvalidationsError } from "../kernel/Policy.js";
import type {
  QuerySyncStateIntegrationError,
} from "../state/Errors.js";
import type {
  ApplyAdmittedBatchReceipt,
  InitializeNamespaceReceipt,
} from "../state/Receipts.js";
import type { CatchUpTurnError } from "./Errors.js";
import type { QuerySyncCatchUpState } from "./Ports.js";
import {
  captureNamespaceCursorValue,
  freezeTurnProgress,
} from "./Model.js";
import type {
  CatchUpBoundaryOutcome,
  CatchUpContinuationReason,
  CatchUpPhase,
  CatchUpTurnBudget,
  NamespaceQuerySyncPolicy,
  OrchestrationTurnLedger,
} from "./Model.js";
import {
  awaitRetryDelay,
  canStartBefore,
  makeTurnWindow,
  retryDelayForAttempt,
  runStateOperationWithRetry,
} from "./Turn.js";

export interface OrchestrationTurnRuntime<
  Budget extends CatchUpTurnBudget = CatchUpTurnBudget,
  State extends QuerySyncCatchUpState = QuerySyncCatchUpState,
> {
  readonly bootstrapCursor: NamespaceCursor;
  readonly source: AdmittedChangeSource;
  readonly state: State;
  readonly policy: NamespaceQuerySyncPolicy;
  readonly budget: Budget;
  readonly ledger: OrchestrationTurnLedger;
  readonly admissionCutoffNanos: bigint;
  readonly settlementCutoffNanos: bigint;
}

export type CatchUpInternalResult<
  Phase extends CatchUpPhase = CatchUpPhase,
> =
  | Readonly<{
    readonly _tag: "caughtUp";
    readonly cursor: NamespaceCursor;
    readonly authority: NonNullable<AdmittedChangePage["caughtUpAuthority"]>;
  }>
  | CatchUpBoundaryOutcome<Phase>;

export const makeTurnRuntime = Effect.fn(
  "QuerySync.Orchestration.makeTurnRuntime",
)(function*<
  Budget extends CatchUpTurnBudget,
  State extends QuerySyncCatchUpState,
>(input: {
  readonly bootstrapCursor: NamespaceCursor;
  readonly source: AdmittedChangeSource;
  readonly state: State;
  readonly policy: NamespaceQuerySyncPolicy;
  readonly budget: Budget;
  readonly ledger: OrchestrationTurnLedger;
}): Effect.fn.Return<OrchestrationTurnRuntime<Budget, State>> {
  const startNanos = yield* Clock.currentTimeNanos;
  const window = makeTurnWindow(
    startNanos,
    input.budget.newWorkWindowMilliseconds,
    input.policy.settlementReserveMilliseconds,
  );
  return {
    ...input,
    ...window,
  };
});

export function setLastDurableCursor(
  runtime: OrchestrationTurnRuntime,
  cursor: NamespaceCursor,
): void {
  runtime.ledger.lastDurableCursor = captureNamespaceCursorValue(cursor);
}

function remainingReadBudget(
  runtime: OrchestrationTurnRuntime,
): ChangeReadBudget {
  return Object.freeze({
    committedBatches: Math.min(
      runtime.budget.admittedBatches - runtime.ledger.admittedBatches,
      MAX_SOURCE_PAGE_BATCHES,
    ),
    sourceTransportBytes: Math.min(
      runtime.budget.sourceTransportBytes
        - runtime.ledger.sourceTransportBytes,
      MAX_SOURCE_TRANSPORT_BYTES,
    ),
    modelSemanticWorkUnits: Math.min(
      runtime.budget.modelSemanticWorkUnits
        - runtime.ledger.modelSemanticWorkUnits,
      MAX_MODEL_SEMANTIC_WORK_UNITS,
    ),
    modelSemanticBytes: Math.min(
      runtime.budget.modelSemanticBytes
        - runtime.ledger.modelSemanticBytes,
      MAX_MODEL_SEMANTIC_BYTES,
    ),
    dependencyKeyExaminations: Math.min(
      runtime.budget.dependencyKeyExaminations
        - runtime.ledger.dependencyKeyExaminations,
      MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
    ),
    canonicalDependencyBytes: Math.min(
      runtime.budget.canonicalDependencyBytes
        - runtime.ledger.canonicalDependencyBytes,
      MAX_PROJECTED_CANONICAL_BYTES,
    ),
  });
}

export function sourceLimitReason(
  runtime: OrchestrationTurnRuntime,
): CatchUpContinuationReason | null {
  if (runtime.ledger.sourceCalls >= runtime.budget.sourceReads) {
    return "sourceReadLimitReached";
  }
  if (runtime.ledger.admittedBatches >= runtime.budget.admittedBatches) {
    return "admittedBatchLimitReached";
  }
  if (
    runtime.ledger.sourceTransportBytes
      >= runtime.budget.sourceTransportBytes
  ) {
    return "sourceTransportByteLimitReached";
  }
  if (
    runtime.ledger.modelSemanticWorkUnits
      >= runtime.budget.modelSemanticWorkUnits
  ) {
    return "modelSemanticWorkLimitReached";
  }
  if (
    runtime.ledger.modelSemanticBytes >= runtime.budget.modelSemanticBytes
  ) {
    return "modelSemanticByteLimitReached";
  }
  if (
    runtime.ledger.dependencyKeyExaminations
      >= runtime.budget.dependencyKeyExaminations
  ) {
    return "dependencyKeyExaminationLimitReached";
  }
  if (
    runtime.ledger.canonicalDependencyBytes
      >= runtime.budget.canonicalDependencyBytes
  ) {
    return "canonicalDependencyByteLimitReached";
  }
  return null;
}

export const nextSourceStopReason = Effect.fn(
  "QuerySync.Orchestration.nextSourceStopReason",
)(function*(
  runtime: OrchestrationTurnRuntime,
): Effect.fn.Return<CatchUpContinuationReason | null> {
  if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
    return "deadlineReached";
  }
  return sourceLimitReason(runtime);
});

function captureReadRequest(
  cursor: NamespaceCursor,
): ChangeSourceReadRequest {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    requestedAfterSequenceExclusive: cursor.appliedThroughSequence,
  });
}

export function readAdmittedPage(
  runtime: OrchestrationTurnRuntime,
  request: ChangeSourceReadRequest,
): Effect.Effect<
  AdmittedChangeRead,
  AdmittedChangeSourceError,
  never
> {
  const budget = remainingReadBudget(runtime);
  const invoke = () => {
    runtime.ledger.sourceCalls += 1;
    return runtime.source.readAfter(request, budget);
  };
  const runAttempt = (
    attemptNumber: number,
  ): Effect.Effect<
    AdmittedChangeRead,
    AdmittedChangeSourceError,
    never
  > => invoke().pipe(
    Effect.catchTag("ChangeSourceUnavailableError", (error) => {
      if (
        attemptNumber >= runtime.policy.sourceAttemptsPerRead
        || runtime.ledger.sourceCalls >= runtime.budget.sourceReads
      ) {
        return Effect.fail(error);
      }
      const delay = retryDelayForAttempt(runtime.policy, attemptNumber);
      return awaitRetryDelay(delay, runtime.admissionCutoffNanos).pipe(
        Effect.flatMap((allowed) => (
          allowed ? runAttempt(attemptNumber + 1) : Effect.fail(error)
        )),
      );
    }),
  );
  return runAttempt(1);
}

export function chargeAdmittedPage(
  ledger: OrchestrationTurnLedger,
  page: AdmittedChangePage,
): void {
  ledger.admittedBatches += page.batches.length;
  ledger.sourceTransportBytes += page.sourceTransportBytes;
  ledger.modelSemanticWorkUnits +=
    page.projectionMetrics.modelSemanticWorkUnits;
  ledger.modelSemanticBytes += page.projectionMetrics.modelSemanticBytes;
  ledger.dependencyKeyExaminations +=
    page.projectionMetrics.dependencyKeyExaminations;
  ledger.canonicalDependencyBytes +=
    page.projectionMetrics.canonicalDependencyBytes;
}

function continuation<Phase extends CatchUpPhase>(
  runtime: OrchestrationTurnRuntime,
  phase: Phase,
  reason: CatchUpContinuationReason,
): CatchUpBoundaryOutcome<Phase> {
  return Object.freeze({
    _tag: "continuationRequired",
    phase,
    reason,
    progress: freezeTurnProgress(runtime.ledger),
  });
}

function initializeBoundary<Phase extends CatchUpPhase>(
  runtime: OrchestrationTurnRuntime,
  phase: Phase,
  receipt: Extract<
    InitializeNamespaceReceipt,
    { readonly _tag: "modelReplaced" | "epochReplaced" }
  >,
): CatchUpBoundaryOutcome<Phase> {
  if (receipt._tag === "modelReplaced") {
    return Object.freeze({
      _tag: "modelReplaced",
      phase: "initialCatchUp",
      existingCursor: captureNamespaceCursorValue(receipt.existingCursor),
      requestedSyncModelId: receipt.requestedSyncModelId,
      progress: freezeTurnProgress(runtime.ledger),
    });
  }
  return Object.freeze({
    _tag: "epochReplaced",
    phase,
    evidence: Object.freeze({
      source: "state",
      existingCursor: captureNamespaceCursorValue(receipt.existingCursor),
      requestedSourceEpoch: receipt.requestedSourceEpoch,
    }),
    progress: freezeTurnProgress(runtime.ledger),
  });
}

export const inspectNamespace = Effect.fn(
  "QuerySync.Orchestration.inspectNamespace",
)(function*<Phase extends CatchUpPhase>(
  runtime: OrchestrationTurnRuntime,
  phase: Phase,
): Effect.fn.Return<
  NamespaceCursor | CatchUpBoundaryOutcome<Phase>,
  BuildQuerySyncStateError
    | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">,
  never
> {
  const receipt = yield* runStateOperationWithRetry({
    operation: "initializeOrInspectNamespace",
    invoke: () => runtime.state.initializeOrInspectNamespace(
      runtime.bootstrapCursor,
    ),
    policy: runtime.policy,
    cutoffNanos: runtime.admissionCutoffNanos,
    replayUnknown: true,
  });
  if (receipt._tag === "modelReplaced" || receipt._tag === "epochReplaced") {
    if (receipt._tag === "modelReplaced" && phase !== "initialCatchUp") {
      return yield* Effect.die(
        "Model replacement appeared after initial catch-up",
      );
    }
    return initializeBoundary(runtime, phase, receipt);
  }
  setLastDurableCursor(runtime, receipt.cursor);
  return runtime.ledger.lastDurableCursor;
});

export const applyAdmittedBatch = Effect.fn(
  "QuerySync.Orchestration.applyAdmittedBatch",
)(function*(
  runtime: OrchestrationTurnRuntime,
  batch: AdmittedInvalidationBatch,
): Effect.fn.Return<
  ApplyAdmittedBatchReceipt,
  ApplyInvalidationsError
    | QuerySyncStateIntegrationError<"applyAdmittedBatchAndAdvance">,
  never
> {
  const receipt = yield* runStateOperationWithRetry({
    operation: "applyAdmittedBatchAndAdvance",
    invoke: () => runtime.state.applyAdmittedBatchAndAdvance(batch),
    policy: runtime.policy,
    cutoffNanos: runtime.admissionCutoffNanos,
    replayUnknown: true,
  });
  runtime.ledger.settledBatchTransitions += 1;
  return receipt;
});

function applyBoundary<Phase extends CatchUpPhase>(
  runtime: OrchestrationTurnRuntime,
  phase: Phase,
  receipt: Extract<
    ApplyAdmittedBatchReceipt,
    { readonly _tag: "gap" | "resetRequired" }
  >,
): CatchUpBoundaryOutcome<Phase> {
  return receipt._tag === "gap"
    ? Object.freeze({
      _tag: "gap",
      phase,
      expectedSequence: receipt.expectedSequence,
      observedSequence: receipt.observedSequence,
      progress: freezeTurnProgress(runtime.ledger),
    })
    : Object.freeze({
      _tag: "resetRequired",
      phase,
      expectedSourceEpoch: receipt.expectedSourceEpoch,
      observedSourceEpoch: receipt.observedSourceEpoch,
      progress: freezeTurnProgress(runtime.ledger),
    });
}

export const catchUpNamespace = Effect.fn(
  "QuerySync.Orchestration.catchUpNamespace",
)(function*<Phase extends CatchUpPhase>(
  runtime: OrchestrationTurnRuntime,
  phase: Phase,
): Effect.fn.Return<CatchUpInternalResult<Phase>, CatchUpTurnError, never> {
  if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
    return continuation(runtime, phase, "deadlineReached");
  }
  const initial = yield* inspectNamespace(runtime, phase);
  if (!("appliedThroughSequence" in initial)) return initial;
  let durableCursor = initial;

  while (true) {
    const stopReason = yield* nextSourceStopReason(runtime);
    if (stopReason !== null) return continuation(runtime, phase, stopReason);

    const read = yield* readAdmittedPage(
      runtime,
      captureReadRequest(durableCursor),
    );
    if (read._tag === "historyUnavailable") {
      return Object.freeze({
        _tag: "historyUnavailable",
        phase,
        evidence: read,
        progress: freezeTurnProgress(runtime.ledger),
      });
    }
    if (read._tag === "epochReplaced") {
      return Object.freeze({
        _tag: "epochReplaced",
        phase,
        evidence: Object.freeze({ source: "changeSource", value: read }),
        progress: freezeTurnProgress(runtime.ledger),
      });
    }
    if (read._tag === "budgetInsufficient") {
      return Object.freeze({
        _tag: "budgetInsufficient",
        phase,
        evidence: read,
        progress: freezeTurnProgress(runtime.ledger),
      });
    }

    chargeAdmittedPage(runtime.ledger, read);
    for (const batch of read.batches) {
      if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
        return continuation(runtime, phase, "deadlineReached");
      }
      const applied = yield* applyAdmittedBatch(runtime, batch);
      if (applied._tag === "gap" || applied._tag === "resetRequired") {
        return applyBoundary(runtime, phase, applied);
      }
    }

    if (!(yield* canStartBefore(runtime.admissionCutoffNanos))) {
      return continuation(runtime, phase, "deadlineReached");
    }
    const inspected = yield* inspectNamespace(runtime, phase);
    if (!("appliedThroughSequence" in inspected)) return inspected;
    durableCursor = inspected;

    if (read.hasMore) continue;
    const authority = read.caughtUpAuthority;
    if (authority.readThroughSequence === durableCursor.appliedThroughSequence) {
      return Object.freeze({
        _tag: "caughtUp",
        cursor: captureNamespaceCursorValue(durableCursor),
        authority,
      });
    }
    if (authority.readThroughSequence < durableCursor.appliedThroughSequence) {
      continue;
    }
    const expectedSequence = successorSyncSequence(
      durableCursor.appliedThroughSequence,
    );
    if (expectedSequence === null) {
      return yield* Effect.die(
        "Durable query-sync cursor cannot advance beyond its maximum",
      );
    }
    return Object.freeze({
      _tag: "gap",
      phase,
      expectedSequence,
      observedSequence: authority.readThroughSequence,
      progress: freezeTurnProgress(runtime.ledger),
    });
  }
});
