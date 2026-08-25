import type {
  PinnedDeveloperIndexV1,
  PinnedApplicationRelationRead,
  PinnedPointTableV1,
  RunSessionJournalRelationIncomingV1Result,
  RunSessionJournalIndexedQueryV1Result,
  RunSessionJournalPointOperationV1Result,
  SessionJournalIndexedQueryOperationV1,
  SessionJournalIndexedQuerySuccessV1,
  SessionJournalRelationConflictV1,
  SessionJournalRelationIncomingRequestEvidenceV1,
  SessionJournalRelationIncomingOperationV1,
  SessionJournalPointSuccessV1,
  SessionJournalAttemptV1,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistenceV1,
} from "@flarex/persistence-postgres/session-journal-store";
import {
  InvalidSessionJournalCapabilityV1Error,
  InvalidSessionJournalInputV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalIdentityGenerationV1Error,
  SessionJournalLeasePromotionV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalSealV1Error,
  SessionJournalStorageCorruptionV1Error,
  SessionJournalTargetUnavailableV1Error,
} from "@flarex/persistence-postgres/session-journal-store";
import type {
  RecoveredRunningRelationConflictEvidence,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
  ApplicationRevisionSyscallValidatorCorruptionV1Error,
  ApplicationRevisionSyscallValidatorIntegrationV1Error,
  ApplicationRevisionSyscallValidatorStaleV1Error,
  InvalidApplicationRevisionSyscallValidatorV1Error,
  type ApplicationRevisionSyscallValidatorV1,
} from "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { Data, Effect, Result, Schema, Semaphore } from "effect";

import {
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  type CommitProtocolV1Error,
  CommitSyscallSequenceV1Schema,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  OrderedIndexBoundHexV1Schema,
  type OrderedIndexBoundsV1,
} from "flarex-protocol/ordered-index";
import {
  AppDocumentIdV1Schema,
  type AppDocumentIdV1,
  decodeAppDocumentIdV1,
} from "flarex-protocol/app-document-id";

import {
  inspectLoadedPointMutationSessionAttemptV1,
  InvalidLoadedPointMutationSessionAttemptV1Error,
  type LoadedPointMutationSessionAttemptInspectionV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import { isPlainRecord } from "./plainRecord";
import {
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationExecutionScopeV1,
  type PointMutationExecutionClaimAdmissionV1,
} from "./pointMutationExecutionClaim";

const pointMutationJournalAttemptBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationJournalAttemptV1",
);

export interface PointMutationJournalAttemptV1 {
  readonly [pointMutationJournalAttemptBrand]: true;
}

const pointMutationJournalTableBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationJournalTableV1",
);

export interface PointMutationJournalTableV1 {
  readonly [pointMutationJournalTableBrand]: true;
}

const pointMutationJournalIndexBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationJournalIndexV1",
);

export interface PointMutationJournalIndexV1 {
  readonly [pointMutationJournalIndexBrand]: true;
}

const pointMutationJournalRelationBrand: unique symbol = Symbol(
  "FlarexExecutor/PointMutationJournalRelation",
);

export interface PointMutationJournalRelation {
  readonly [pointMutationJournalRelationBrand]: true;
}

export type PointMutationJournalApplicationRelationReadCapability = Parameters<
  SessionJournalStorePersistenceV1["resolveApplicationRelationReadEffect"]
>[1];

export class InvalidPointMutationJournalCapabilityV1Error
  extends Data.TaggedError("InvalidPointMutationJournalCapabilityV1Error")<{
    readonly capability:
      | "attempt"
      | "table"
      | "index"
      | "relation"
      | "relationConflict";
  }> {}

export class PointMutationJournalRelationConflictError extends Data.TaggedError(
  "PointMutationJournalRelationConflictError",
)<{
  readonly conflict: SessionJournalRelationConflictV1;
}> {}

export class UnsupportedPointMutationJournalOperationV1Error
  extends Data.TaggedError(
    "UnsupportedPointMutationJournalOperationV1Error",
  )<{
    readonly reason:
      | "notPlainObject"
      | "invalidKind"
      | "unexpectedFields"
      | "invalidFieldShape"
      | "invalidSequence";
    readonly operationKind?: unknown;
    readonly cause?: unknown;
  }> {}

export class PointMutationJournalPersistenceV1Error extends Data.TaggedError(
  "PointMutationJournalPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export class PointMutationJournalAttemptPinsV1Error extends Data.TaggedError(
  "PointMutationJournalAttemptPinsV1Error",
)<{
  readonly reason: "immutablePinsMismatch";
}> {}

