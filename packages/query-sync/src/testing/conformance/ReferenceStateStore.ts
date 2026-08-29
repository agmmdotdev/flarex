import { Clock, Data, Effect, Result, SynchronizedRef } from "effect";

import { capturePublicationAttemptInstant } from "../../kernel/CanonicalValue.js";
import type {
  PublicationAttemptInstant,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import type {
  ClaimEvaluationWorkError,
  EvaluationAttemptOutcome,
  EvaluationWorkScanRequest,
  RecordEvaluationAttemptOutcomeError,
} from "../../kernel/EvaluationWork.js";
import { QuerySyncInvariantDefect } from "../../kernel/Errors.js";
import type {
  AdmittedInvalidationBatch,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncState,
} from "../../kernel/Model.js";
import type {
  ApplyInvalidationsError,
  BeginQueryEvaluationError,
  CompleteQueryEvaluationError,
} from "../../kernel/Policy.js";
import {
  applyAdmittedInvalidationsTransition,
  applyBeginQueryEvaluationTransition,
  applyClaimEvaluationWorkTransition,
  applyCompleteQueryEvaluationTransition,
  applyRecordEvaluationAttemptOutcomeTransition,
} from "../../kernel/TransitionPlanAggregate.js";
import type {
  QueryPublicationArtifact,
} from "../../kernel/Publication.js";
import {
  claimPublication,
  completePublication,
  recordPublicationAttemptOutcome,
} from "../../kernel/PublicationWork.js";
import type {
  AcceptedQueryPublicationEvidence,
  ClaimPublicationError,
  CompletePublicationError,
  PublicationAttempt,
  PublicationAttemptOutcome,
  RecordPublicationAttemptOutcomeError,
} from "../../kernel/PublicationWork.js";
import {
  QuerySyncStateCommitOutcomeUnknownError,
  QuerySyncStateUnavailableError,
  QuerySyncStoredStateCorruptError,
} from "../../state/Errors.js";
import type {
  QuerySyncStateIntegrationError,
  QuerySyncStateOperation,
} from "../../state/Errors.js";
import {
  projectClaimPublicationReceipt,
  projectCompletePublicationReceipt,
  projectRecordPublicationAttemptOutcomeReceipt,
} from "../../state/Receipts.js";
import {
  applyInitializeNamespaceTransition,
} from "../../state/Initialization.js";
import type { TransitionDisposition } from "../../transition-plan/Model.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  ClaimEvaluationWorkReceipt,
  ClaimPublicationReceipt,
  CompleteQueryEvaluationReceipt,
  CompletePublicationReceipt,
  InitializeNamespaceReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
  RecordPublicationAttemptOutcomeReceipt,
} from "../../state/Receipts.js";
import type {
  QuerySyncStateConformanceTarget,
} from "./StateConformance.js";

export interface ReferenceStateBinding {
  readonly physicalNamespaceId: string;
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
}

export interface ReferenceStateFault {
  readonly operation: QuerySyncStateOperation;
  readonly timing: "beforeSwap" | "afterSwap";
}

export class ReferenceStateSnapshotBindingError extends Data.TaggedError(
  "ReferenceStateSnapshotBindingError",
)<{
  readonly operation: "snapshotForConformance";
  readonly reason: "boundAuthorityMismatch";
}> {}

interface ArmedReferenceStateFault extends ReferenceStateFault {
  readonly physicalNamespaceId: string;
}

interface ReferenceStateCell {
  readonly aggregates: ReadonlyMap<string, QuerySyncState>;
  readonly knownPhysicalNamespaces: ReadonlySet<string>;
  readonly fault: ArmedReferenceStateFault | null;
}

export interface ReferenceQuerySyncTransitionState
  extends QuerySyncStateConformanceTarget<
    ReferenceStateSnapshotBindingError
  > {
  readonly injectNextFault: (
    fault: ReferenceStateFault,
  ) => Effect.Effect<void, never, never>;
  readonly simulateAggregateLossForConformance: () => Effect.Effect<
    void,
    never,
    never
  >;
}

