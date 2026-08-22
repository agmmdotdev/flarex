import {
  InvalidTaskSystemRunReadRequestError,
  decodeTaskDueDiscoveryRequestV1,
  decodeTaskRequestedEffectPageRequestV1,
  type TaskDueDiscoveryCandidateV1,
  type TaskDueDiscoveryPageV1,
  type TaskDueDiscoveryRequestV1,
  type TaskRequestedEffectPageRequestV1,
  type TaskRequestedEffectPageV1,
} from "@flarex/durable-task/internal/run-read-v1";
import {
  decodeTaskDatabaseTimeMsV1,
  decodeTaskRequestedEffectSequenceV1,
  type ApplicationTaskRunAttemptAggregateV1,
  type PersistedTaskRunAttemptAggregate,
  type TaskRunAttemptAggregateV1,
  type TaskRunIdV1,
  type TaskRequestedEffectPersistenceCursorV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import { Brand, Cause, Data, Effect, Exit, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import {
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
  type TaskSystemScopeAuthorityMismatchV1,
} from "./taskSystemScopeAuthorityV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";
import {
  decodeAndCorrelateTaskSystemRequestedEffectRowV1,
} from "./taskSystemRequestedEffectRowV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const MAX_TRANSACTION_EXECUTIONS = 3;
const requestedEffectCursor =
  Brand.nominal<TaskRequestedEffectPersistenceCursorV1>();

export type TaskSystemRunReadOperationV1 =
  | "discover_due_runs"
  | "read_requested_effects";

export class TaskSystemRunReadUnavailableError extends Data.TaggedError(
  "TaskSystemRunReadUnavailableError",
)<{
  readonly operation: "read_requested_effects";
  readonly runId: TaskRunIdV1;
  readonly reason: "unavailable";
}> {}

export class TaskSystemRunReadCorruptionError<
  Operation extends TaskSystemRunReadOperationV1 = TaskSystemRunReadOperationV1,
> extends Data.TaggedError(
  "TaskSystemRunReadCorruptionError",
)<{
  readonly operation: Operation;
  readonly runId: Operation extends "discover_due_runs"
    ? TaskRunIdV1 | null
    : TaskRunIdV1;
  readonly reason: Operation extends "discover_due_runs"
    ? "database_clock_invalid" | "run_row_invalid"
    : "run_row_invalid" | "effect_sequence_invalid";
}> {}

export class TaskSystemRunReadStaleScopeAuthorityError<
  Operation extends TaskSystemRunReadOperationV1 = TaskSystemRunReadOperationV1,
> extends Data.TaggedError(
  "TaskSystemRunReadStaleScopeAuthorityError",
)<{
  readonly operation: Operation;
  readonly authority: TaskSystemScopeAuthorityMismatchV1;
}> {}

export class TaskSystemRunReadTransientStoreError<
  Operation extends TaskSystemRunReadOperationV1 = TaskSystemRunReadOperationV1,
> extends Data.TaggedError(
  "TaskSystemRunReadTransientStoreError",
)<{
  readonly operation: Operation;
  readonly reason:
    | "transaction_conflict"
    | "connection_unavailable"
    | "timeout"
    | "driver_failure";
  readonly cause: unknown;
}> {}

export class TaskSystemRunReadTerminalStoreError<
  Operation extends TaskSystemRunReadOperationV1 = TaskSystemRunReadOperationV1,
> extends Data.TaggedError(
  "TaskSystemRunReadTerminalStoreError",
)<{
  readonly operation: Operation;
  readonly reason: "unsupported_integration";
  readonly cause: unknown;
}> {}

export type TaskSystemDueDiscoveryErrorV1 =
  | InvalidTaskSystemRunReadRequestError<"decode_due_discovery_request">
  | TaskSystemRunReadCorruptionError<"discover_due_runs">
  | TaskSystemRunReadStaleScopeAuthorityError<"discover_due_runs">
  | TaskSystemRunReadTransientStoreError<"discover_due_runs">
  | TaskSystemRunReadTerminalStoreError<"discover_due_runs">;

export type TaskSystemRequestedEffectReadErrorV1 =
  | InvalidTaskSystemRunReadRequestError<
      "decode_requested_effect_page_request"
    >
  | TaskSystemRunReadUnavailableError
  | TaskSystemRunReadCorruptionError<"read_requested_effects">
  | TaskSystemRunReadStaleScopeAuthorityError<"read_requested_effects">
  | TaskSystemRunReadTransientStoreError<"read_requested_effects">
  | TaskSystemRunReadTerminalStoreError<"read_requested_effects">;

export type TaskSystemRunReadErrorV1 =
  | TaskSystemDueDiscoveryErrorV1
  | TaskSystemRequestedEffectReadErrorV1;

export type TaskSystemRunReadQueryNameV1 =
  | "discoverDueRuns"
  | "requestedEffects";

export type TaskSystemRunReadQueryObserverV1 = (observation: Readonly<{
  readonly name: TaskSystemRunReadQueryNameV1;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}>) => void;

export interface TaskSystemRunReadOptionsV1 {
  readonly observeQuery?: TaskSystemRunReadQueryObserverV1;
}

export interface TaskSystemDueDiscoveryShapeV1 {
  readonly discoverDueRuns: (
    request: unknown,
  ) => Effect.Effect<TaskDueDiscoveryPageV1, TaskSystemDueDiscoveryErrorV1>;
}

export interface TaskSystemRequestedEffectLedgerShapeV1 {
  readonly readRequestedEffects: (
    request: unknown,
  ) => Effect.Effect<
    TaskRequestedEffectPageV1,
    TaskSystemRequestedEffectReadErrorV1
  >;
}

/** Constructs a read-only, scope-bound due-discovery capability. */
export function makeTaskSystemDueDiscoveryV1(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: TaskSystemRunReadOptionsV1 = {},
): TaskSystemDueDiscoveryShapeV1 {
  return makeGenerationDueDiscoveryV1(
    "legacy_definition_v1",
    located,
    options,
  );
}

/** Constructs the Application-generation scope-bound due source. */
export function makeApplicationTaskSystemDueDiscoveryV1(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: TaskSystemRunReadOptionsV1 = {},
): TaskSystemDueDiscoveryShapeV1 {
  return makeGenerationDueDiscoveryV1("application_v1", located, options);
}

function makeGenerationDueDiscoveryV1(
  generation: PersistedTaskRunAttemptAggregate["generation"],
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: TaskSystemRunReadOptionsV1,
): TaskSystemDueDiscoveryShapeV1 {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const observer = options.observeQuery;
  return Object.freeze({
    discoverDueRuns: (request: unknown) => discoverDueRuns(
      authority,
      target,
      generation,
      observer,
      request,
    ),
  });
}

/** Constructs a read-only, scope-bound requested-effect ledger capability. */
export function makeTaskSystemRequestedEffectLedgerV1(
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
  options: TaskSystemRunReadOptionsV1 = {},
): TaskSystemRequestedEffectLedgerShapeV1 {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const observer = options.observeQuery;
  return Object.freeze({
    readRequestedEffects: (request: unknown) =>
      readRequestedEffects(
        authority,
        target,
        observer,
        request,
      ),
  });
}

const discoverDueRuns = Effect.fn("TaskSystemRunRead.discoverDueRuns")(
  function* (
    authority: TrustedScopeAuthority,
    target: LocatedReadCommittedAttemptTargetV1,
    generation: PersistedTaskRunAttemptAggregate["generation"],
    observer: TaskSystemRunReadQueryObserverV1 | undefined,
    rawRequest: unknown,
  ): Effect.fn.Return<TaskDueDiscoveryPageV1, TaskSystemDueDiscoveryErrorV1> {
    const request = yield* Effect.fromResult(
      decodeTaskDueDiscoveryRequestV1(rawRequest),
    );
    return yield* runReadTransaction(
      target,
      tx => discoverDueRunsOnce(
        tx,
        authority,
        target,
        generation,
        observer,
        request,
      ),
      DUE_DISCOVERY_FAILURE_POLICY,
    );
  },
);

const readRequestedEffects = Effect.fn(
  "TaskSystemRunRead.readRequestedEffects",
)(function* (
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  observer: TaskSystemRunReadQueryObserverV1 | undefined,
  rawRequest: unknown,
): Effect.fn.Return<
  TaskRequestedEffectPageV1,
  TaskSystemRequestedEffectReadErrorV1
> {
  const request = yield* Effect.fromResult(
    decodeTaskRequestedEffectPageRequestV1(rawRequest),
  );
  return yield* runReadTransaction(
    target,
    tx => readRequestedEffectsOnce(tx, authority, target, observer, request),
    REQUESTED_EFFECT_FAILURE_POLICY,
  );
});

async function discoverDueRunsOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  generation: PersistedTaskRunAttemptAggregate["generation"],
  observer: TaskSystemRunReadQueryObserverV1 | undefined,
  request: TaskDueDiscoveryRequestV1,
): Promise<TaskDueDiscoveryPageV1> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => readRollback(stale("discover_due_runs", mismatch)),
  );
  const throughMs = request.cursor?.throughMs
    ?? await readDiscoveryDatabaseNow(tx, authority);
  const cursorPredicate = request.cursor === null
    ? undefined
    : or(
        gt(
          fxSystemDurableTaskRunsV1.dueAtMs,
          BigInt(request.cursor.dueAtMs),
        ),
        and(
          eq(
            fxSystemDurableTaskRunsV1.dueAtMs,
            BigInt(request.cursor.dueAtMs),
          ),
          gt(fxSystemDurableTaskRunsV1.runId, request.cursor.runId),
        ),
      );
  const query = tx.select().from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.definitionGeneration, generation),
    eq(fxSystemDurableTaskRunsV1.dueKind, request.dueKind),
    lte(fxSystemDurableTaskRunsV1.dueAtMs, BigInt(throughMs)),
    cursorPredicate,
  )).orderBy(
    asc(fxSystemDurableTaskRunsV1.dueAtMs),
    asc(fxSystemDurableTaskRunsV1.runId),
  ).limit(request.pageSize + 1);
  observeDrizzleQuery("discoverDueRuns", query, observer);
  const rows = await query;
  const decoded = rows.map(row => {
    const decodedRow = Result.getOrThrowWith(
      decodeAndCorrelateTaskSystemRunRowV1(row),
      () => readRollback(corruption(
      "discover_due_runs",
      row.runId,
      "run_row_invalid",
      )),
    );
    if (decodedRow.generation !== generation) {
      throw readRollback(corruption(
        "discover_due_runs",
        row.runId,
        "run_row_invalid",
      ));
    }
    return decodedRow.aggregate;
  });
  const pageRows = rows.slice(0, request.pageSize);
  const candidates = decoded.slice(0, request.pageSize).map(
    aggregate => dueCandidate(request.dueKind, aggregate),
  );
  const last = pageRows.at(-1);
  const nextCursor = rows.length > request.pageSize && last !== undefined
    ? Object.freeze({
        version: 1 as const,
        dueKind: request.dueKind,
        throughMs,
        dueAtMs: Result.getOrThrowWith(
          decodeTaskDatabaseTimeMsV1(Number(last.dueAtMs)),
          () => readRollback(corruption(
            "discover_due_runs",
            last.runId,
            "run_row_invalid",
          )),
        ),
        runId: last.runId,
      })
    : null;
  return Object.freeze({
    version: 1,
    dueKind: request.dueKind,
    throughMs,
    candidates: Object.freeze(candidates),
    nextCursor,
  });
}