export class PointMutationJournalAttemptUnavailableV1Error
  extends Data.TaggedError("PointMutationJournalAttemptUnavailableV1Error")<{
    readonly issue: SessionJournalAttemptUnavailableV1Error["issue"];
  }> {}

export type PointMutationJournalBoundaryV1Error =
  | InvalidPointMutationJournalCapabilityV1Error
  | InvalidPointMutationExecutionClaimV1Error
  | InvalidLoadedPointMutationSessionAttemptV1Error
  | UnsupportedPointMutationJournalOperationV1Error
  | PointMutationJournalAttemptPinsV1Error
  | PointMutationJournalAttemptUnavailableV1Error
  | PointMutationJournalRelationConflictError
  | PointMutationJournalPersistenceV1Error
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalIdentityGenerationV1Error
  | SessionJournalLeasePromotionV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | InvalidApplicationRevisionSyscallValidatorV1Error
  | ApplicationRevisionSyscallValidatorStaleV1Error
  | ApplicationRevisionSyscallValidatorCorruptionV1Error
  | ApplicationRevisionSyscallValidatorIntegrationV1Error
  | ApplicationRevisionSyscallDocumentValidationV1Error;

export interface PointMutationJournalV1 {
  readonly openAttempt: (
    attempt: LoadedPointMutationSessionAttemptV1,
    executionClaim: PointMutationExecutionScopeV1,
  ) => Effect.Effect<
    PointMutationJournalAttemptV1,
    PointMutationJournalBoundaryV1Error
  >;
  readonly resolvePointTable: (
    attempt: PointMutationJournalAttemptV1,
    tableName: unknown,
  ) => Effect.Effect<
    PointMutationJournalTableV1,
    PointMutationJournalBoundaryV1Error
  >;
  readonly runPointOperation: (
    table: PointMutationJournalTableV1,
    operation: unknown,
  ) => Effect.Effect<
    RunSessionJournalPointOperationV1Result,
    PointMutationJournalBoundaryV1Error
  >;
  readonly resolveDeveloperIndex: (
    table: PointMutationJournalTableV1,
    indexDescriptor: unknown,
  ) => Effect.Effect<
    PointMutationJournalIndexV1,
    PointMutationJournalBoundaryV1Error
  >;
  readonly runIndexedQuery: (
    index: PointMutationJournalIndexV1,
    operation: unknown,
  ) => Effect.Effect<
    RunSessionJournalIndexedQueryV1Result,
    PointMutationJournalBoundaryV1Error
  >;
  readonly resolveApplicationRelationRead: (
    attempt: PointMutationJournalAttemptV1,
    capability: PointMutationJournalApplicationRelationReadCapability,
  ) => Effect.Effect<
    PointMutationJournalRelation,
    PointMutationJournalBoundaryV1Error
  >;
  readonly runApplicationRelationIncomingRead: (
    relation: PointMutationJournalRelation,
    operation: unknown,
  ) => Effect.Effect<
    Exclude<
      RunSessionJournalRelationIncomingV1Result,
      { readonly kind: "conflicted" }
    >,
    PointMutationJournalBoundaryV1Error
  >;
  readonly claimPersistedRelationConflictForRetry: (
    input: unknown,
  ) => Result.Result<
    Readonly<{
      readonly error: PointMutationJournalRelationConflictError;
      readonly request: Readonly<
        SessionJournalRelationIncomingRequestEvidenceV1
      >;
      readonly conflict: SessionJournalRelationConflictV1;
    }>,
    InvalidPointMutationJournalCapabilityV1Error
  >;
  readonly sealSuccessfulResult: (
    attempt: PointMutationJournalAttemptV1,
    successfulResult: unknown,
  ) => Effect.Effect<
    StoredForSessionAttemptCommitEnvelopeV1,
    PointMutationJournalBoundaryV1Error | CommitProtocolV1Error
  >;
}

export interface PointMutationJournalRelationConflictRecovery {
  readonly captureRecoveredRelationConflict: (
    evidence: RecoveredRunningRelationConflictEvidence,
  ) => PointMutationJournalRelationConflictError;
}

export type PointMutationJournalLogicalOutcomeV1 =
  SessionJournalPointSuccessV1;

export type PointMutationJournalIndexedQueryLogicalOutcomeV1 =
  SessionJournalIndexedQuerySuccessV1;

