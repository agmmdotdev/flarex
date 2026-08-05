import {
  InvalidRunAttemptTransitionError,
  StaleTaskRunVersionError,
  TaskRunAttemptCounterExhaustedError,
  TaskSystemRunAttemptCorruptionError,
  TaskSystemRunAttemptStaleScopeAuthorityError,
  TaskSystemRunAttemptStore,
  TaskSystemRunAttemptTerminalStoreError,
  TaskSystemRunAttemptTransientStoreError,
  TaskSystemRunAttemptUnavailableError,
  decodePersistedTaskRequestedEffectJsonV1,
  decodePersistedTaskRunAttemptAggregateJsonV1,
  decodeTaskAttemptIdV1,
  decodeTaskAttemptNumberV1,
  decodeTaskDatabaseTimeMsV1,
  decodeTaskExecutionFenceV1,
  encodePersistedTaskRequestedEffectJsonV1,
  encodePersistedTaskRunAttemptAggregateJsonV1,
  projectTaskRunAttemptPersistenceV1,
  type PersistedTaskRequestedEffectV1,
  type RunAttemptDecisionErrorV1,
  type RunAttemptOperationV1,
  type TaskAttemptIdV1,
  type TaskAttemptGrantCandidateV1,
  type TaskAttemptNumberV1,
  type TaskDatabaseTimeMsV1,
  type TaskExecutionFenceV1,
  type TaskRunAttemptAggregateV1,
  type TaskRunAttemptDecisionV1,
  type TaskRunIdV1,
  type TaskSystemRunAttemptInspectionSnapshotV1,
  type TaskSystemRunAttemptStoreErrorV1,
  type TaskSystemRunAttemptStoreShape,
  type TaskSystemRunAttemptTransactionReceiptV1,
  type TaskSystemRunAttemptTransactionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  getScopeClock,
} from "./scopeClock";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "./schema";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import {
  captureTaskSystemTrustedScopeAuthorityV1,
  requireLockedTaskSystemScopeAuthorityV1,
} from "./taskSystemScopeAuthorityV1";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const TASK_RUN_ATTEMPT_TARGET_DB: unique symbol = Symbol(
  "FlarexDB/taskSystemRunAttemptTargetDbV1",
);
const READ_TASK_SYSTEM_DATABASE_NOW_V1: unique symbol = Symbol(
  "FlarexDB/readTaskSystemDatabaseNowV1",
);
const UTF8 = new TextEncoder();
const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_TRANSACTION_EXECUTIONS = 3;
const ATTEMPT_IDENTITY_PRIMARY_KEY = "fx_task_attempt_identity_v1_pk";

type TaskRunRow = typeof fxSystemDurableTaskRunsV1.$inferSelect;
type TaskAttemptIdentityRow =
  typeof fxSystemDurableTaskAttemptIdentitiesV1.$inferSelect;
type TaskRequestedEffectRow =
  typeof fxSystemDurableTaskRequestedEffectsV1.$inferSelect;

export type ReadTaskSystemDatabaseNowV1 = (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
) => Promise<TaskDatabaseTimeMsV1>;

interface ExpectedAttemptIdentityV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly acceptedRunVersion: bigint | null;
}

export interface LocatedTaskSystemRunAttemptTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [TASK_RUN_ATTEMPT_TARGET_DB]: FlarexMetadataDatabase;
  readonly [READ_TASK_SYSTEM_DATABASE_NOW_V1]: ReadTaskSystemDatabaseNowV1;
}

export interface TaskSystemRunAttemptStoreOptionsV1 {
  readonly randomUuid?: () => string;
}

export function createLocatedTaskSystemRunAttemptTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
  readDatabaseNow: ReadTaskSystemDatabaseNowV1 = readTaskSystemDatabaseNowV1,
): LocatedTaskSystemRunAttemptTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [TASK_RUN_ATTEMPT_TARGET_DB]: db,
    [READ_TASK_SYSTEM_DATABASE_NOW_V1]: readDatabaseNow,
  });
}

/**
 * Constructs one operation-scoped store over an already-resolved located
 * authority. The returned capability cannot select or escape its tenant scope.
 */
export function makeTaskSystemRunAttemptStoreV1(
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
  options: TaskSystemRunAttemptStoreOptionsV1 = {},
): TaskSystemRunAttemptStoreShape {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(located.authority);
  const target = located.target;
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  return TaskSystemRunAttemptStore.of({
    transactRunAttempt: <Outcome>(
      request: TaskSystemRunAttemptTransactionV1<Outcome>,
    ) => transactRunAttempt(authority, target, randomUuid, request),
    inspectRunAttempt: (request) => inspectRunAttempt(
      authority,
      target,
      request.operation,
      request.runId,
    ),
  });
}