async function readRequestedEffectsOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedReadCommittedAttemptTargetV1,
  observer: TaskSystemRunReadQueryObserverV1 | undefined,
  request: TaskRequestedEffectPageRequestV1,
): Promise<TaskRequestedEffectPageV1> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => readRollback(stale("read_requested_effects", mismatch)),
  );
  const runRows = await tx.select().from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, request.runId),
  )).limit(1).for("share");
  const runRow = runRows[0];
  if (runRow === undefined) {
    throw readRollback(new TaskSystemRunReadUnavailableError({
      operation: "read_requested_effects",
      runId: request.runId,
      reason: "unavailable",
    }));
  }
  const decodedRun = Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRunRowV1(runRow),
    () => readRollback(corruption(
      "read_requested_effects",
      request.runId,
      "run_row_invalid",
    )),
  );
  if (decodedRun.generation !== "legacy_definition_v1") {
    throw readRollback(corruption(
      "read_requested_effects",
      request.runId,
      "run_row_invalid",
    ));
  }
  const throughSequence = request.cursor?.throughSequence
    ?? runRow.requestedEffectSequence;
  const afterSequence = request.cursor?.afterSequence ?? 0n;
  if (throughSequence > runRow.requestedEffectSequence) {
    throw readRollback(new InvalidTaskSystemRunReadRequestError<
      "decode_requested_effect_page_request"
    >({
      operation: "decode_requested_effect_page_request",
      issue: "invalid_cursor",
    }));
  }
  if (throughSequence === 0n) {
    return Object.freeze({
      version: 1,
      runId: request.runId,
      throughSequence,
      effects: Object.freeze([]),
      nextCursor: null,
    });
  }
  const throughEffectSequence = Result.getOrThrowWith(
    decodeTaskRequestedEffectSequenceV1(String(throughSequence)),
    () => readRollback(new InvalidTaskSystemRunReadRequestError<
      "decode_requested_effect_page_request"
    >({
      operation: "decode_requested_effect_page_request",
      issue: "invalid_cursor",
    })),
  );
  const afterEffectSequence = afterSequence === 0n
    ? undefined
    : Result.getOrThrowWith(
        decodeTaskRequestedEffectSequenceV1(String(afterSequence)),
        () => readRollback(new InvalidTaskSystemRunReadRequestError<
          "decode_requested_effect_page_request"
        >({
          operation: "decode_requested_effect_page_request",
          issue: "invalid_cursor",
        })),
      );
  const query = tx.select().from(
    fxSystemDurableTaskRequestedEffectsV1,
  ).where(and(
    eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, authority.scopeId),
    eq(fxSystemDurableTaskRequestedEffectsV1.runId, request.runId),
    afterEffectSequence === undefined
      ? undefined
      : gt(
          fxSystemDurableTaskRequestedEffectsV1.sequence,
          afterEffectSequence,
        ),
    lte(
      fxSystemDurableTaskRequestedEffectsV1.sequence,
      throughEffectSequence,
    ),
  )).orderBy(
    asc(fxSystemDurableTaskRequestedEffectsV1.sequence),
  ).limit(request.pageSize + 1);
  observeDrizzleQuery("requestedEffects", query, observer);
  const rows = await query;
  const effects = rows.map(row => Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRequestedEffectRowV1(row),
    () => readRollback(corruption(
      "read_requested_effects",
      request.runId,
      "effect_sequence_invalid",
    )),
  ));
  let expectedSequence = afterSequence + 1n;
  for (const effect of effects) {
    if (effect.sequence !== expectedSequence) {
      throw readRollback(corruption(
        "read_requested_effects",
        request.runId,
        "effect_sequence_invalid",
      ));
    }
    expectedSequence += 1n;
  }
  const pageEffects = effects.slice(0, request.pageSize);
  const last = pageEffects.at(-1);
  const hasNext = rows.length > request.pageSize;
  if (!hasNext && (last?.sequence ?? afterSequence) !== throughSequence) {
    throw readRollback(corruption(
      "read_requested_effects",
      request.runId,
      "effect_sequence_invalid",
    ));
  }
  const nextCursor = hasNext && last !== undefined
    ? Object.freeze({
        version: 1 as const,
        runId: request.runId,
        throughSequence,
        afterSequence: requestedEffectCursor(last.sequence),
      })
    : null;
  return Object.freeze({
    version: 1,
    runId: request.runId,
    throughSequence,
    effects: Object.freeze(pageEffects),
    nextCursor,
  });
}