interface JournalAttemptCoordinatorV1 {
  readonly inspection: LoadedPointMutationSessionAttemptInspectionV1;
  readonly semaphore: Semaphore.Semaphore;
}

interface JournalAttemptStateV1 {
  readonly persistenceAttempt: SessionJournalAttemptV1;
  readonly coordinator: JournalAttemptCoordinatorV1;
}

interface JournalTableStateV1 {
  readonly attempt: JournalAttemptStateV1;
  readonly persistenceTable: PinnedPointTableV1;
}

interface JournalIndexStateV1 {
  readonly attempt: JournalAttemptStateV1;
  readonly persistenceIndex: PinnedDeveloperIndexV1;
}

interface JournalRelationState {
  readonly attempt: JournalAttemptStateV1;
  readonly persistenceRelation: PinnedApplicationRelationRead;
}

const decodeSyscallSequence = Schema.decodeUnknownSync(
  Schema.toType(CommitSyscallSequenceV1Schema),
);
const decodeSyscallSequenceResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSyscallSequenceV1Schema),
);
const decodeAppDocumentIdResult = Schema.decodeUnknownResult(
  AppDocumentIdV1Schema,
);
const decodeOrderedIndexBoundResult = Schema.decodeUnknownResult(
  OrderedIndexBoundHexV1Schema,
);