const transactRunAttempt = Effect.fn(
  "TaskSystemRunAttemptStore.transactRunAttempt",
)(function* <Outcome>(
  authority: TrustedScopeAuthority,
  target: LocatedTaskSystemRunAttemptTargetV1,
  randomUuid: () => string,
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
): Effect.fn.Return<
  TaskSystemRunAttemptTransactionReceiptV1<Outcome>,
  RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1
> {
  for (let execution = 1; execution <= MAX_TRANSACTION_EXECUTIONS; execution += 1) {
    const settled = yield* Effect.exit(awaitLocatedTransaction(
      target[RUN_LOCATED_READ_COMMITTED_V1](tx => transactOnce(
        tx,
        authority,
        target,
        randomUuid,
        request,
      )),
    ));
    if (Exit.isSuccess(settled)) {
      return yield* Effect.fromResult(snapshotReceipt(settled.value, request));
    }

    const failure = Cause.findError(settled.cause);
    if (Result.isFailure(failure)) {
      return yield* Effect.failCause(failure.failure);
    }
    const classified = classifyTransactionFailure(
      request.operation,
      request.runId,
      failure.success,
      execution,
    );
    if (classified.kind === "retry") continue;
    if (classified.kind === "fail") return yield* classified.error;
    if (classified.kind === "cleanup") {
      return yield* Effect.failCause(Cause.combine(
        Cause.fail(classified.callback),
        Cause.die(classified.cause),
      ));
    }
    return yield* Effect.die(classified.cause);
  }
  return yield* new TaskSystemRunAttemptTransientStoreError({
    operation: request.operation,
    runId: request.runId,
    reason: "transaction_conflict",
    cause: null,
  });
});

const inspectRunAttempt = Effect.fn(
  "TaskSystemRunAttemptStore.inspectRunAttempt",
)(function* (
  authority: TrustedScopeAuthority,
  target: LocatedTaskSystemRunAttemptTargetV1,
  operation: "inspect_current_attempt",
  runId: TaskRunIdV1,
): Effect.fn.Return<
  TaskSystemRunAttemptInspectionSnapshotV1,
  TaskSystemRunAttemptStoreErrorV1
> {
  const settled = yield* Effect.exit(awaitLocatedTransaction(
    target[RUN_LOCATED_READ_COMMITTED_V1](tx => inspectOnce(
      tx,
      authority,
      target,
      operation,
      runId,
    )),
  ));
  if (Exit.isSuccess(settled)) {
    return yield* Effect.fromResult(
      snapshotInspection(settled.value, operation, runId),
    );
  }
  const failure = Cause.findError(settled.cause);
  if (Result.isFailure(failure)) {
    return yield* Effect.failCause(failure.failure);
  }
  const classified = classifyTransactionFailure(
    operation,
    runId,
    failure.success,
    MAX_TRANSACTION_EXECUTIONS,
  );
  if (classified.kind === "fail") {
    return isStoreError(classified.error)
      ? yield* classified.error
      : yield* Effect.die(classified.error);
  }
  if (classified.kind === "retry") {
    return yield* new TaskSystemRunAttemptTransientStoreError({
      operation,
      runId,
      reason: "transaction_conflict",
      cause: failure.success,
    });
  }
  if (classified.kind === "cleanup") {
    return isStoreError(classified.callback)
      ? yield* Effect.failCause(Cause.combine(
          Cause.fail(classified.callback),
          Cause.die(classified.cause),
        ))
      : yield* Effect.die(classified.cause);
  }
  return yield* Effect.die(classified.cause);
});

async function transactOnce<Outcome>(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedTaskSystemRunAttemptTargetV1,
  randomUuid: () => string,
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
): Promise<TaskSystemRunAttemptTransactionReceiptV1<Outcome>> {
  await requireLockedScopeAuthority(tx, authority, target, request.operation, request.runId);
  const row = await loadRun(tx, authority.scopeId, request.runId, true);
  if (row === null) throw rollbackStoreError(new TaskSystemRunAttemptUnavailableError({
    operation: request.operation,
    runId: request.runId,
    reason: "unavailable",
  }));
  const databaseNowMs = await target[READ_TASK_SYSTEM_DATABASE_NOW_V1](
    tx,
    authority.scopeId,
    request.operation,
    request.runId,
  );
  const current = decodeAndCorrelateRunRow(row, request.operation, request.runId);
  await correlateLifecycleLedger(
    tx,
    authority.scopeId,
    request.operation,
    request.runId,
    current,
  );
  let allocatedCandidate: TaskAttemptGrantCandidateV1 | null | undefined;
  const decisionInput = {
    databaseNowMs,
    current,
    get attemptGrantCandidate(): TaskAttemptGrantCandidateV1 | null {
      if (request.operation !== "start_attempt") return null;
      if (allocatedCandidate === undefined) {
        allocatedCandidate = allocateAttemptCandidate(
          current,
          randomUuid,
          request.operation,
          request.runId,
        );
      }
      return allocatedCandidate;
    },
  };
  const decision = Result.getOrThrowWith(
    request.decide(Object.freeze(decisionInput)),
    rollbackDecisionError,
  );
  return applyDecision(
    tx,
    authority.scopeId,
    request,
    current,
    databaseNowMs,
    allocatedCandidate ?? null,
    decision,
  );
}

async function inspectOnce(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedTaskSystemRunAttemptTargetV1,
  operation: "inspect_current_attempt",
  runId: TaskRunIdV1,
): Promise<TaskSystemRunAttemptInspectionSnapshotV1> {
  await requireLockedScopeAuthority(tx, authority, target, operation, runId);
  const observedAtMs = await target[READ_TASK_SYSTEM_DATABASE_NOW_V1](
    tx,
    authority.scopeId,
    operation,
    runId,
  );
  const row = await loadRun(tx, authority.scopeId, runId, false);
  if (row === null) throw rollbackStoreError(new TaskSystemRunAttemptUnavailableError({
    operation,
    runId,
    reason: "unavailable",
  }));
  const current = decodeAndCorrelateRunRow(row, operation, runId);
  await correlateLifecycleLedger(
    tx,
    authority.scopeId,
    operation,
    runId,
    current,
  );
  return Object.freeze({ observedAtMs, current });
}