function dueCandidate(
  dueKind: TaskDueDiscoveryRequestV1["dueKind"],
  aggregate: TaskRunAttemptAggregateV1 | ApplicationTaskRunAttemptAggregateV1,
): TaskDueDiscoveryCandidateV1 {
  if (dueKind === "start_attempt") {
    if (aggregate.phase !== "ready" && aggregate.phase !== "retry_waiting") {
      throw readRollback(corruption(
        "discover_due_runs",
        aggregate.runId,
        "run_row_invalid",
      ));
    }
    const dueAtMs = aggregate.phase === "ready"
      ? aggregate.ready.eligibleAtMs
      : aggregate.retry.notBeforeMs;
    return Object.freeze({
      kind: "start_attempt",
      dueAtMs,
      runId: aggregate.runId,
      expectedRunVersion: aggregate.runVersion,
    });
  }
  if (aggregate.phase !== "attempt_granted" && aggregate.phase !== "executing") {
    throw readRollback(corruption(
      "discover_due_runs",
      aggregate.runId,
      "run_row_invalid",
    ));
  }
  return Object.freeze({
    kind: "handle_lease_expiry",
    dueAtMs: aggregate.currentAttempt.lease.expiresAtMs,
    runId: aggregate.runId,
    attemptId: aggregate.currentAttempt.attemptId,
    executionFence: aggregate.currentAttempt.executionFence,
    expectedLeaseVersion: aggregate.currentAttempt.lease.version,
  });
}