export interface ReferenceQuerySyncStateHarness {
  readonly bind: (
    binding: ReferenceStateBinding,
  ) => ReferenceQuerySyncTransitionState;
}

interface AtomicTransition<A> {
  readonly receipt: A;
  readonly nextState: QuerySyncState;
  readonly disposition: TransitionDisposition;
}

type AtomicReducer<A, E> = (
  state: QuerySyncState | null,
  wasPreviouslyInitialized: boolean,
) => Result.Result<AtomicTransition<A>, E>;

type AtomicEffectReducer<A, E> = (
  state: QuerySyncState | null,
  wasPreviouslyInitialized: boolean,
) => Effect.Effect<Result.Result<AtomicTransition<A>, E>, never, never>;

function freezeCell(
  aggregates: ReadonlyMap<string, QuerySyncState>,
  knownPhysicalNamespaces: ReadonlySet<string>,
  fault: ArmedReferenceStateFault | null,
): ReferenceStateCell {
  return Object.freeze({ aggregates, knownPhysicalNamespaces, fault });
}

function replaceAggregate(
  cell: ReferenceStateCell,
  physicalNamespaceId: string,
  state: QuerySyncState,
  fault: ArmedReferenceStateFault | null,
): ReferenceStateCell {
  const aggregates = new Map(cell.aggregates);
  aggregates.set(physicalNamespaceId, state);
  const knownPhysicalNamespaces = new Set(cell.knownPhysicalNamespaces);
  knownPhysicalNamespaces.add(physicalNamespaceId);
  return freezeCell(aggregates, knownPhysicalNamespaces, fault);
}

function faultMatches(
  fault: ArmedReferenceStateFault | null,
  binding: ReferenceStateBinding,
  operation: QuerySyncStateOperation,
  timing: ReferenceStateFault["timing"],
): boolean {
  return fault?.physicalNamespaceId === binding.physicalNamespaceId
    && fault.operation === operation
    && fault.timing === timing;
}

function applyAtomicTransition<
  A,
  E,
  Operation extends QuerySyncStateOperation,
>(
  cell: ReferenceStateCell,
  binding: ReferenceStateBinding,
  operation: Operation,
  result: Result.Result<AtomicTransition<A>, E>,
): readonly [
  Result.Result<A, E | QuerySyncStateIntegrationError<Operation>>,
  ReferenceStateCell,
] {
  return Result.match(result, {
    onFailure: (failure) => [Result.fail(failure), cell],
    onSuccess: (transition) => {
      if (
        transition.disposition === "write"
        && faultMatches(cell.fault, binding, operation, "beforeSwap")
      ) {
        return [
          Result.fail(new QuerySyncStateUnavailableError<Operation>({
            operation,
            commitCertainty: "notCommitted",
            reason: "temporarilyUnavailable",
            cause: null,
          })),
          freezeCell(cell.aggregates, cell.knownPhysicalNamespaces, null),
        ];
      }

      const nextCell = transition.disposition === "write"
        ? replaceAggregate(
          cell,
          binding.physicalNamespaceId,
          transition.nextState,
          cell.fault,
        )
        : cell;
      if (
        transition.disposition === "write"
        && faultMatches(cell.fault, binding, operation, "afterSwap")
      ) {
        return [
          Result.fail(
            new QuerySyncStateCommitOutcomeUnknownError<Operation>({
              operation,
              commitCertainty: "unknown",
              reason: "responseLostAfterCommit",
              cause: null,
            }),
          ),
          freezeCell(
            nextCell.aggregates,
            nextCell.knownPhysicalNamespaces,
            null,
          ),
        ];
      }
      return [Result.succeed(transition.receipt), nextCell];
    },
  });
}