async function requireLockedScopeAuthority(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  target: LocatedTaskSystemRunAttemptTargetV1,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
): Promise<void> {
  await requireLockedTaskSystemScopeAuthorityV1(
    tx,
    authority,
    target,
    mismatch => rollbackStoreError(staleAuthority(operation, runId, mismatch)),
  );
}

async function loadRun(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  lockForUpdate: boolean,
): Promise<TaskRunRow | null> {
  const base = tx.select().from(fxSystemDurableTaskRunsV1).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, runId),
  )).limit(1);
  const rows = lockForUpdate ? await base.for("update") : await base;
  return rows[0] ?? null;
}

async function readTaskSystemDatabaseNowV1(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
): Promise<TaskDatabaseTimeMsV1> {
  const rows = await tx.select({
    milliseconds: sql<string>`
      floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
    `,
  }).from(fxSystemScopeClocks).where(
    eq(fxSystemScopeClocks.scopeId, scopeId),
  ).limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^(0|[1-9][0-9]*)$/.test(text)) {
    throw rollbackStoreError(corruption(operation, runId, "aggregate_invalid"));
  }
  return Result.getOrThrowWith(
    decodeTaskDatabaseTimeMsV1(Number(text)),
    () => rollbackStoreError(corruption(operation, runId, "aggregate_invalid")),
  );
}

function decodeAndCorrelateRunRow(
  row: TaskRunRow,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
): TaskRunAttemptAggregateV1 {
  if (row.runId !== runId) {
    throw rollbackStoreError(corruption(operation, runId, "aggregate_invalid"));
  }
  return Result.getOrThrowWith(
    decodeAndCorrelateTaskSystemRunRowV1(row),
    reason => rollbackStoreError(corruption(operation, runId, reason)),
  );
}

async function correlateLifecycleLedger(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  aggregate: TaskRunAttemptAggregateV1,
): Promise<void> {
  await correlateRequestedEffects(tx, scopeId, operation, runId, aggregate);
  await correlateAttemptIdentities(tx, scopeId, operation, runId, aggregate);
}

async function correlateRequestedEffects(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  aggregate: TaskRunAttemptAggregateV1,
): Promise<void> {
  const expected = new Map<
    TaskRequestedEffectRow["sequence"],
    PersistedTaskRequestedEffectV1
  >();
  const acceptances = aggregate.lastLifecycleAcceptance === null
    ? aggregate.completionReplays.map(replay => replay.accepted)
    : [
        aggregate.lastLifecycleAcceptance.accepted,
        ...aggregate.completionReplays.map(replay => replay.accepted),
      ];
  for (const acceptance of acceptances) {
    for (const effect of acceptance.requestedEffects) {
      const existing = expected.get(effect.sequence);
      if (existing !== undefined && !persistedValueEqual(existing, effect)) {
        throw rollbackStoreError(corruption(operation, runId, "effect_sequence_invalid"));
      }
      expected.set(effect.sequence, effect);
    }
  }
  if (expected.size === 0) return;

  const rows = await tx.select().from(fxSystemDurableTaskRequestedEffectsV1)
    .where(and(
      eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId),
      inArray(
        fxSystemDurableTaskRequestedEffectsV1.sequence,
        [...expected.keys()],
      ),
    ));
  if (rows.length !== expected.size) {
    throw rollbackStoreError(corruption(operation, runId, "effect_sequence_invalid"));
  }
  for (const row of rows) {
    const effect = expected.get(row.sequence);
    if (effect === undefined || !requestedEffectRowMatches(row, effect)) {
      throw rollbackStoreError(corruption(operation, runId, "effect_sequence_invalid"));
    }
  }
}

function requestedEffectRowMatches(
  row: TaskRequestedEffectRow,
  expected: PersistedTaskRequestedEffectV1,
): boolean {
  return Result.gen(function* () {
    const decoded = yield* decodePersistedTaskRequestedEffectJsonV1(
      row.payloadJson,
    );
    const canonical = yield* encodePersistedTaskRequestedEffectJsonV1(decoded);
    return row.payloadCodecVersion === 1
      && row.sequence === expected.sequence
      && row.acceptedRunVersion === expected.effect.acceptedRunVersion
      && row.kind === expected.effect.kind
      && row.notBeforeMs === effectNotBeforeMs(expected)
      && row.payloadByteLength === encodedJsonByteLength(canonical)
      && persistedValueEqual(decoded, expected);
  }).pipe(Result.getOrElse(() => false));
}

