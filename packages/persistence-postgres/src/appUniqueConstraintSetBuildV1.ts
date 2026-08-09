import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
  APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
  AppUniqueConstraintSetBuildAttemptFenceV1Schema,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1,
  appUniqueConstraintSetSha256HexV1ToBytes,
  type AppUniqueConstraintSetBuildAttemptFenceV1,
  type AppUniqueConstraintSetSha256HexV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
  type CommitSeq,
  FlarexDbV1StorageGenerationSchema,
  type ScopeId,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import {
  readAppUniqueConstraintSetClosureV1Effect,
  type ReadAppUniqueConstraintSetClosureV1Error,
} from "./appUniqueConstraintSetClosureV1";
import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  getScopeClock,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import { fxSystemUniqueConstraintSetBuilds } from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "./transactionSessionActivation";

const INPUT_KEYS = Object.freeze(["deploymentId", "schemaVersionId"] as const);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);

export interface ReconcileAppUniqueConstraintSetBuildV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface LocatedAppUniqueConstraintSetBuildTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedAppUniqueConstraintSetBuildTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedAppUniqueConstraintSetBuildTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
}

export interface AppUniqueConstraintSetBuildPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedAppUniqueConstraintSetBuildTargetV1
  >;
}

export type AppUniqueConstraintSetBuildFaultPointV1 =
  | "afterBuildInsert"
  | "afterStaleBuildRedeclare";

export interface AppUniqueConstraintSetBuildOptionsV1 {
  readonly faultAfter?: (
    point: AppUniqueConstraintSetBuildFaultPointV1,
  ) => void;
}

export type ReconcileAppUniqueConstraintSetBuildV1Result =
  | Readonly<{
      readonly status: "absent";
      readonly reason: "setNotClosed";
      readonly deploymentId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
    }>
  | Readonly<{
      readonly status: "reconciled";
      readonly disposition:
        | "created"
        | "replayed"
        | "redeclared"
        | "replayedAfterUncertainCompletion";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly definitionCount: number;
      readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
      readonly startCommitSeq: CommitSeq;
      readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
    }>;

export class InvalidAppUniqueConstraintSetBuildInputV1Error
  extends Data.TaggedError("InvalidAppUniqueConstraintSetBuildInputV1Error")<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidSchemaVersionId";
  }> {}

export class AppUniqueConstraintSetBuildStaleAuthorityV1Error
  extends Data.TaggedError(
    "AppUniqueConstraintSetBuildStaleAuthorityV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly reason: "storageGeneration" | "storageGenerationFence" | "epoch";
  }> {}

export class AppUniqueConstraintSetBuildStateV1Error
  extends Data.TaggedError("AppUniqueConstraintSetBuildStateV1Error")<{
    readonly scopeId: ScopeId;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly reason:
      | "storedStateInvalid"
      | "definitionSetMismatch"
      | "frontierAheadOfClock"
      | "attemptFenceExhausted"
      | "concurrentStateChange";
    readonly cause?: unknown;
  }> {}

export class AppUniqueConstraintSetBuildIntegrationV1Error
  extends Data.TaggedError("AppUniqueConstraintSetBuildIntegrationV1Error")<{
    readonly phase: "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class AppUniqueConstraintSetBuildDecisionUncertainV1Error
  extends Data.TaggedError(
    "AppUniqueConstraintSetBuildDecisionUncertainV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly cause: unknown;
  }> {}

export type ReconcileAppUniqueConstraintSetBuildV1Error =
  | InvalidAppUniqueConstraintSetBuildInputV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

interface BuildSnapshot {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly definitionCount: number;
  readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
}

interface BuildState {
  readonly startCommitSeq: CommitSeq;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
  readonly storageGeneration: string;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: string;
}

export const reconcileAppUniqueConstraintSetBuildV1Effect = Effect.fn(
  "AppUniqueConstraintSetBuild.reconcile",
)(function* (
  ports: AppUniqueConstraintSetBuildPortsV1,
  input: unknown,
  options: AppUniqueConstraintSetBuildOptionsV1 = {},
): Effect.fn.Return<
  ReconcileAppUniqueConstraintSetBuildV1Result,
  ReconcileAppUniqueConstraintSetBuildV1Error
> {
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const locatedClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    ports.controlDb,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (locatedClosure === null) {
    return Object.freeze({
      status: "absent" as const,
      reason: "setNotClosed" as const,
      ...decoded,
    });
  }
  const snapshot = Object.freeze({
    ...decoded,
    definitionCount: locatedClosure.closure.definitionCount,
    definitionSetSha256Hex:
      locatedClosure.closure.definitionSetSha256Hex,
  } satisfies BuildSnapshot);
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
  );
  return yield* runReconciliationTransaction(
    located.target,
    located.authority,
    snapshot,
    options,
  );
});