export function createPointMutationJournalV1(
  persistence: SessionJournalStorePersistenceV1,
  executionClaims: PointMutationExecutionClaimAdmissionV1,
  syscallValidator: ApplicationRevisionSyscallValidatorV1,
): PointMutationJournalV1 & PointMutationJournalRelationConflictRecovery {
  const attemptStates = new WeakMap<object, JournalAttemptStateV1>();
  const tableStates = new WeakMap<object, JournalTableStateV1>();
  const indexStates = new WeakMap<object, JournalIndexStateV1>();
  const relationStates = new WeakMap<object, JournalRelationState>();
  const persistedRelationConflicts = new WeakMap<
    object,
    Readonly<{
      readonly error: PointMutationJournalRelationConflictError;
      readonly request: Readonly<
        SessionJournalRelationIncomingRequestEvidenceV1
      >;
      readonly conflict: SessionJournalRelationConflictV1;
    }>
  >();
  const openedByExecutionClaim = new WeakMap<
    object,
    PointMutationJournalAttemptV1
  >();
  const coordinatorsByExactAttempt = new Map<
    string,
    WeakRef<JournalAttemptCoordinatorV1>
  >();
  const coordinatorFinalizer = new FinalizationRegistry<Readonly<{
    readonly identityKey: string;
    readonly reference: WeakRef<JournalAttemptCoordinatorV1>;
  }>>(({ identityKey, reference }) => {
    if (coordinatorsByExactAttempt.get(identityKey) === reference) {
      coordinatorsByExactAttempt.delete(identityKey);
    }
  });

  const requireAttempt = (
    value: PointMutationJournalAttemptV1,
  ): JournalAttemptStateV1 => {
    const state = typeof value === "object" && value !== null
      ? attemptStates.get(value)
      : undefined;
    if (state === undefined) {
      throw new InvalidPointMutationJournalCapabilityV1Error({
        capability: "attempt",
      });
    }
    return state;
  };

  const openAttempt: PointMutationJournalV1["openAttempt"] = Effect.fn(
    "PointMutationJournal.openAttempt",
  )(function* (loadedAttempt, executionClaim) {
    const claimState = yield* Effect.fromResult(
      executionClaims.inspect(executionClaim, "execute"),
    );
    const existing = openedByExecutionClaim.get(executionClaim);
    if (existing !== undefined) return existing;
    const inspection = yield* Effect.try({
      try: () => inspectLoadedPointMutationSessionAttemptV1(loadedAttempt),
      catch: mapPersistenceFailure,
    });
    const identityKey = exactAttemptIdentityKey(inspection);
    if (!attemptSelectorEquals(inspection.selector, claimState.selector)) {
      return yield* Effect.fail(new PointMutationJournalAttemptPinsV1Error({
        reason: "immutablePinsMismatch",
      }));
    }
    const existingReference = coordinatorsByExactAttempt.get(identityKey);
    const existingCoordinator = existingReference?.deref();
    if (existingReference !== undefined && existingCoordinator === undefined) {
      coordinatorsByExactAttempt.delete(identityKey);
    }
    if (
      existingCoordinator !== undefined &&
      !immutableAttemptPinsEqual(existingCoordinator.inspection, inspection)
    ) {
      return yield* Effect.fail(new PointMutationJournalAttemptPinsV1Error({
        reason: "immutablePinsMismatch",
      }));
    }
    const coordinator = existingCoordinator ?? Object.freeze({
      inspection,
      semaphore: Semaphore.makeUnsafe(1),
    } satisfies JournalAttemptCoordinatorV1);
    if (existingCoordinator === undefined) {
      const reference = new WeakRef(coordinator);
      coordinatorsByExactAttempt.set(identityKey, reference);
      coordinatorFinalizer.register(coordinator, Object.freeze({
        identityKey,
        reference,
      }));
    }
    const persistenceAttempt = yield* persistence.openAttemptEffect({
      selector: inspection.selector,
      snapshotToken: inspection.snapshotToken,
      schemaVersionId: inspection.schemaVersionId,
      executionClaim: claimState.observation,
    }).pipe(Effect.mapError(mapPersistenceFailure));
    const state = Object.freeze({
      persistenceAttempt,
      coordinator,
    } satisfies JournalAttemptStateV1);
    const handle = Object.freeze({
      [pointMutationJournalAttemptBrand]: true as const,
    });
    attemptStates.set(handle, state);
    openedByExecutionClaim.set(executionClaim, handle);
    return handle;
  });

  const resolvePointTable: PointMutationJournalV1["resolvePointTable"] =
    Effect.fn("PointMutationJournal.resolvePointTable")(
      function* (attempt, tableName) {
        const state = yield* Effect.try({
          try: () => requireAttempt(attempt),
          catch: mapPersistenceFailure,
        });
        const persistenceTable = yield* state.coordinator.semaphore.withPermit(
          Effect.uninterruptible(
            persistence.resolvePointTableEffect(
              state.persistenceAttempt,
              tableName,
            ).pipe(Effect.mapError(mapPersistenceFailure)),
          ),
        );
        const handle = Object.freeze({
          [pointMutationJournalTableBrand]: true as const,
        });
        tableStates.set(handle, Object.freeze({
          attempt: state,
          persistenceTable,
        }));
        return handle;
      },
    );

  const runPointOperation: PointMutationJournalV1["runPointOperation"] =
    Effect.fn("PointMutationJournal.runPointOperation")(
      function* (table, input) {
        const captured = yield* Effect.try({
          try: () => {
            const state = typeof table === "object" && table !== null
              ? tableStates.get(table)
              : undefined;
            if (state === undefined) {
              throw new InvalidPointMutationJournalCapabilityV1Error({
                capability: "table",
              });
            }
            return Object.freeze({
              state,
              operation: decodePointOperation(input),
            });
          },
          catch: mapPersistenceFailure,
        });
        return yield* captured.state.attempt.coordinator.semaphore.withPermit(
          Effect.uninterruptible(
            persistence.runPointOperationEffect(
              captured.state.persistenceTable,
              captured.operation,
              syscallValidator,
            ).pipe(
              Effect.mapError(mapPersistenceFailure),
            ),
          ),
        );
      },
    );

  const resolveDeveloperIndex: PointMutationJournalV1[
    "resolveDeveloperIndex"
  ] = Effect.fn("PointMutationJournal.resolveDeveloperIndex")(
    function* (table, indexDescriptor) {
      const tableState = yield* Effect.try({
        try: () => {
          const state = typeof table === "object" && table !== null
            ? tableStates.get(table)
            : undefined;
          if (state === undefined) {
            throw new InvalidPointMutationJournalCapabilityV1Error({
              capability: "table",
            });
          }
          return state;
        },
        catch: mapPersistenceFailure,
      });
      const persistenceIndex = yield* tableState.attempt.coordinator.semaphore
        .withPermit(
          Effect.uninterruptible(
            persistence.resolveDeveloperIndexEffect(
              tableState.persistenceTable,
              indexDescriptor,
            ).pipe(Effect.mapError(mapPersistenceFailure)),
          ),
        );
      const handle = Object.freeze({
        [pointMutationJournalIndexBrand]: true as const,
      });
      indexStates.set(handle, Object.freeze({
        attempt: tableState.attempt,
        persistenceIndex,
      }));
      return handle;
    },
  );

  const runIndexedQuery: PointMutationJournalV1["runIndexedQuery"] =
    Effect.fn("PointMutationJournal.runIndexedQuery")(
      function* (index, input) {
        const state = yield* Effect.try({
          try: () => {
            const indexState = typeof index === "object" && index !== null
              ? indexStates.get(index)
              : undefined;
            if (indexState === undefined) {
              throw new InvalidPointMutationJournalCapabilityV1Error({
                capability: "index",
              });
            }
            return indexState;
          },
          catch: mapPersistenceFailure,
        });
        const operation = yield* Effect.fromResult(
          decodeIndexedQueryOperationResult(input),
        );
        return yield* state.attempt.coordinator.semaphore.withPermit(
          Effect.uninterruptible(
            persistence.runIndexedQueryEffect(
              state.persistenceIndex,
              operation,
            ).pipe(Effect.mapError(mapPersistenceFailure)),
          ),
        );
      },
    );

  const resolveApplicationRelationRead: PointMutationJournalV1[
    "resolveApplicationRelationRead"
  ] = Effect.fn("PointMutationJournal.resolveApplicationRelationRead")(
    function* (attempt, capability) {
      const state = yield* Effect.try({
        try: () => requireAttempt(attempt),
        catch: mapPersistenceFailure,
      });
      const persistenceRelation = yield* state.coordinator.semaphore.withPermit(
        Effect.uninterruptible(
          persistence.resolveApplicationRelationReadEffect(
            state.persistenceAttempt,
            capability,
          ).pipe(Effect.mapError(mapPersistenceFailure)),
        ),
      );
      const handle = Object.freeze({
        [pointMutationJournalRelationBrand]: true as const,
      });
      relationStates.set(handle, Object.freeze({
        attempt: state,
        persistenceRelation,
      }));
      return handle;
    },
  );

  const runApplicationRelationIncomingRead: PointMutationJournalV1[
    "runApplicationRelationIncomingRead"
  ] = Effect.fn("PointMutationJournal.runApplicationRelationIncomingRead")(
    function* (relation, input) {
      const state = typeof relation === "object" && relation !== null
        ? relationStates.get(relation)
        : undefined;
      if (state === undefined) {
        return yield* Effect.fail(
          new InvalidPointMutationJournalCapabilityV1Error({
            capability: "relation",
          }),
        );
      }
      const operation = yield* Effect.fromResult(
        decodeRelationIncomingOperationResult(input),
      );
      const result = yield* state.attempt.coordinator.semaphore
        .withPermit(
          Effect.uninterruptible(
            persistence.runApplicationRelationIncomingReadEffect(
              state.persistenceRelation,
              operation,
            ).pipe(Effect.mapError(mapPersistenceFailure)),
          ),
        );
      if (result.kind !== "conflicted") return result;
      const error = captureRelationConflict(result.request, result.conflict);
      return yield* Effect.fail(error);
    },
  );

  function captureRelationConflict(
    requestInput: SessionJournalRelationIncomingRequestEvidenceV1,
    conflictInput: SessionJournalRelationConflictV1,
  ): PointMutationJournalRelationConflictError {
    const request = Object.freeze(structuredClone(requestInput));
    const conflict = Object.freeze(structuredClone(conflictInput));
    const error = new PointMutationJournalRelationConflictError({ conflict });
    persistedRelationConflicts.set(error, Object.freeze({
      error,
      request,
      conflict,
    }));
    return error;
  }

  const captureRecoveredRelationConflict:
    PointMutationJournalRelationConflictRecovery[
      "captureRecoveredRelationConflict"
    ] = (evidence) =>
      captureRelationConflict(evidence.request, evidence.conflict);

  const claimPersistedRelationConflictForRetry: PointMutationJournalV1[
    "claimPersistedRelationConflictForRetry"
  ] = (input) => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(new InvalidPointMutationJournalCapabilityV1Error({
        capability: "relationConflict",
      }));
    }
    const claimed = persistedRelationConflicts.get(input);
    if (claimed === undefined) {
      return Result.fail(new InvalidPointMutationJournalCapabilityV1Error({
        capability: "relationConflict",
      }));
    }
    persistedRelationConflicts.delete(input);
    return Result.succeed(claimed);
  };

  const sealSuccessfulResult: PointMutationJournalV1["sealSuccessfulResult"] =
    Effect.fn("PointMutationJournal.sealSuccessfulResult")(
      function* (attempt, successfulResult) {
        const state = yield* Effect.try({
          try: () => requireAttempt(attempt),
          catch: mapPersistenceFailure,
        });
        return yield* state.coordinator.semaphore.withPermit(
          Effect.gen(function* () {
            const prepared = yield* Effect.uninterruptible(
              persistence
                .prepareSealEffect(state.persistenceAttempt)
                .pipe(Effect.mapError(mapPersistenceFailure)),
            );
            const journal = yield* canonicalizeSessionJournalV1Effect(
              prepared.journal,
            );
            const result =
              yield* canonicalizeSuccessfulResultV1Effect(successfulResult);
            return yield* Effect.uninterruptible(
              persistence
                .completeSealEffect(prepared.preparation, journal, result)
                .pipe(Effect.mapError(mapPersistenceFailure)),
            );
          }),
        );
      },
    );

  const journal = Object.freeze({
    openAttempt,
    resolvePointTable,
    runPointOperation,
    resolveDeveloperIndex,
    runIndexedQuery,
    resolveApplicationRelationRead,
    runApplicationRelationIncomingRead,
    captureRecoveredRelationConflict,
    claimPersistedRelationConflictForRetry,
    sealSuccessfulResult,
  });
  return journal;
}