async function correlateAttemptIdentities(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  aggregate: TaskRunAttemptAggregateV1,
): Promise<void> {
  const expected = collectExpectedAttemptIdentities(aggregate, operation, runId);
  const rows = await tx.select().from(fxSystemDurableTaskAttemptIdentitiesV1)
    .where(and(
      eq(fxSystemDurableTaskAttemptIdentitiesV1.scopeId, scopeId),
      eq(fxSystemDurableTaskAttemptIdentitiesV1.runId, runId),
    )).orderBy(fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber);
  const expectedCount = aggregate.attemptHistory.kind === "none"
    ? 0
    : aggregate.attemptHistory.lastAttemptNumber;
  if (rows.length !== expectedCount) {
    throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
  }
  const identitiesById = new Map<TaskAttemptIdV1, TaskAttemptIdentityRow>();
  let previousFence = 0n;
  let previousAcceptedRunVersion = 0n;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row === undefined
      || row.attemptNumber !== index + 1
      || row.executionFence !== previousFence + 1n
      || row.acceptedRunVersion <= previousAcceptedRunVersion
      || row.acceptedRunVersion > aggregate.runVersion
      || identitiesById.has(row.attemptId)
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
    identitiesById.set(row.attemptId, row);
    previousFence = row.executionFence;
    previousAcceptedRunVersion = row.acceptedRunVersion;
  }
  for (const identity of expected.values()) {
    const row = identitiesById.get(identity.attemptId);
    if (
      row === undefined
      || !attemptIdentityRowMatches(row, identity, aggregate.runVersion)
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
  }

  const dispatchRows = await tx.select().from(fxSystemDurableTaskRequestedEffectsV1)
    .where(and(
      eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId),
      eq(fxSystemDurableTaskRequestedEffectsV1.kind, "dispatch_attempt"),
    )).orderBy(fxSystemDurableTaskRequestedEffectsV1.sequence)
    .limit(expectedCount + 1);
  if (dispatchRows.length !== rows.length) {
    throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
  }
  const dispatchedAttemptIds = new Set<TaskAttemptIdV1>();
  const effectCursor = aggregate.requestedEffectCursor.kind === "none"
    ? 0n
    : aggregate.requestedEffectCursor.lastSequence;
  let previousDispatchSequence = 0n;
  for (let index = 0; index < dispatchRows.length; index += 1) {
    const dispatchRow = dispatchRows[index];
    const orderedIdentity = rows[index];
    if (
      dispatchRow === undefined
      || orderedIdentity === undefined
      || dispatchRow.sequence <= previousDispatchSequence
      || dispatchRow.sequence > effectCursor
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
    const decoded = Result.getOrThrowWith(
      decodePersistedTaskRequestedEffectJsonV1(dispatchRow.payloadJson),
      () => rollbackStoreError(
        corruption(operation, runId, "acceptance_invalid"),
      ),
    );
    if (
      decoded.effect.kind !== "dispatch_attempt"
      || !requestedEffectRowMatches(dispatchRow, decoded)
      || decoded.effect.taskDefinitionRevisionId
        !== aggregate.taskDefinitionRevisionId
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
    const attempt = decoded.effect.attempt;
    const identity = identitiesById.get(attempt.attemptId);
    if (
      identity === undefined
      || identity !== orderedIdentity
      || dispatchedAttemptIds.has(attempt.attemptId)
      || identity.attemptNumber !== attempt.attemptNumber
      || identity.executionFence !== attempt.executionFence
      || identity.acceptedRunVersion
        !== decoded.effect.acceptedRunVersion
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
    dispatchedAttemptIds.add(attempt.attemptId);
    previousDispatchSequence = dispatchRow.sequence;
  }
}

function collectExpectedAttemptIdentities(
  aggregate: TaskRunAttemptAggregateV1,
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
): ReadonlyMap<TaskAttemptIdV1, ExpectedAttemptIdentityV1> {
  const expected = new Map<TaskAttemptIdV1, ExpectedAttemptIdentityV1>();

  const add = (
    attempt: Readonly<{
      readonly attemptId: TaskAttemptIdV1;
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly executionFence: TaskExecutionFenceV1;
    }>,
    acceptedRunVersion: bigint | null = null,
  ) => {
    const existing = expected.get(attempt.attemptId);
    if (
      existing !== undefined
      && (
        existing.attemptNumber !== attempt.attemptNumber
        || existing.executionFence !== attempt.executionFence
        || (
          existing.acceptedRunVersion !== null
          && acceptedRunVersion !== null
          && existing.acceptedRunVersion !== acceptedRunVersion
        )
      )
    ) {
      throw rollbackStoreError(corruption(operation, runId, "acceptance_invalid"));
    }
    expected.set(attempt.attemptId, Object.freeze({
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      executionFence: attempt.executionFence,
      acceptedRunVersion: existing?.acceptedRunVersion ?? acceptedRunVersion,
    }));
  };

  switch (aggregate.phase) {
    case "attempt_granted":
    case "executing":
      add(
        aggregate.currentAttempt,
        aggregate.currentAttempt.grantBasisRunVersion + 1n,
      );
      break;
    case "ready":
      if (aggregate.ready.kind === "immediate_retry") {
        add(aggregate.ready.acceptedRetry.previousAttempt);
      }
      break;
    case "retry_waiting":
      add(aggregate.retry.previousAttempt);
      break;
    case "terminal":
      if (aggregate.terminal.attempt !== null) add(aggregate.terminal.attempt);
      break;
  }
  for (const replay of aggregate.completionReplays) {
    add(replay.attempt);
  }
  return expected;
}

function attemptIdentityRowMatches(
  row: TaskAttemptIdentityRow,
  expected: ExpectedAttemptIdentityV1,
  currentRunVersion: bigint,
): boolean {
  return row.attemptId === expected.attemptId
    && row.attemptNumber === expected.attemptNumber
    && row.executionFence === expected.executionFence
    && row.acceptedRunVersion > 0n
    && row.acceptedRunVersion <= currentRunVersion
    && (
      expected.acceptedRunVersion === null
      || row.acceptedRunVersion === expected.acceptedRunVersion
    );
}

function allocateAttemptCandidate(
  current: TaskRunAttemptAggregateV1,
  randomUuid: () => string,
  operation: "start_attempt",
  runId: TaskRunIdV1,
): TaskAttemptGrantCandidateV1 {
  const nextAttemptNumber = current.attemptHistory.kind === "none"
    ? 1
    : current.attemptHistory.lastAttemptNumber + 1;
  const attemptNumber = Result.getOrThrowWith(
    decodeTaskAttemptNumberV1(nextAttemptNumber),
    () => rollbackDecisionError(new TaskRunAttemptCounterExhaustedError({
      operation,
      runId,
      counter: "attempt_number",
    })),
  );
  const fenceBasis = current.phase === "ready"
    ? current.ready.kind === "initial"
      ? 0n
      : current.ready.acceptedRetry.previousAttempt.executionFence
    : current.phase === "retry_waiting"
    ? current.retry.previousAttempt.executionFence
    : current.phase === "attempt_granted" || current.phase === "executing"
    ? current.currentAttempt.executionFence
    : current.terminal.attempt?.executionFence ?? 0n;
  if (fenceBasis >= POSTGRES_SIGNED_BIGINT_MAX) {
    throw rollbackStoreError(new TaskSystemRunAttemptTerminalStoreError({
      operation,
      runId,
      reason: "fence_allocation_exhausted",
      cause: null,
    }));
  }
  const executionFence = Result.getOrThrowWith(
    decodeTaskExecutionFenceV1(String(fenceBasis + 1n)),
    cause => rollbackStoreError(new TaskSystemRunAttemptTerminalStoreError({
      operation,
      runId,
      reason: "fence_allocation_exhausted",
      cause,
    })),
  );
  let uuid: string;
  try {
    uuid = randomUuid();
  } catch (cause) {
    throw rollbackStoreError(new TaskSystemRunAttemptTerminalStoreError({
      operation,
      runId,
      reason: "identity_allocation_exhausted",
      cause,
    }));
  }
  const attemptId = Result.getOrThrowWith(
    decodeTaskAttemptIdV1(`attempt_${uuid}`),
    cause => rollbackStoreError(new TaskSystemRunAttemptTerminalStoreError({
      operation,
      runId,
      reason: "identity_allocation_exhausted",
      cause,
    })),
  );
  return Object.freeze({
    attemptId,
    attemptNumber,
    executionFence,
  });
}

async function applyDecision<Outcome>(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
  current: TaskRunAttemptAggregateV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
  attemptGrantCandidate: TaskAttemptGrantCandidateV1 | null,
  decision: TaskRunAttemptDecisionV1<Outcome>,
): Promise<TaskSystemRunAttemptTransactionReceiptV1<Outcome>> {
  if (decision.kind === "no_change") {
    if (decision.disposition === "idempotent") {
      if (!isStoredAcceptanceReplay(current, decision.replay)) {
        throw rollbackDecisionError(invalidDecision(request, current, "acceptance_invalid"));
      }
      return Object.freeze({
        disposition: "idempotent",
        observedAtMs: decision.replay.observedAtMs,
        runVersion: decision.replay.acceptedRunVersion,
        outcome: decision.replay.outcome,
        evidence: decision.replay.evidence,
        requestedEffects: decision.replay.requestedEffects,
      } as const);
    }
    return Object.freeze({
      disposition: "current",
      observedAtMs: databaseNowMs,
      runVersion: current.runVersion,
      outcome: decision.outcome,
      evidence: Object.freeze([]),
      requestedEffects: Object.freeze([]),
    } as const);
  }

  const prepared = prepareCommit(
    request,
    current,
    databaseNowMs,
    attemptGrantCandidate,
    decision,
  );
  const updated = await tx.update(fxSystemDurableTaskRunsV1).set({
    aggregateCodecVersion: 1,
    aggregateByteLength: prepared.aggregateByteLength,
    aggregateJson: prepared.aggregateJson,
    runVersion: prepared.projection.runVersion,
    phase: prepared.projection.phase,
    dueKind: prepared.projection.dueKind,
    dueAtMs: nullableNumberAsBigInt(prepared.projection.dueAtMs),
    currentAttemptId: prepared.projection.currentAttemptId,
    executionFenceBasis: prepared.projection.executionFenceBasis,
    currentLeaseVersion: prepared.projection.currentLeaseVersion,
    currentLeaseExpiresAtMs: nullableNumberAsBigInt(
      prepared.projection.currentLeaseExpiresAtMs,
    ),
    cancellationGeneration: prepared.projection.cancellationGeneration,
    requestedEffectSequence: prepared.projection.requestedEffectSequence,
  }).where(and(
    eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
    eq(fxSystemDurableTaskRunsV1.runId, request.runId),
    eq(fxSystemDurableTaskRunsV1.runVersion, current.runVersion),
  )).returning({ runVersion: fxSystemDurableTaskRunsV1.runVersion });
  if (updated.length !== 1 || updated[0]?.runVersion !== prepared.next.runVersion) {
    throw rollbackStoreError(new TaskSystemRunAttemptTransientStoreError({
      operation: request.operation,
      runId: request.runId,
      reason: "transaction_conflict",
      cause: null,
    }));
  }

  if (prepared.attemptIdentity !== null) {
    await tx.insert(fxSystemDurableTaskAttemptIdentitiesV1).values({
      scopeId,
      attemptId: prepared.attemptIdentity.attemptId,
      runId: request.runId,
      attemptNumber: prepared.attemptIdentity.attemptNumber,
      executionFence: prepared.attemptIdentity.executionFence,
      acceptedRunVersion: prepared.next.runVersion,
    });
  }
  if (prepared.effects.length > 0) {
    await tx.insert(fxSystemDurableTaskRequestedEffectsV1).values(
      prepared.effects.map(({ persisted, payloadJson, payloadByteLength }) => ({
        scopeId,
        runId: request.runId,
        sequence: persisted.sequence,
        acceptedRunVersion: persisted.effect.acceptedRunVersion,
        kind: persisted.effect.kind,
        payloadCodecVersion: 1,
        payloadByteLength,
        payloadJson,
        notBeforeMs: effectNotBeforeMs(persisted),
      })),
    );
  }
  return Object.freeze({
    disposition: "accepted",
    observedAtMs: databaseNowMs,
    runVersion: prepared.next.runVersion,
    outcome: decision.outcome,
    evidence: decision.evidence,
    requestedEffects: decision.requestedEffects,
  } as const);
}

function prepareCommit<Outcome>(
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
  current: TaskRunAttemptAggregateV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
  candidate: TaskAttemptGrantCandidateV1 | null,
  decision: Extract<TaskRunAttemptDecisionV1<Outcome>, { readonly kind: "commit" }>,
) {
  if (decision.expectedRunVersion !== current.runVersion) {
    throw rollbackDecisionError(new StaleTaskRunVersionError({
      operation: request.operation,
      runId: request.runId,
      reason: "commit_basis_disagrees_with_decoded_state",
    }));
  }
  if (current.runVersion >= POSTGRES_SIGNED_BIGINT_MAX) {
    throw rollbackStoreError(new TaskSystemRunAttemptTerminalStoreError({
      operation: request.operation,
      runId: request.runId,
      reason: "version_storage_exhausted",
      cause: null,
    }));
  }
  if (
    decision.next.runVersion !== current.runVersion + 1n
    || decision.next.runId !== current.runId
    || decision.next.taskDefinitionRevisionId !== current.taskDefinitionRevisionId
    || decision.next.createdAtMs !== current.createdAtMs
    || !persistedValueEqual(decision.next.boundPolicy, current.boundPolicy)
  ) {
    throw rollbackDecisionError(invalidDecision(request, current, "next_state_invalid"));
  }
  const preparedAggregate = Result.getOrThrowWith(Result.gen(function* () {
    const aggregateJson = yield* encodePersistedTaskRunAttemptAggregateJsonV1(
      decision.next,
    );
    const next = yield* decodePersistedTaskRunAttemptAggregateJsonV1(
      aggregateJson,
    );
    return { aggregateJson, next };
  }), () => rollbackDecisionError(
    invalidDecision(request, current, "next_state_invalid"),
  ));
  const { aggregateJson, next } = preparedAggregate;
  const acceptance = next.lastLifecycleAcceptance;
  if (
    acceptance === null
    || acceptance.kind !== request.operation
    || acceptance.accepted.observedAtMs !== databaseNowMs
    || !persistedValueEqual(acceptance.accepted.outcome, decision.outcome)
    || !persistedValueEqual(acceptance.accepted.evidence, decision.evidence)
    || !persistedValueEqual(
      acceptance.accepted.requestedEffects,
      decision.requestedEffects,
    )
  ) {
    throw rollbackDecisionError(invalidDecision(request, current, "acceptance_invalid"));
  }
  const firstSequence = current.requestedEffectCursor.kind === "none"
    ? 1n
    : current.requestedEffectCursor.lastSequence + 1n;
  if (
    decision.requestedEffects.length === 0
    || decision.requestedEffects[0]?.sequence !== firstSequence
  ) {
    throw rollbackDecisionError(invalidDecision(request, current, "effect_order_invalid"));
  }
  const effects = decision.requestedEffects.map((persisted, index) => {
    if (
      persisted.sequence !== firstSequence + BigInt(index)
      || persisted.effect.runId !== current.runId
      || persisted.effect.acceptedRunVersion !== next.runVersion
    ) {
      throw rollbackDecisionError(invalidDecision(request, current, "effect_order_invalid"));
    }
    const payloadJson = Result.getOrThrowWith(
      encodePersistedTaskRequestedEffectJsonV1(persisted),
      () => rollbackDecisionError(
        invalidDecision(request, current, "effect_order_invalid"),
      ),
    );
    return Object.freeze({
      persisted,
      payloadJson,
      payloadByteLength: encodedJsonByteLength(payloadJson),
    });
  });
  const projection = projectTaskRunAttemptPersistenceV1(next);
  const lastSequence = effects.at(-1)?.persisted.sequence;
  if (
    lastSequence === undefined
    || BigInt(projection.requestedEffectSequence) !== BigInt(lastSequence)
  ) {
    throw rollbackDecisionError(invalidDecision(request, current, "effect_order_invalid"));
  }
  const attemptIdentity = request.operation === "start_attempt"
    ? requireAcceptedAttemptIdentity(request, current, next, candidate)
    : null;
  return Object.freeze({
    next,
    projection,
    aggregateJson,
    aggregateByteLength: encodedJsonByteLength(aggregateJson),
    attemptIdentity,
    effects: Object.freeze(effects),
  });
}

function requireAcceptedAttemptIdentity<Outcome>(
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
  current: TaskRunAttemptAggregateV1,
  next: TaskRunAttemptAggregateV1,
  candidate: TaskAttemptGrantCandidateV1 | null,
): TaskAttemptGrantCandidateV1 {
  if (
    candidate === null
    || next.phase !== "attempt_granted"
    || next.currentAttempt.attemptId !== candidate.attemptId
    || next.currentAttempt.attemptNumber !== candidate.attemptNumber
    || next.currentAttempt.executionFence !== candidate.executionFence
  ) {
    throw rollbackDecisionError(invalidDecision(request, current, "candidate_unexpected"));
  }
  return candidate;
}

function isStoredAcceptanceReplay<Outcome>(
  current: TaskRunAttemptAggregateV1,
  replay: unknown,
): boolean {
  if (
    current.lastLifecycleAcceptance !== null
    && persistedValueEqual(current.lastLifecycleAcceptance.accepted, replay)
  ) return true;
  return current.completionReplays.some((entry) =>
    persistedValueEqual(entry.accepted, replay)
  );
}

function invalidDecision<Outcome>(
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
  current: TaskRunAttemptAggregateV1,
  reason: InvalidRunAttemptTransitionError["reason"],
): InvalidRunAttemptTransitionError {
  return new InvalidRunAttemptTransitionError({
    operation: request.operation,
    runId: request.runId,
    phase: current.phase,
    reason,
  });
}

function effectNotBeforeMs(effect: PersistedTaskRequestedEffectV1): bigint | null {
  switch (effect.effect.kind) {
    case "continue_retry":
    case "wake_retry":
    case "wake_lease_expiry":
      return BigInt(effect.effect.notBeforeMs);
    default:
      return null;
  }
}

function encodedJsonByteLength(value: unknown): bigint {
  return BigInt(UTF8.encode(JSON.stringify(value)).byteLength);
}

function nullableNumberAsBigInt(value: number | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function snapshotReceipt<Outcome>(
  receipt: TaskSystemRunAttemptTransactionReceiptV1<Outcome>,
  request: TaskSystemRunAttemptTransactionV1<Outcome>,
): Result.Result<
  TaskSystemRunAttemptTransactionReceiptV1<Outcome>,
  TaskSystemRunAttemptTerminalStoreError
> {
  try {
    return Result.succeed(snapshotOwned(receipt));
  } catch (cause) {
    return Result.fail(new TaskSystemRunAttemptTerminalStoreError({
      operation: request.operation,
      runId: request.runId,
      reason: "serialization_unsupported",
      cause,
    }));
  }
}

function snapshotInspection(
  inspection: TaskSystemRunAttemptInspectionSnapshotV1,
  operation: "inspect_current_attempt",
  runId: TaskRunIdV1,
): Result.Result<
  TaskSystemRunAttemptInspectionSnapshotV1,
  TaskSystemRunAttemptTerminalStoreError
> {
  try {
    return Result.succeed(snapshotOwned(inspection));
  } catch (cause) {
    return Result.fail(new TaskSystemRunAttemptTerminalStoreError({
      operation,
      runId,
      reason: "serialization_unsupported",
      cause,
    }));
  }
}

function snapshotOwned<Value>(value: Value): Value {
  const snapshot = structuredClone(value);
  freezeOwned(snapshot);
  return snapshot;
}

function freezeOwned(value: unknown): void {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freezeOwned(child);
  }
  Object.freeze(value);
}

function persistedValueEqual(left: unknown, right: unknown): boolean {
  return persistedValueEqualAtDepth(left, right, 0);
}

function persistedValueEqualAtDepth(
  left: unknown,
  right: unknown,
  depth: number,
): boolean {
  if (Object.is(left, right)) return true;
  if (depth > 256 || left === null || right === null) return false;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!persistedValueEqualAtDepth(left[index], right[index], depth + 1)) return false;
    }
    return true;
  }
  if (!isNonArrayRecord(left) || !isNonArrayRecord(right)) return false;
  const leftRecord = left;
  const rightRecord = right;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key === undefined || key !== rightKeys[index]) return false;
    if (!persistedValueEqualAtDepth(leftRecord[key], rightRecord[key], depth + 1)) {
      return false;
    }
  }
  return true;
}