async function readDiscoveryDatabaseNow(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
) {
  const rows = await tx.select({
    milliseconds: sql<string>`
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
    `,
  }).from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, authority.scopeId),
  ).limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^(0|[1-9][0-9]*)$/.test(text)) {
    throw readRollback(corruption(
      "discover_due_runs",
      null,
      "database_clock_invalid",
    ));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(text)),
    () => readRollback(corruption(
      "discover_due_runs",
      null,
      "database_clock_invalid",
    )),
  );
}

const runReadTransaction = Effect.fn("TaskSystemRunRead.transaction")(
  function* <
    Value,
    Operation extends TaskSystemRunReadOperationV1,
    CallbackFailure extends TaskSystemRunReadErrorV1,
  >(
    target: LocatedReadCommittedAttemptTargetV1,
    work: (tx: AppRowTransaction) => Promise<Value>,
    policy: ReadTransactionFailurePolicy<Operation, CallbackFailure>,
  ): Effect.fn.Return<
    Value,
    | CallbackFailure
    | TaskSystemRunReadTransientStoreError<Operation>
    | TaskSystemRunReadTerminalStoreError<Operation>
  > {
    for (
      let execution = 1;
      execution <= MAX_TRANSACTION_EXECUTIONS;
      execution += 1
    ) {
      const settled = yield* Effect.exit(awaitLocatedTransaction(
        target[RUN_LOCATED_READ_COMMITTED_V1](work),
      ));
      if (Exit.isSuccess(settled)) return settled.value;
      const failure = yield* Cause.findError(settled.cause).pipe(
        Result.match({
          onFailure: cause => Effect.failCause(cause),
          onSuccess: Effect.succeed,
        }),
      );
      const classified = classifyTransactionFailure(
        policy,
        failure,
        execution,
      );
      if (classified.kind === "retry") continue;
      if (classified.kind === "fail") {
        return yield* Effect.fail(classified.error);
      }
      if (classified.kind === "cleanup") {
        return yield* Effect.failCause(Cause.combine(
          Cause.fail(classified.callback),
          Cause.die(classified.cause),
        ));
      }
      return yield* Effect.die(classified.cause);
    }
    return yield* Effect.fail(policy.transient("transaction_conflict", null));
  },
);