function decodeIndexedQueryOperationResult(
  input: unknown,
): Result.Result<
  SessionJournalIndexedQueryOperationV1,
  UnsupportedPointMutationJournalOperationV1Error
> {
  return Result.gen(function* () {
    const record = yield* Result.try({
      try: () => isPlainRecord(input) ? input : null,
      catch: (cause) => indexedOperationFieldError(undefined, cause),
    });
    if (record === null) {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "notPlainObject",
        }),
      );
    }
    const kind = yield* readIndexedDataPropertyResult(record, "kind");
    if (kind !== "indexRange") {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "invalidKind",
          operationKind: kind,
        }),
      );
    }
    const captured = yield* Result.try({
      try: () => {
        const expectedFields = new Set([
          "kind",
          "syscallSequence",
          "bounds",
          "limit",
        ]);
        const actualFields = Reflect.ownKeys(record);
        if (
          actualFields.length !== expectedFields.size ||
          actualFields.some((field) =>
            typeof field !== "string" || !expectedFields.has(field))
        ) {
          throw new UnsupportedPointMutationJournalOperationV1Error({
            reason: "unexpectedFields",
            operationKind: kind,
          });
        }
        const boundsInput = readDataProperty(record, "bounds");
        const boundsRecord = isPlainRecord(boundsInput) ? boundsInput : null;
        if (boundsRecord === null) throw new Error("Invalid bounds.");
        const boundsKeys = Reflect.ownKeys(boundsRecord);
        if (boundsKeys.some((field) =>
          field !== "startInclusive" && field !== "endExclusive")) {
          throw new Error("Invalid bounds fields.");
        }
        return Object.freeze({
          syscallSequenceInput: readDataProperty(record, "syscallSequence"),
          start: Object.hasOwn(boundsRecord, "startInclusive")
            ? readDataProperty(boundsRecord, "startInclusive")
            : undefined,
          end: Object.hasOwn(boundsRecord, "endExclusive")
            ? readDataProperty(boundsRecord, "endExclusive")
            : undefined,
          limit: readDataProperty(record, "limit"),
        });
      },
      catch: (cause) => cause instanceof UnsupportedPointMutationJournalOperationV1Error
        ? cause
        : indexedOperationFieldError(kind, cause),
    });
    const syscallSequence = yield* decodeSyscallSequenceResult(
      captured.syscallSequenceInput,
    ).pipe(Result.mapError((cause) => indexedOperationFieldError(kind, cause)));
    const start = captured.start === undefined
      ? undefined
      : yield* decodeOrderedIndexBoundResult(captured.start).pipe(
          Result.mapError((cause) => indexedOperationFieldError(kind, cause)),
        );
    const end = captured.end === undefined
      ? undefined
      : yield* decodeOrderedIndexBoundResult(captured.end).pipe(
          Result.mapError((cause) => indexedOperationFieldError(kind, cause)),
        );
    if (!Number.isSafeInteger(captured.limit) || Number(captured.limit) <= 0) {
      return yield* Result.fail(indexedOperationFieldError(kind));
    }
    const bounds: OrderedIndexBoundsV1 = Object.freeze({
      ...(start === undefined ? {} : { startInclusive: start }),
      ...(end === undefined ? {} : { endExclusive: end }),
    });
    return Object.freeze({
      kind,
      syscallSequence,
      bounds,
      limit: Number(captured.limit),
    });
  });
}