function decodeInputResult(input: unknown) {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidInputShape",
      }));
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidDeploymentId",
      }));
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() =>
      new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidSchemaVersionId",
      })
    ));
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
    });
  });
}

const runReconciliationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  Extract<ReconcileAppUniqueConstraintSetBuildV1Result, { status: "reconciled" }>,
  Exclude<
    ReconcileAppUniqueConstraintSetBuildV1Error,
    | InvalidAppUniqueConstraintSetBuildInputV1Error
    | ReadAppUniqueConstraintSetClosureV1Error
    | TrustedScopeAuthorityError
  >
> {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set reconciliation rolled back.",
    (tx) => reconcileInTransaction(tx, authority, snapshot, options),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (failure._tag === "None") return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* observeUncertainCompletion(
      target,
      authority,
      snapshot,
      cause,
    );
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
});

const reconcileInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.reconcileInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("update"),
  );
  const existingRow = rows[0];
  if (existingRow === undefined) {
    const initialAttemptFence =
      AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(1n);
    const inserted = yield* queryEffect(
      tx.insert(fxSystemUniqueConstraintSetBuilds).values({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        setCodecVersion: APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
        definitionCount: snapshot.definitionCount,
        definitionSetSha256: appUniqueConstraintSetSha256HexV1ToBytes(
          snapshot.definitionSetSha256Hex,
        ),
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        startCommitSeq: clock.lastCommitSeq,
        lifecycle: "declared",
        cursorCodecVersion:
          APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
        cursorDefinitionId: null,
        cursorRowId: null,
        attemptFence: initialAttemptFence,
      }).returning(),
    );
    if (inserted.length !== 1) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "concurrentStateChange",
      ));
    }
    yield* runFault(options, "afterBuildInsert");
    return result(
      authority,
      snapshot,
      "created",
      clock.lastCommitSeq,
      initialAttemptFence,
    );
  }

  const existing = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    existingRow,
    clock.lastCommitSeq,
  );
  if (buildAuthorityIsCurrent(existing, clock)) {
    return result(
      authority,
      snapshot,
      "replayed",
      existing.startCommitSeq,
      existing.attemptFence,
    );
  }
  if (existing.attemptFence >= MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "attemptFenceExhausted",
    ));
  }
  const nextAttemptFence = AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(
    existing.attemptFence + 1n,
  );
  const updated = yield* queryEffect(
    tx.update(fxSystemUniqueConstraintSetBuilds).set({
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      startCommitSeq: clock.lastCommitSeq,
      lifecycle: "declared",
      cursorCodecVersion:
        APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
      cursorDefinitionId: null,
      cursorRowId: null,
      attemptFence: nextAttemptFence,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
      eq(
        fxSystemUniqueConstraintSetBuilds.storageGenerationFence,
        existing.storageGenerationFence,
      ),
      eq(fxSystemUniqueConstraintSetBuilds.epoch, existing.epoch),
      eq(fxSystemUniqueConstraintSetBuilds.attemptFence, existing.attemptFence),
    )).returning(),
  );
  if (updated.length !== 1) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "concurrentStateChange",
    ));
  }
  yield* runFault(options, "afterStaleBuildRedeclare");
  return result(
    authority,
    snapshot,
    "redeclared",
    clock.lastCommitSeq,
    nextAttemptFence,
  );
});

const observeUncertainCompletion = Effect.fn(
  "AppUniqueConstraintSetBuild.observeUncertainCompletion",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  transactionCause: unknown,
) {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set uncertainty observation rolled back.",
    (tx) => observeInTransaction(tx, authority, snapshot),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isFailure(settled)) {
    const failure = Cause.findErrorOption(settled.cause);
    if (failure._tag === "None") return yield* Effect.die(settled.cause);
    const cause = failure.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction",
          retryable: false,
          cause,
        })),
      ));
    }
    return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }));
  }
  const observed = settled.value;
  if (observed === null) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        cause: transactionCause,
      }),
    );
  }
  return result(
    authority,
    snapshot,
    "replayedAfterUncertainCompletion",
    observed.startCommitSeq,
    observed.attemptFence,
  );
});

const observeInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.observeInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1),
  );
  const row = rows[0];
  if (row === undefined) return null;
  const state = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    row,
    clock.lastCommitSeq,
  );
  return buildAuthorityIsCurrent(state, clock) ? state : null;
});