function awaitLocatedTransaction<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class ReadRollback {
  readonly kind = "task-system-read";
  constructor(readonly error: TaskSystemRunReadErrorV1) {}
}

function readRollback(error: TaskSystemRunReadErrorV1): ReadRollback {
  return new ReadRollback(error);
}

interface ReadTransactionFailurePolicy<
  Operation extends TaskSystemRunReadOperationV1,
  CallbackFailure extends TaskSystemRunReadErrorV1,
> {
  readonly operation: Operation;
  readonly accepts: (
    error: TaskSystemRunReadErrorV1,
  ) => error is CallbackFailure;
  readonly transient: (
    reason: TaskSystemRunReadTransientStoreError["reason"],
    cause: unknown,
  ) => TaskSystemRunReadTransientStoreError<Operation>;
  readonly terminal: (
    cause: unknown,
  ) => TaskSystemRunReadTerminalStoreError<Operation>;
}

type DueDiscoveryCallbackFailureV1 =
  | TaskSystemRunReadCorruptionError<"discover_due_runs">
  | TaskSystemRunReadStaleScopeAuthorityError<"discover_due_runs">;

type RequestedEffectCallbackFailureV1 =
  | InvalidTaskSystemRunReadRequestError<
      "decode_requested_effect_page_request"
    >
  | TaskSystemRunReadUnavailableError
  | TaskSystemRunReadCorruptionError<"read_requested_effects">
  | TaskSystemRunReadStaleScopeAuthorityError<"read_requested_effects">;