function awaitLocatedTransaction<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => transaction,
    catch: cause => cause,
  }));
}

class DecisionRollback {
  readonly kind = "decision";
  constructor(readonly error: RunAttemptDecisionErrorV1) {}
}

class StoreRollback {
  readonly kind = "store";
  constructor(readonly error: TaskSystemRunAttemptStoreErrorV1) {}
}

function rollbackDecisionError(error: RunAttemptDecisionErrorV1): DecisionRollback {
  return new DecisionRollback(error);
}

function rollbackStoreError(error: TaskSystemRunAttemptStoreErrorV1): StoreRollback {
  return new StoreRollback(error);
}

type ClassifiedTransactionFailure =
  | Readonly<{ readonly kind: "retry" }>
  | Readonly<{
      readonly kind: "fail";
      readonly error: RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1;
    }>
  | Readonly<{
      readonly kind: "cleanup";
      readonly callback:
        | RunAttemptDecisionErrorV1
        | TaskSystemRunAttemptStoreErrorV1;
      readonly cause: LocatedReadCommittedTransactionFailureV1;
    }>
  | Readonly<{ readonly kind: "defect"; readonly cause: unknown }>;

function classifyTransactionFailure(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  cause: unknown,
  execution: number,
): ClassifiedTransactionFailure {
  if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
    return Object.freeze({ kind: "defect", cause });
  }
  switch (cause.issue.kind) {
    case "callbackRolledBack":
      return classifyConfirmedRollback(
        operation,
        runId,
        cause.issue.callbackCause,
        cause,
        execution,
      );
    case "decisionUncertain":
      return Object.freeze({
        kind: "fail",
        error: new TaskSystemRunAttemptTransientStoreError({
          operation,
          runId,
          reason: "driver_failure",
          cause,
        }),
      });
    case "infrastructureFailure":
      return classifyInfrastructureFailure(operation, runId, cause);
    case "callbackCleanupFailed": {
      const callback = unwrapRollback(cause.issue.callbackCause);
      if (callback !== null) {
        return Object.freeze({
          kind: "cleanup",
          callback,
          cause,
        });
      }
      return Object.freeze({ kind: "defect", cause });
    }
  }
}