function decodeBuildStateEffect(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  row: typeof fxSystemUniqueConstraintSetBuilds.$inferSelect,
  currentLastCommitSeq: bigint,
) {
  return Effect.gen(function* () {
    const definitionSetMatches =
      row.definitionCount === snapshot.definitionCount &&
      isUint8Array(row.definitionSetSha256) &&
      bytesEqual(
        row.definitionSetSha256,
        appUniqueConstraintSetSha256HexV1ToBytes(
          snapshot.definitionSetSha256Hex,
        ),
      );
    const lifecycleAndCursorAreValid =
      isValidLifecycle(row.lifecycle) &&
      row.cursorCodecVersion ===
        APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1 &&
      isValidCursor(row.lifecycle, row.cursorDefinitionId, row.cursorRowId);
    const createdAt = copyFiniteDate(row.createdAt);
    const updatedAt = copyFiniteDate(row.updatedAt);
    if (
      row.scopeId !== authority.scopeId ||
      row.schemaVersionId !== snapshot.schemaVersionId ||
      row.setCodecVersion !== APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1 ||
      !definitionSetMatches ||
      row.storageGeneration !== "flarexdb_v1" ||
      row.storageGenerationFence < 1n ||
      !isNonBlankString(row.epoch) ||
      row.startCommitSeq < 0n ||
      !lifecycleAndCursorAreValid ||
      row.attemptFence < 1n ||
      createdAt === undefined ||
      updatedAt === undefined ||
      updatedAt.getTime() < createdAt.getTime()
    ) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        definitionSetMatches
          ? "storedStateInvalid"
          : "definitionSetMismatch",
      ));
    }
    if (row.startCommitSeq > currentLastCommitSeq) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "frontierAheadOfClock",
      ));
    }
    return Object.freeze({
      startCommitSeq: row.startCommitSeq,
      attemptFence: row.attemptFence,
      storageGeneration: row.storageGeneration,
      storageGenerationFence: row.storageGenerationFence,
      epoch: row.epoch,
    } satisfies BuildState);
  });
}

function isValidLifecycle(value: string): boolean {
  return value === "declared" ||
    value === "building" ||
    value === "backfilling" ||
    value === "validating" ||
    value === "enabled";
}

function isValidCursor(
  lifecycle: string,
  definitionId: number | null,
  rowId: Uint8Array | null,
): boolean {
  const definitionIsValid = definitionId === null ||
    (Number.isSafeInteger(definitionId) &&
      definitionId >= 1 && definitionId <= 2_147_483_647);
  const rowIsValid = rowId === null ||
    (isUint8Array(rowId) && rowId.byteLength === 16);
  if (!definitionIsValid || !rowIsValid) return false;
  if (definitionId === null && rowId !== null) return false;
  return lifecycle === "backfilling" || lifecycle === "validating"
    ? true
    : definitionId === null && rowId === null;
}

function requireExactAuthorityResult(
  expected: TrustedScopeAuthority,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
) {
  if (
    expected.storageGeneration !== "flarexdb_v1" ||
    current.storageGeneration !== expected.storageGeneration
  ) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGeneration",
    }));
  }
  if (current.storageGenerationFence !== expected.storageGenerationFence) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGenerationFence",
    }));
  }
  if (current.epoch !== expected.epoch) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "epoch",
    }));
  }
  return Result.succeed(undefined);
}

function buildAuthorityIsCurrent(
  state: BuildState,
  clock: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
): boolean {
  return state.storageGeneration === clock.storageGeneration &&
    state.storageGenerationFence === clock.storageGenerationFence &&
    state.epoch === clock.epoch;
}

function runFault(
  options: AppUniqueConstraintSetBuildOptionsV1,
  point: AppUniqueConstraintSetBuildFaultPointV1,
) {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.try({
      try: () => options.faultAfter?.(point),
      catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function queryEffect<Row>(query: PromiseLike<ReadonlyArray<Row>>) {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
}

interface StartedLocatedEffectTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/** The single audited Effect runtime bridge for this driver callback owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  rollbackMessage: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedLocatedEffectTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(rollbackMessage);
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
  });
}

const awaitTransactionExit = Effect.fn(
  "AppUniqueConstraintSetBuild.awaitTransactionExit",
)(function* <Value>(promise: Promise<Value>) {
  return yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: (cause) => cause,
  })));
});

function stateError(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  reason: AppUniqueConstraintSetBuildStateV1Error["reason"],
  cause?: unknown,
) {
  return new AppUniqueConstraintSetBuildStateV1Error({
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    reason,
    cause,
  });
}

function result(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  disposition: Extract<
    ReconcileAppUniqueConstraintSetBuildV1Result,
    { status: "reconciled" }
  >["disposition"],
  startCommitSeq: CommitSeq,
  attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1,
): Extract<
  ReconcileAppUniqueConstraintSetBuildV1Result,
  { status: "reconciled" }
> {
  return Object.freeze({
    status: "reconciled" as const,
    disposition,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    definitionCount: snapshot.definitionCount,
    definitionSetSha256Hex: snapshot.definitionSetSha256Hex,
    startCommitSeq,
    attemptFence,
  });
}