const DUE_DISCOVERY_FAILURE_POLICY = Object.freeze({
  operation: "discover_due_runs",
  accepts: isDueDiscoveryCallbackFailure,
  transient: (
    reason: TaskSystemRunReadTransientStoreError["reason"],
    cause: unknown,
  ): TaskSystemRunReadTransientStoreError<"discover_due_runs"> =>
    new TaskSystemRunReadTransientStoreError<"discover_due_runs">({
      operation: "discover_due_runs",
      reason,
      cause,
    }),
  terminal: (
    cause: unknown,
  ): TaskSystemRunReadTerminalStoreError<"discover_due_runs"> =>
    new TaskSystemRunReadTerminalStoreError<"discover_due_runs">({
      operation: "discover_due_runs",
      reason: "unsupported_integration",
      cause,
    }),
} satisfies ReadTransactionFailurePolicy<
  "discover_due_runs",
  DueDiscoveryCallbackFailureV1
>);

const REQUESTED_EFFECT_FAILURE_POLICY = Object.freeze({
  operation: "read_requested_effects",
  accepts: isRequestedEffectCallbackFailure,
  transient: (
    reason: TaskSystemRunReadTransientStoreError["reason"],
    cause: unknown,
  ): TaskSystemRunReadTransientStoreError<"read_requested_effects"> =>
    new TaskSystemRunReadTransientStoreError<"read_requested_effects">({
      operation: "read_requested_effects",
      reason,
      cause,
    }),
  terminal: (
    cause: unknown,
  ): TaskSystemRunReadTerminalStoreError<"read_requested_effects"> =>
    new TaskSystemRunReadTerminalStoreError<"read_requested_effects">({
      operation: "read_requested_effects",
      reason: "unsupported_integration",
      cause,
    }),
} satisfies ReadTransactionFailurePolicy<
  "read_requested_effects",
  RequestedEffectCallbackFailureV1
>);

type ClassifiedTransactionFailure<Failure> =
  | Readonly<{ readonly kind: "retry" }>
  | Readonly<{ readonly kind: "fail"; readonly error: Failure }>
  | Readonly<{
      readonly kind: "cleanup";
      readonly callback: Failure;
      readonly cause: LocatedReadCommittedTransactionFailureV1;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure<
  Operation extends TaskSystemRunReadOperationV1,
  CallbackFailure extends TaskSystemRunReadErrorV1,
>(
  policy: ReadTransactionFailurePolicy<Operation, CallbackFailure>,
  cause: unknown,
  execution: number,
): ClassifiedTransactionFailure<
  | CallbackFailure
  | TaskSystemRunReadTransientStoreError<Operation>
  | TaskSystemRunReadTerminalStoreError<Operation>
> {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack": {
      const expected = cause.issue.callbackCause instanceof ReadRollback
        ? cause.issue.callbackCause.error
        : null;
      if (expected !== null && policy.accepts(expected)) {
        return Object.freeze({ kind: "fail", error: expected });
      }
      if (isRetryableSqlConflict(cause.issue.callbackCause)) {
        return retryOrConflict(policy, cause, execution);
      }
      const known = knownSqlFailure(policy, cause.issue.callbackCause, cause);
      return known === null
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "fail", error: known });
    }
    case "decisionUncertain":
      return execution < MAX_TRANSACTION_EXECUTIONS
        ? Object.freeze({ kind: "retry" })
        : Object.freeze({
            kind: "fail",
            error: policy.transient("driver_failure", cause),
          });
    case "infrastructureFailure": {
      const known = knownSqlFailure(policy, cause.issue.cause, cause);
      if (known !== null) return Object.freeze({ kind: "fail", error: known });
      return cause.issue.phase === "beginOrConfigure"
        ? Object.freeze({
            kind: "fail",
            error: policy.terminal(cause),
          })
        : Object.freeze({ kind: "defect", cause });
    }
    case "callbackCleanupFailed": {
      const callback = cause.issue.callbackCause instanceof ReadRollback
        ? cause.issue.callbackCause.error
        : null;
      return callback === null || !policy.accepts(callback)
        ? Object.freeze({ kind: "defect", cause })
        : Object.freeze({ kind: "cleanup", callback, cause });
    }
  }
}