function classifyConfirmedRollback(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  callbackCause: unknown,
  transactionCause: LocatedReadCommittedTransactionFailureV1,
  execution: number,
): ClassifiedTransactionFailure {
  const expected = unwrapRollback(callbackCause);
  if (expected !== null) return Object.freeze({ kind: "fail", error: expected });
  if (isRetryableSqlConflict(callbackCause)) {
    return execution < MAX_TRANSACTION_EXECUTIONS
      ? Object.freeze({ kind: "retry" })
      : Object.freeze({
          kind: "fail",
          error: new TaskSystemRunAttemptTransientStoreError({
            operation,
            runId,
            reason: "transaction_conflict",
            cause: transactionCause,
          }),
        });
  }
  if (isAttemptIdentityPrimaryKeyCollision(callbackCause)) {
    return execution < MAX_TRANSACTION_EXECUTIONS
      ? Object.freeze({ kind: "retry" })
      : Object.freeze({
          kind: "fail",
          error: new TaskSystemRunAttemptTerminalStoreError({
            operation,
            runId,
            reason: "identity_allocation_exhausted",
            cause: transactionCause,
          }),
        });
  }
  const known = classifyKnownSqlFailure(operation, runId, callbackCause, transactionCause);
  return known === null
    ? Object.freeze({ kind: "defect", cause: transactionCause })
    : Object.freeze({ kind: "fail", error: known });
}

