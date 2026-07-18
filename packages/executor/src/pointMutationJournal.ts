import type {
  PinnedPointTableV1,
  RunSessionJournalPointOperationV1Result,
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
  SessionJournalPersistenceV1Error,
  SessionJournalSealV1Error,
  SessionJournalStorageCorruptionV1Error,
  SessionJournalTargetUnavailableV1Error,
} from "@flarex/persistence-postgres/session-journal-store";
import { Data, Effect, Schema, Semaphore } from "effect";

import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  type CommitProtocolV1Error,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  decodeAppDocumentIdV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";

import {
  InvalidLoadedPointMutationSessionAttemptV1Error,
  inspectLoadedPointMutationSessionAttemptV1,
  type LoadedPointMutationSessionAttemptInspectionV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import { isPlainRecord } from "./plainRecord";

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

export class InvalidPointMutationJournalCapabilityV1Error
  extends Data.TaggedError("InvalidPointMutationJournalCapabilityV1Error")<{
    readonly capability: "attempt" | "table";
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
  | InvalidLoadedPointMutationSessionAttemptV1Error
  | UnsupportedPointMutationJournalOperationV1Error
  | PointMutationJournalAttemptPinsV1Error
  | PointMutationJournalAttemptUnavailableV1Error
  | PointMutationJournalPersistenceV1Error
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalIdentityGenerationV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export interface PointMutationJournalV1 {
  readonly openAttempt: (
    attempt: LoadedPointMutationSessionAttemptV1,
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
  readonly sealSuccessfulResult: (
    attempt: PointMutationJournalAttemptV1,
    successfulResult: unknown,
  ) => Effect.Effect<
    StoredForSessionAttemptCommitEnvelopeV1,
    PointMutationJournalBoundaryV1Error | CommitProtocolV1Error
  >;
}

const pointMutationJournalsByPersistence = new WeakMap<
  SessionJournalStorePersistenceV1,
  PointMutationJournalV1
>();

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

const decodeSyscallSequence = Schema.decodeUnknownSync(
  CommitSyscallSequenceV1Schema,
);

export function createPointMutationJournalV1(
  persistence: SessionJournalStorePersistenceV1,
): PointMutationJournalV1 {
  const existingJournal = pointMutationJournalsByPersistence.get(persistence);
  if (existingJournal !== undefined) return existingJournal;

  const attemptStates = new WeakMap<object, JournalAttemptStateV1>();
  const tableStates = new WeakMap<object, JournalTableStateV1>();
  const openedByLoadedAttempt = new WeakMap<
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
  )(function* (loadedAttempt) {
    const existing = openedByLoadedAttempt.get(loadedAttempt);
    if (existing !== undefined) return existing;
    const inspection = yield* Effect.try({
      try: () => inspectLoadedPointMutationSessionAttemptV1(loadedAttempt),
      catch: mapPersistenceFailure,
    });
    const identityKey = exactAttemptIdentityKey(inspection);
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
    });
    const state = Object.freeze({
      persistenceAttempt,
      coordinator,
    } satisfies JournalAttemptStateV1);
    const handle = Object.freeze({
      [pointMutationJournalAttemptBrand]: true as const,
    });
    attemptStates.set(handle, state);
    openedByLoadedAttempt.set(loadedAttempt, handle);
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
            ).pipe(
              Effect.catchTag(
                "SessionJournalPersistenceV1Error",
                (error) => Effect.fail(
                  new PointMutationJournalPersistenceV1Error({
                    cause: error.cause,
                  }),
                ),
              ),
            ),
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
            ).pipe(
              Effect.mapError(mapPersistenceFailure),
            ),
          ),
        );
      },
    );

  const sealSuccessfulResult: PointMutationJournalV1[
    "sealSuccessfulResult"
  ] = Effect.fn("PointMutationJournal.sealSuccessfulResult")(
    function* (attempt, successfulResult) {
      const state = yield* Effect.try({
        try: () => requireAttempt(attempt),
        catch: mapPersistenceFailure,
      });
      return yield* state.coordinator.semaphore.withPermit(
        Effect.uninterruptible(Effect.gen(function* () {
          const prepared = yield* Effect.tryPromise({
            try: () => persistence.prepareSeal(state.persistenceAttempt),
            catch: mapPersistenceFailure,
          });
          const journal = yield* canonicalizeSessionJournalV1Effect(
            prepared.journal,
          );
          const result = yield* canonicalizeSuccessfulResultV1Effect(
            successfulResult,
          );
          return yield* Effect.tryPromise({
            try: () => persistence.completeSeal(
              prepared.preparation,
              journal,
              result,
            ),
            catch: mapPersistenceFailure,
          });
        })),
      );
    },
  );

  const journal = Object.freeze({
    openAttempt,
    resolvePointTable,
    runPointOperation,
    sealSuccessfulResult,
  });
  pointMutationJournalsByPersistence.set(persistence, journal);
  return journal;
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
    cause instanceof InvalidSessionJournalCapabilityV1Error ||
    cause instanceof InvalidSessionJournalInputV1Error ||
    cause instanceof PinnedPointTableCorruptionV1Error ||
    cause instanceof PinnedPointTableNotFoundV1Error ||
    cause instanceof SessionJournalIdentityGenerationV1Error ||
    cause instanceof SessionJournalSealV1Error ||
    cause instanceof SessionJournalStorageCorruptionV1Error ||
    cause instanceof SessionJournalTargetUnavailableV1Error
  ) {
    return cause;
  }
  return new PointMutationJournalPersistenceV1Error({ cause });
}