function retryOrConflict<
  Operation extends TaskSystemRunReadOperationV1,
  CallbackFailure extends TaskSystemRunReadErrorV1,
>(
  policy: ReadTransactionFailurePolicy<Operation, CallbackFailure>,
  cause: unknown,
  execution: number,
): ClassifiedTransactionFailure<
  TaskSystemRunReadTransientStoreError<Operation>
> {
  return execution < MAX_TRANSACTION_EXECUTIONS
    ? Object.freeze({ kind: "retry" })
    : Object.freeze({
        kind: "fail",
        error: policy.transient("transaction_conflict", cause),
      });
}

function knownSqlFailure<
  Operation extends TaskSystemRunReadOperationV1,
  CallbackFailure extends TaskSystemRunReadErrorV1,
>(
  policy: ReadTransactionFailurePolicy<Operation, CallbackFailure>,
  sqlCause: unknown,
  retainedCause: unknown,
): TaskSystemRunReadTransientStoreError<Operation> | null {
  const code = sqlState(sqlCause);
  if (code?.startsWith("08") !== true && code !== "57014") return null;
  return policy.transient(
    code.startsWith("08") ? "connection_unavailable" : "timeout",
    retainedCause,
  );
}

function isRetryableSqlConflict(cause: unknown): boolean {
  const code = sqlState(cause);
  return code === "40001" || code === "40P01";
}

function sqlState(cause: unknown): string | undefined {
  let current = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

function isDueDiscoveryCallbackFailure(
  error: TaskSystemRunReadErrorV1,
): error is DueDiscoveryCallbackFailureV1 {
  return (
    error instanceof TaskSystemRunReadCorruptionError
    || error instanceof TaskSystemRunReadStaleScopeAuthorityError
  ) && error.operation === "discover_due_runs";
}

function isRequestedEffectCallbackFailure(
  error: TaskSystemRunReadErrorV1,
): error is RequestedEffectCallbackFailureV1 {
  return error instanceof InvalidTaskSystemRunReadRequestError
    ? error.operation === "decode_requested_effect_page_request"
    : error instanceof TaskSystemRunReadUnavailableError
      || (
        (
          error instanceof TaskSystemRunReadCorruptionError
          || error instanceof TaskSystemRunReadStaleScopeAuthorityError
        ) && error.operation === "read_requested_effects"
      );
}

function stale<Operation extends TaskSystemRunReadOperationV1>(
  operation: Operation,
  authority: TaskSystemScopeAuthorityMismatchV1,
): TaskSystemRunReadStaleScopeAuthorityError<Operation> {
  return new TaskSystemRunReadStaleScopeAuthorityError<Operation>({
    operation,
    authority,
  });
}

function corruption(
  operation: "discover_due_runs",
  runId: TaskRunIdV1 | null,
  reason: "database_clock_invalid" | "run_row_invalid",
): TaskSystemRunReadCorruptionError<"discover_due_runs">;
function corruption(
  operation: "read_requested_effects",
  runId: TaskRunIdV1,
  reason: "run_row_invalid" | "effect_sequence_invalid",
): TaskSystemRunReadCorruptionError<"read_requested_effects">;
function corruption(
  operation: TaskSystemRunReadOperationV1,
  runId: TaskRunIdV1 | null,
  reason: TaskSystemRunReadCorruptionError["reason"],
): TaskSystemRunReadCorruptionError {
  return new TaskSystemRunReadCorruptionError({ operation, runId, reason });
}