function unwrapRollback(
  cause: unknown,
): RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1 | null {
  if (cause instanceof DecisionRollback || cause instanceof StoreRollback) {
    return cause.error;
  }
  return null;
}

function isStoreError(
  error: RunAttemptDecisionErrorV1 | TaskSystemRunAttemptStoreErrorV1,
): error is TaskSystemRunAttemptStoreErrorV1 {
  return error instanceof TaskSystemRunAttemptUnavailableError
    || error instanceof TaskSystemRunAttemptCorruptionError
    || error instanceof TaskSystemRunAttemptStaleScopeAuthorityError
    || error instanceof TaskSystemRunAttemptTransientStoreError
    || error instanceof TaskSystemRunAttemptTerminalStoreError;
}

function transientDriverFailure(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  sqlCause: unknown,
  retainedCause: unknown,
): TaskSystemRunAttemptTransientStoreError {
  const code = sqlState(sqlCause);
  return new TaskSystemRunAttemptTransientStoreError({
    operation,
    runId,
    reason: code?.startsWith("08") === true
      ? "connection_unavailable"
      : code === "57014"
      ? "timeout"
      : "driver_failure",
    cause: retainedCause,
  });
}

function classifyInfrastructureFailure(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  failure: LocatedReadCommittedTransactionFailureV1,
): ClassifiedTransactionFailure {
  if (failure.issue.kind !== "infrastructureFailure") {
    return Object.freeze({ kind: "defect", cause: failure });
  }
  const transient = classifyKnownSqlFailure(
    operation,
    runId,
    failure.issue.cause,
    failure,
  );
  if (transient !== null) {
    return Object.freeze({ kind: "fail", error: transient });
  }
  if (failure.issue.phase === "beginOrConfigure") {
    return Object.freeze({
      kind: "fail",
      error: new TaskSystemRunAttemptTerminalStoreError({
        operation,
        runId,
        reason: "unsupported_integration",
        cause: failure,
      }),
    });
  }
  return Object.freeze({ kind: "defect", cause: failure });
}

