import { Data, Effect, Result, SynchronizedRef } from "effect";

import type {
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "../../kernel/CanonicalValue.js";
import {
  createEmptyQuerySyncState,
} from "../../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  BuildQuerySyncStateError,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
  QuerySyncState,
} from "../../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryGeneration,
  completeQueryGeneration,
} from "../../kernel/Policy.js";
import type {
  ApplyInvalidationsError,
  BeginQueryGenerationError,
  CompleteQueryGenerationError,
} from "../../kernel/Policy.js";
import {
  QuerySyncStateCommitOutcomeUnknownError,
  QuerySyncStateUnavailableError,
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "../../state/Errors.js";
import type {
  QuerySyncStateIntegrationError,
  QuerySyncStateOperation,
} from "../../state/Errors.js";
import {
  epochReplacedReceipt,
  initializedNamespaceReceipt,
  modelReplacedReceipt,
  projectApplyReceipt,
  projectBeginReceipt,
  projectCompleteReceipt,
} from "../../state/Receipts.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryGenerationReceipt,
  CompleteQueryGenerationReceipt,
  InitializeNamespaceReceipt,
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
  readonly changed: boolean;
}

type AtomicReducer<A, E> = (
  state: QuerySyncState | null,
  wasPreviouslyInitialized: boolean,
) => Result.Result<AtomicTransition<A>, E>;

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
    return Result.match(reduce(
      current,
      cell.knownPhysicalNamespaces.has(binding.physicalNamespaceId),
    ), {
      onFailure: (failure) => [Result.fail(failure), cell],
      onSuccess: (transition) => {
        if (
          transition.changed
          && faultMatches(cell.fault, binding, operation, "beforeSwap")
        ) {
          return [
            Result.fail(new QuerySyncStateUnavailableError<Operation>({
              operation,
              commitCertainty: "notCommitted",
              reason: "temporarilyUnavailable",
              cause: null,
            })),
            freezeCell(
              cell.aggregates,
              cell.knownPhysicalNamespaces,
              null,
            ),
          ];
        }

        const nextCell = transition.changed
          ? replaceAggregate(
            cell,
            binding.physicalNamespaceId,
            transition.nextState,
            cell.fault,
          )
          : cell;
        if (
          transition.changed
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
  }).pipe(Effect.flatMap(Effect.fromResult));
}

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
  return (current, wasPreviouslyInitialized) => Result.gen(function* () {
    if (
      bootstrapCursor.namespaceId !== binding.namespaceId
      || bootstrapCursor.syncModelId !== binding.syncModelId
      || bootstrapCursor.sourceEpoch !== binding.sourceEpoch
    ) {
      return yield* Result.fail(
        new QuerySyncStoredStateIncompatibleError<
          "initializeOrInspectNamespace"
        >({
          operation: "initializeOrInspectNamespace",
          commitCertainty: "notCommitted",
          reason: "bootstrapBindingMismatch",
          cause: null,
        }),
      );
    }
    if (current === null) {
      if (wasPreviouslyInitialized) {
        return yield* Result.fail(new QuerySyncStoredStateCorruptError<
          "initializeOrInspectNamespace"
        >({
          operation: "initializeOrInspectNamespace",
          commitCertainty: "notCommitted",
          reason: "aggregateMissing",
          cause: null,
        }));
      }
      const nextState = yield* createEmptyQuerySyncState(bootstrapCursor);
      return Object.freeze({
        receipt: initializedNamespaceReceipt(
          "initialized",
          nextState.cursor,
          nextState.metrics,
        ),
        nextState,
        changed: true,
      });
    }
    if (current.cursor.namespaceId !== binding.namespaceId) {
      return yield* Result.fail(new QuerySyncStoredStateCorruptError<
        "initializeOrInspectNamespace"
      >({
        operation: "initializeOrInspectNamespace",
        commitCertainty: "notCommitted",
        reason: "namespaceBindingMismatch",
        cause: null,
      }));
    }
    if (current.cursor.syncModelId !== binding.syncModelId) {
      return Object.freeze({
        receipt: modelReplacedReceipt(
          current.cursor,
          binding.syncModelId,
        ),
        nextState: current,
        changed: false,
      });
    }
    if (current.cursor.sourceEpoch !== binding.sourceEpoch) {
      return Object.freeze({
        receipt: epochReplacedReceipt(
          current.cursor,
          binding.sourceEpoch,
        ),
        nextState: current,
        changed: false,
      });
    }
    return Object.freeze({
      receipt: initializedNamespaceReceipt(
        "existing",
        current.cursor,
        current.metrics,
      ),
      nextState: current,
      changed: false,
    });
  });
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
    "QuerySync.ReferenceState.beginQueryGeneration",
  )(function*(target: QueryOperationTarget): Effect.fn.Return<
    BeginQueryGenerationReceipt,
    | BeginQueryGenerationError
    | QuerySyncStateIntegrationError<"beginQueryGeneration">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "beginQueryGeneration",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState("beginQueryGeneration"));
        }
        const state = yield* validateStoredBinding(
          "beginQueryGeneration",
          binding,
          current,
        );
        const decision = yield* beginQueryGeneration(state, target);
        return Object.freeze({
          receipt: projectBeginReceipt(decision),
          nextState: decision.state,
          changed: decision.state !== state,
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
        const decision = yield* applyAdmittedInvalidations(state, batch);
        return Object.freeze({
          receipt: projectApplyReceipt(decision),
          nextState: decision.state,
          changed: decision.state !== state,
        });
      }),
    );
  });

  const complete = Effect.fn(
    "QuerySync.ReferenceState.completeQueryGeneration",
  )(function*(
    evaluation: QueryEvaluationEvidence,
    refresh: GenerationRefreshEvidence,
  ): Effect.fn.Return<
    CompleteQueryGenerationReceipt,
    | CompleteQueryGenerationError
    | QuerySyncStateIntegrationError<"completeQueryGeneration">,
    never
  > {
    return yield* executeAtomic(
      cellRef,
      binding,
      "completeQueryGeneration",
      (current) => Result.gen(function* () {
        if (current === null) {
          return yield* Result.fail(missingState(
            "completeQueryGeneration",
          ));
        }
        const state = yield* validateStoredBinding(
          "completeQueryGeneration",
          binding,
          current,
        );
        const decision = yield* completeQueryGeneration(
          state,
          evaluation,
          refresh,
        );
        return Object.freeze({
          receipt: projectCompleteReceipt(decision),
          nextState: decision.state,
          changed: decision.state !== state,
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
    beginQueryGeneration: begin,
    applyAdmittedBatchAndAdvance: apply,
    completeQueryGeneration: complete,
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