function decodeRelationIncomingOperationResult(
  input: unknown,
): Result.Result<
  SessionJournalRelationIncomingOperationV1,
  PointMutationJournalBoundaryV1Error
> {
  return Result.gen(function* () {
    const record = yield* Result.try({
      try: () => isPlainRecord(input) ? input : null,
      catch: mapPersistenceFailure,
    });
    if (record === null) {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "notPlainObject",
        }),
      );
    }
    const kind = yield* Result.try({
      try: () => readDataProperty(record, "kind"),
      catch: mapPersistenceFailure,
    });
    if (kind !== "relationIncoming") {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "invalidKind",
          operationKind: kind,
        }),
      );
    }
    const actualFields = yield* Result.try({
      try: () => Reflect.ownKeys(record),
      catch: mapPersistenceFailure,
    });
    const expectedFields = new Set([
      "kind",
      "syscallSequence",
      "targetDocumentId",
      "limit",
    ]);
    if (
      actualFields.length !== expectedFields.size ||
      actualFields.some((field) =>
        typeof field !== "string" || !expectedFields.has(field))
    ) {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "unexpectedFields",
          operationKind: kind,
        }),
      );
    }
    const syscallSequenceInput = yield* readRelationOperationFieldResult(
      record,
      "syscallSequence",
      kind,
    );
    const syscallSequence = yield* decodeSyscallSequenceResult(
      syscallSequenceInput,
    ).pipe(Result.mapError(cause => relationOperationFieldError(kind, cause)));
    const targetDocumentIdInput = yield* readRelationOperationFieldResult(
      record,
      "targetDocumentId",
      kind,
    );
    const targetDocumentId = yield* decodeAppDocumentIdResult(
      targetDocumentIdInput,
    ).pipe(Result.mapError(cause => relationOperationFieldError(kind, cause)));
    const limit = yield* readRelationOperationFieldResult(
      record,
      "limit",
      kind,
    );
    if (!Number.isSafeInteger(limit) || Number(limit) <= 0) {
      return yield* Result.fail(relationOperationFieldError(
        kind,
        new Error("Invalid relation read limit."),
      ));
    }
    return Object.freeze({
      kind,
      syscallSequence,
      targetDocumentId,
      limit: Number(limit),
    });
  });
}