function executeAtomic<
  A,
  E,
  Operation extends QuerySyncStateOperation,
>(
  cellRef: SynchronizedRef.SynchronizedRef<ReferenceStateCell>,
  binding: ReferenceStateBinding,
  operation: Operation,
  reduce: AtomicReducer<A, E>,
): Effect.Effect<A, E | QuerySyncStateIntegrationError<Operation>, never> {
  return SynchronizedRef.modify(cellRef, (cell): readonly [
    Result.Result<A, E | QuerySyncStateIntegrationError<Operation>>,
    ReferenceStateCell,
  ] => {
    const current = cell.aggregates.get(binding.physicalNamespaceId) ?? null;
    return applyAtomicTransition(
      cell,
      binding,
      operation,
      reduce(
        current,
        cell.knownPhysicalNamespaces.has(binding.physicalNamespaceId),
      ),
    );
  }).pipe(Effect.flatMap(Effect.fromResult));
}

function executeAtomicEffect<
  A,
  E,
  Operation extends QuerySyncStateOperation,
>(
  cellRef: SynchronizedRef.SynchronizedRef<ReferenceStateCell>,
  binding: ReferenceStateBinding,
  operation: Operation,
  reduce: AtomicEffectReducer<A, E>,
): Effect.Effect<A, E | QuerySyncStateIntegrationError<Operation>, never> {
  return SynchronizedRef.modifyEffect(cellRef, (cell) => {
    const current = cell.aggregates.get(binding.physicalNamespaceId) ?? null;
    return reduce(
      current,
      cell.knownPhysicalNamespaces.has(binding.physicalNamespaceId),
    ).pipe(Effect.map((result) => applyAtomicTransition(
      cell,
      binding,
      operation,
      result,
    )));
  }).pipe(Effect.flatMap(Effect.fromResult));
}

const captureStateClockInstant = Effect.fn(
  "QuerySync.ReferenceState.captureClockInstant",
)(function*(
  operation: "claimPublication" | "recordPublicationAttemptOutcome",
): Effect.fn.Return<PublicationAttemptInstant> {
  const observedNow = yield* Clock.currentTimeMillis;
  return yield* Result.match(capturePublicationAttemptInstant(observedNow), {
    onFailure: () => Effect.die(new QuerySyncInvariantDefect({
      operation,
      invariant: "stateClockInstantInvalid",
    })),
    onSuccess: Effect.succeed,
  });
});

function missingState<Operation extends Exclude<
  QuerySyncStateOperation,
  "initializeOrInspectNamespace"
>>(
  operation: Operation,
): QuerySyncStoredStateCorruptError<Operation> {
  return new QuerySyncStoredStateCorruptError<Operation>({
    operation,
    commitCertainty: "notCommitted",
    reason: "aggregateMissing",
    cause: null,
  });
}

function validateStoredBinding<Operation extends Exclude<
  QuerySyncStateOperation,
  "initializeOrInspectNamespace"
>>(
  operation: Operation,
  binding: ReferenceStateBinding,
  state: QuerySyncState,
): Result.Result<QuerySyncState, QuerySyncStoredStateCorruptError<Operation>> {
  if (
    state.cursor.namespaceId !== binding.namespaceId
    || state.cursor.syncModelId !== binding.syncModelId
    || state.cursor.sourceEpoch !== binding.sourceEpoch
  ) {
    return Result.fail(new QuerySyncStoredStateCorruptError<Operation>({
      operation,
      commitCertainty: "notCommitted",
      reason: "namespaceBindingMismatch",
      cause: null,
    }));
  }
  return Result.succeed(state);
}

function initializeReducer(
  binding: ReferenceStateBinding,
  bootstrapCursor: NamespaceCursor,
): AtomicReducer<
  InitializeNamespaceReceipt,
  | BuildQuerySyncStateError
  | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">