function classifyKnownSqlFailure(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  sqlCause: unknown,
  retainedCause: unknown,
): TaskSystemRunAttemptTransientStoreError | null {
  const code = sqlState(sqlCause);
  return code?.startsWith("08") === true || code === "57014"
    ? transientDriverFailure(operation, runId, sqlCause, retainedCause)
    : null;
}

function isRetryableSqlConflict(cause: unknown): boolean {
  const code = sqlState(cause);
  return code === "40001" || code === "40P01";
}

function isAttemptIdentityPrimaryKeyCollision(cause: unknown): boolean {
  const descriptor = sqlErrorDescriptor(cause);
  return descriptor?.code === "23505"
    && descriptor.constraint === ATTEMPT_IDENTITY_PRIMARY_KEY;
}

function sqlState(cause: unknown): string | undefined {
  return sqlErrorDescriptor(cause)?.code;
}

function sqlErrorDescriptor(cause: unknown): Readonly<{
  readonly code: string;
  readonly constraint: string | undefined;
}> | undefined {
  let current = cause;
  for (let depth = 0; depth < 8; depth += 1) {
    const code = stringProperty(current, "code");
    if (code !== undefined) {
      return Object.freeze({
        code,
        constraint: stringProperty(current, "constraint"),
      });
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : undefined;
}

function staleAuthority(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  authority: TaskSystemRunAttemptStaleScopeAuthorityError["authority"],
): TaskSystemRunAttemptStaleScopeAuthorityError {
  return new TaskSystemRunAttemptStaleScopeAuthorityError({
    operation,
    runId,
    authority,
  });
}

function corruption(
  operation: RunAttemptOperationV1,
  runId: TaskRunIdV1,
  reason: TaskSystemRunAttemptCorruptionError["reason"],
): TaskSystemRunAttemptCorruptionError {
  return new TaskSystemRunAttemptCorruptionError({ operation, runId, reason });
}