function readRelationOperationFieldResult(
  input: Readonly<Record<string, unknown>>,
  field: string,
  operationKind: unknown,
): Result.Result<unknown, UnsupportedPointMutationJournalOperationV1Error> {
  return Result.try({
    try: () => readDataProperty(input, field),
    catch: cause => relationOperationFieldError(operationKind, cause),
  });
}

function relationOperationFieldError(
  operationKind?: unknown,
  cause?: unknown,
): UnsupportedPointMutationJournalOperationV1Error {
  return new UnsupportedPointMutationJournalOperationV1Error({
    reason: "invalidFieldShape",
    ...(operationKind === undefined ? {} : { operationKind }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function readIndexedDataPropertyResult(
  input: Readonly<Record<string, unknown>>,
  field: string,
): Result.Result<unknown, UnsupportedPointMutationJournalOperationV1Error> {
  return Result.try({
    try: () => readDataProperty(input, field),
    catch: (cause) => indexedOperationFieldError(undefined, cause),
  });
}

function indexedOperationFieldError(
  operationKind?: unknown,
  cause?: unknown,
): UnsupportedPointMutationJournalOperationV1Error {
  return new UnsupportedPointMutationJournalOperationV1Error({
    reason: "invalidFieldShape",
    ...(operationKind === undefined ? {} : { operationKind }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function attemptSelectorEquals(
  left: LoadedPointMutationSessionAttemptInspectionV1["selector"],
  right: LoadedPointMutationSessionAttemptInspectionV1["selector"],
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.scopeId === right.scopeId &&
    left.sessionId === right.sessionId &&
    left.attemptFence === right.attemptFence;
}

function exactAttemptIdentityKey(
  inspection: LoadedPointMutationSessionAttemptInspectionV1,
): string {
  const selector = inspection.selector;
  return JSON.stringify([
    selector.deploymentId,
    selector.scopeId,
    selector.sessionId,
    selector.attemptFence.toString(),
  ]);
}

function immutableAttemptPinsEqual(
  left: LoadedPointMutationSessionAttemptInspectionV1,
  right: LoadedPointMutationSessionAttemptInspectionV1,
): boolean {
  return left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.schemaVersionId === right.schemaVersionId &&
    left.snapshotToken.scopeId === right.snapshotToken.scopeId &&
    left.snapshotToken.epoch === right.snapshotToken.epoch &&
    left.snapshotToken.commitSeq === right.snapshotToken.commitSeq;
}

function decodePointOperation(input: unknown): SessionJournalPointOperationV1 {
  if (!isPlainRecord(input)) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "notPlainObject",
    });
  }
  const kind = readDataProperty(input, "kind");
  if (
    kind !== "get" &&
    kind !== "insert" &&
    kind !== "patch" &&
    kind !== "replace" &&
    kind !== "delete"
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidKind",
      operationKind: kind,
    });
  }
  const expectedFields = fieldsForOperation(kind);
  const actualFields = Reflect.ownKeys(input);
  if (
    actualFields.length !== expectedFields.size ||
    actualFields.some((field) =>
      typeof field !== "string" || !expectedFields.has(field))
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "unexpectedFields",
      operationKind: kind,
    });
  }
  let syscallSequence: SessionJournalPointOperationV1["syscallSequence"];
  try {
    syscallSequence = decodeSyscallSequence(
      readDataProperty(input, "syscallSequence"),
    );
  } catch (cause) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidSequence",
      operationKind: kind,
      cause,
    });
  }
  switch (kind) {
    case "get":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
      });
    case "insert":
      return Object.freeze({
        kind,
        syscallSequence,
        fields: readDataProperty(input, "fields"),
      });
    case "patch":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
        patch: readDataProperty(input, "patch"),
      });
    case "replace":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
        fields: readDataProperty(input, "fields"),
      });
    case "delete":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
      });
  }
}