> {
  return (current, wasPreviouslyInitialized) =>
    applyInitializeNamespaceTransition({
      current,
      wasPreviouslyInitialized,
      binding,
      bootstrapCursor,
    });
}

function legacyAggregateDisposition(
  previous: QuerySyncState,
  next: QuerySyncState,
): TransitionDisposition {
  return previous === next ? "noWrite" : "write";
}


function makeReferencePort(
  cellRef: SynchronizedRef.SynchronizedRef<ReferenceStateCell>,
  binding: ReferenceStateBinding,
): ReferenceQuerySyncTransitionState {
  const initializeOrInspectNamespace = Effect.fn(
    "QuerySync.ReferenceState.initializeOrInspectNamespace",
  )(function*(bootstrapCursor): Effect.fn.Return<
    InitializeNamespaceReceipt,
    | BuildQuerySyncStateError
    | QuerySyncStateIntegrationError<"initializeOrInspectNamespace">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "initializeOrInspectNamespace",
      initializeReducer(binding, bootstrapCursor),
    );
  });

  const begin = Effect.fn(
    "QuerySync.ReferenceState.beginQueryEvaluation",
  )(function*(request: BeginQueryEvaluationRequest): Effect.fn.Return<
    BeginQueryEvaluationReceipt,
    | BeginQueryEvaluationError
    | QuerySyncStateIntegrationError<"beginQueryEvaluation">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "beginQueryEvaluation",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState("beginQueryEvaluation"));
        }
        const state = yield* validateStoredBinding(
          "beginQueryEvaluation",
          binding,
          current,
        );
        const transition = yield* applyBeginQueryEvaluationTransition(
          state,
          request,
        );
        return Object.freeze({
          receipt: transition.plan.receipt,
          nextState: transition.decision.state,
          disposition: transition.disposition,
        });
      }),
    );
  });

  const apply = Effect.fn(
    "QuerySync.ReferenceState.applyAdmittedBatchAndAdvance",
  )(function*(batch: AdmittedInvalidationBatch): Effect.fn.Return<
    ApplyAdmittedBatchReceipt,
    | ApplyInvalidationsError
    | QuerySyncStateIntegrationError<"applyAdmittedBatchAndAdvance">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "applyAdmittedBatchAndAdvance",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState(
            "applyAdmittedBatchAndAdvance",
          ));
        }
        const state = yield* validateStoredBinding(
          "applyAdmittedBatchAndAdvance",
          binding,
          current,
        );
        const transition = yield* applyAdmittedInvalidationsTransition(
          state,
          batch,
        );
        return Object.freeze({
          receipt: transition.plan.receipt,
          nextState: transition.decision.state,
          disposition: transition.disposition,
        });
      }),
    );
  });

  const complete = Effect.fn(
    "QuerySync.ReferenceState.completeQueryEvaluation",
  )(function*(
    attempt: QueryEvaluationAttempt,
    evaluation: QueryEvaluationEvidence,
    refresh: GenerationRefreshEvidence,
    publication: QueryPublicationArtifact,
  ): Effect.fn.Return<
    CompleteQueryEvaluationReceipt,
    | CompleteQueryEvaluationError
    | QuerySyncStateIntegrationError<"completeQueryEvaluation">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "completeQueryEvaluation",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState(
            "completeQueryEvaluation",
          ));
        }
        const state = yield* validateStoredBinding(
          "completeQueryEvaluation",
          binding,
          current,
        );
        const transition = yield* applyCompleteQueryEvaluationTransition(
          state,
          attempt,
          evaluation,
          refresh,
          publication,
        );
        return Object.freeze({
          receipt: transition.plan.receipt,
          nextState: transition.decision.state,
          disposition: transition.disposition,
        });
      }),
    );
  });

  const claimEvaluation = Effect.fn(
    "QuerySync.ReferenceState.claimEvaluationWork",
  )(function*(request: EvaluationWorkScanRequest): Effect.fn.Return<
    ClaimEvaluationWorkReceipt,
    | ClaimEvaluationWorkError
    | QuerySyncStateIntegrationError<"claimEvaluationWork">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "claimEvaluationWork",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState("claimEvaluationWork"));
        }
        const state = yield* validateStoredBinding(
          "claimEvaluationWork",
          binding,
          current,
        );
        const transition = yield* applyClaimEvaluationWorkTransition(
          state,
          request,
        );
        return Object.freeze({
          receipt: transition.plan.receipt,
          nextState: transition.decision.state,
          disposition: transition.disposition,
        });
      }),
    );
  });

  const recordEvaluationOutcome = Effect.fn(
    "QuerySync.ReferenceState.recordEvaluationAttemptOutcome",
  )(function*(
    attempt: QueryEvaluationAttempt,
    outcome: EvaluationAttemptOutcome,
  ): Effect.fn.Return<
    RecordEvaluationAttemptOutcomeReceipt,
    | RecordEvaluationAttemptOutcomeError
    | QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "recordEvaluationAttemptOutcome",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState(
            "recordEvaluationAttemptOutcome",
          ));
        }
        const state = yield* validateStoredBinding(
          "recordEvaluationAttemptOutcome",
          binding,
          current,
        );
        const transition = yield* applyRecordEvaluationAttemptOutcomeTransition(
          state,
          attempt,
          outcome,
        );
        return Object.freeze({
          receipt: transition.plan.receipt,
          nextState: transition.decision.state,
          disposition: transition.disposition,
        });
      }),
    );
  });

  const claimNextPublication = Effect.fn(
    "QuerySync.ReferenceState.claimPublication",
  )(function*(): Effect.fn.Return<
    ClaimPublicationReceipt,
    | ClaimPublicationError
    | QuerySyncStateIntegrationError<"claimPublication">,
    never
  > {
    return yield* executeAtomicEffect(
      cellRef,
      binding,
      "claimPublication",
      (current) => Effect.gen(function* () {
        const capturedNow = yield* captureStateClockInstant(
          "claimPublication",
        );
        return Result.gen(function* () {
          if (current === null) {
            return yield* Result.fail(missingState("claimPublication"));
          }
          const state = yield* validateStoredBinding(
            "claimPublication",
            binding,
            current,
          );
          const decision = yield* claimPublication(state, capturedNow);
          return Object.freeze({
            receipt: projectClaimPublicationReceipt(decision),
            nextState: decision.state,
            disposition: legacyAggregateDisposition(state, decision.state),
          });
        });
      }),
    );
  });

  const recordPublicationOutcome = Effect.fn(
    "QuerySync.ReferenceState.recordPublicationAttemptOutcome",
  )(function*(
    attempt: PublicationAttempt,
    outcome: PublicationAttemptOutcome,
  ): Effect.fn.Return<
    RecordPublicationAttemptOutcomeReceipt,
    | RecordPublicationAttemptOutcomeError
    | QuerySyncStateIntegrationError<"recordPublicationAttemptOutcome">,
    never
  > {
    return yield* executeAtomicEffect(
      cellRef,
      binding,
      "recordPublicationAttemptOutcome",
      (current) => Effect.gen(function* () {
        const capturedNow = yield* captureStateClockInstant(
          "recordPublicationAttemptOutcome",
        );
        return Result.gen(function* () {
          if (current === null) {
            return yield* Result.fail(missingState(
              "recordPublicationAttemptOutcome",
            ));
          }
          const state = yield* validateStoredBinding(
            "recordPublicationAttemptOutcome",
            binding,
            current,
          );
          const decision = yield* recordPublicationAttemptOutcome(
            state,
            attempt,
            outcome,
            capturedNow,
          );
          return Object.freeze({
            receipt: projectRecordPublicationAttemptOutcomeReceipt(decision),
            nextState: decision.state,
            disposition: legacyAggregateDisposition(state, decision.state),
          });
        });
      }),
    );
  });

  const completeNextPublication = Effect.fn(
    "QuerySync.ReferenceState.completePublication",
  )(function*(
    evidence: AcceptedQueryPublicationEvidence,
  ): Effect.fn.Return<
    CompletePublicationReceipt,
    | CompletePublicationError
    | QuerySyncStateIntegrationError<"completePublication">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "completePublication",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState("completePublication"));
        }
        const state = yield* validateStoredBinding(
          "completePublication",
          binding,
          current,
        );
        const decision = yield* completePublication(state, evidence);
        return Object.freeze({
          receipt: projectCompletePublicationReceipt(decision),
          nextState: decision.state,
          disposition: legacyAggregateDisposition(state, decision.state),
        });
      }),
    );
  });

  const snapshotForConformance = Effect.fn(
    "QuerySync.ReferenceState.snapshotForConformance",
  )(function*(): Effect.fn.Return<
    QuerySyncState | null,
    ReferenceStateSnapshotBindingError,
    never
  > {
    const cell = yield* SynchronizedRef.get(cellRef);
    const current = cell.aggregates.get(binding.physicalNamespaceId) ?? null;
    if (current === null) return null;
    if (
      current.cursor.namespaceId !== binding.namespaceId
      || current.cursor.syncModelId !== binding.syncModelId
      || current.cursor.sourceEpoch !== binding.sourceEpoch
    ) {
      return yield* new ReferenceStateSnapshotBindingError({
        operation: "snapshotForConformance",
        reason: "boundAuthorityMismatch",
      });
    }
    return current;
  });

  const injectNextFault = Effect.fn(
    "QuerySync.ReferenceState.injectNextFault",
  )(function*(fault: ReferenceStateFault): Effect.fn.Return<void> {
    const operation = fault.operation;
    const timing = fault.timing;
    const armedFault = Object.freeze({
      operation,
      timing,
      physicalNamespaceId: binding.physicalNamespaceId,
    });
    yield* SynchronizedRef.update(cellRef, (cell) => freezeCell(
      cell.aggregates,
      cell.knownPhysicalNamespaces,
      armedFault,
    ));
  });

  const simulateAggregateLossForConformance = Effect.fn(
    "QuerySync.ReferenceState.simulateAggregateLossForConformance",
  )(function*(): Effect.fn.Return<void> {
    yield* SynchronizedRef.update(cellRef, (cell) => {
      const aggregates = new Map(cell.aggregates);
      aggregates.delete(binding.physicalNamespaceId);
      return freezeCell(
        aggregates,
        cell.knownPhysicalNamespaces,
        cell.fault,
      );
    });
  });

  return Object.freeze({
    bindingForConformance: Object.freeze({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
    }),
    initializeOrInspectNamespace,
    beginQueryEvaluation: begin,
    applyAdmittedBatchAndAdvance: apply,
    completeQueryEvaluation: complete,
    claimEvaluationWork: claimEvaluation,
    recordEvaluationAttemptOutcome: recordEvaluationOutcome,
    claimPublication: claimNextPublication,
    recordPublicationAttemptOutcome: recordPublicationOutcome,
    completePublication: completeNextPublication,
    snapshotForConformance,
    injectNextFault,
    simulateAggregateLossForConformance,
  });
}

export const makeReferenceQuerySyncStateHarness = Effect.fn(
  "QuerySync.ReferenceState.makeHarness",
)(function*(): Effect.fn.Return<ReferenceQuerySyncStateHarness> {
  const cellRef = yield* SynchronizedRef.make<ReferenceStateCell>(freezeCell(
    new Map(),
    new Set(),
    null,
  ));
  return Object.freeze({
    bind: (binding: ReferenceStateBinding) => {
      const captured = Object.freeze({
        physicalNamespaceId: binding.physicalNamespaceId,
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
      });
      return makeReferencePort(cellRef, captured);
    },
  });
});