function decodeOperationDocumentId(
  input: Readonly<Record<string, unknown>>,
  operationKind: SessionJournalPointOperationV1["kind"],
): AppDocumentIdV1 {
  try {
    return decodeAppDocumentIdV1(readDataProperty(input, "documentId"));
  } catch (cause) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidFieldShape",
      operationKind,
      cause,
    });
  }
}

function fieldsForOperation(
  kind: SessionJournalPointOperationV1["kind"],
): ReadonlySet<string> {
  switch (kind) {
    case "get":
    case "delete":
      return new Set(["kind", "syscallSequence", "documentId"]);
    case "insert":
      return new Set(["kind", "syscallSequence", "fields"]);
    case "patch":
      return new Set(["kind", "syscallSequence", "documentId", "patch"]);
    case "replace":
      return new Set(["kind", "syscallSequence", "documentId", "fields"]);
  }
}

function readDataProperty(
  input: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor)
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidFieldShape",
    });
  }
  return descriptor.value;
}

function mapPersistenceFailure(
  cause: unknown,
): PointMutationJournalBoundaryV1Error {
  if (cause instanceof SessionJournalAttemptUnavailableV1Error) {
    return new PointMutationJournalAttemptUnavailableV1Error({
      issue: cause.issue,
    });
  }
  if (cause instanceof SessionJournalPersistenceV1Error) {
    return new PointMutationJournalPersistenceV1Error({
      cause: cause.cause,
    });
  }
  if (
    cause instanceof InvalidLoadedPointMutationSessionAttemptV1Error ||
    cause instanceof InvalidPointMutationJournalCapabilityV1Error ||
    cause instanceof UnsupportedPointMutationJournalOperationV1Error ||
    cause instanceof PointMutationJournalAttemptPinsV1Error ||
    cause instanceof PointMutationJournalRelationConflictError ||
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof PinnedPointTableCorruptionV1Error ||
    cause instanceof PinnedPointTableNotFoundV1Error ||
    cause instanceof SessionJournalIdentityGenerationV1Error ||
    cause instanceof SessionJournalLeasePromotionV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error ||
    cause instanceof InvalidApplicationRevisionSyscallValidatorV1Error ||
    cause instanceof ApplicationRevisionSyscallValidatorStaleV1Error ||
    cause instanceof ApplicationRevisionSyscallValidatorCorruptionV1Error ||
    cause instanceof ApplicationRevisionSyscallValidatorIntegrationV1Error ||
    cause instanceof ApplicationRevisionSyscallDocumentValidationV1Error
  ) {
    return cause;
  }
  return new PointMutationJournalPersistenceV1Error({ cause });
}
