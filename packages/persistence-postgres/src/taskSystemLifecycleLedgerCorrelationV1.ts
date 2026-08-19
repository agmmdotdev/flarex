import {
  type ApplicationTaskRunAttemptAggregateV1,
  toCurrentTaskRequestedEffect,
  toCurrentTaskRunAttemptAggregate,
  type CurrentPersistedTaskRequestedEffect,
  type CurrentTaskRunAttemptAggregate,
  type PersistedTaskRunAttemptAggregate,
  type TaskAttemptIdV1,
  type TaskAttemptNumberV1,
  type TaskExecutionFenceV1,
  type TaskRunAttemptAggregateV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, inArray } from "drizzle-orm";
import { Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "./schema";
import { decodeAndCorrelateTaskSystemRequestedEffectRowV1 } from
  "./taskSystemRequestedEffectRowV1";
import { decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1 } from
  "./taskSystemRequestedEffectRowV1";

type TaskAttemptIdentityRow =
  typeof fxSystemDurableTaskAttemptIdentitiesV1.$inferSelect;
type TaskRequestedEffectRow =
  typeof fxSystemDurableTaskRequestedEffectsV1.$inferSelect;

interface ExpectedAttemptIdentityV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly acceptedRunVersion: bigint | null;
}

/**
 * Package-owned full lifecycle-ledger correlation shared by Task transactions.
 * The caller supplies its own corruption error so domain error ownership does
 * not leak between repositories.
 */
export async function correlateTaskSystemLifecycleLedgerV1(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  aggregate: TaskRunAttemptAggregateV1,
  onCorruption: (
    reason: "effect_sequence_invalid" | "acceptance_invalid",
  ) => unknown,
): Promise<void> {
  await correlateLifecycleLedgerCurrent(
    tx, scopeId, runId,
    Object.freeze({ generation: "legacy_definition_v1", aggregate }),
    onCorruption,
  );
}

export async function correlateApplicationTaskSystemLifecycleLedgerV1(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  aggregate: ApplicationTaskRunAttemptAggregateV1,
  onCorruption: (reason: "effect_sequence_invalid" | "acceptance_invalid") => unknown,
): Promise<void> {
  await correlateLifecycleLedgerCurrent(
    tx, scopeId, runId,
    Object.freeze({ generation: "application_v1", aggregate }),
    onCorruption,
  );
}

async function correlateLifecycleLedgerCurrent(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  persisted: PersistedTaskRunAttemptAggregate,
  onCorruption: (reason: "effect_sequence_invalid" | "acceptance_invalid") => unknown,
): Promise<void> {
  const aggregate = toCurrentTaskRunAttemptAggregate(persisted);
  await correlateRequestedEffects(
    tx, scopeId, runId, aggregate, persisted.generation, onCorruption,
  );
  await correlateAttemptIdentities(
    tx, scopeId, runId, aggregate, persisted.generation, onCorruption,
  );
}

async function correlateRequestedEffects(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  aggregate: CurrentTaskRunAttemptAggregate,
  generation: PersistedTaskRunAttemptAggregate["generation"],
  onCorruption: (
    reason: "effect_sequence_invalid" | "acceptance_invalid",
  ) => unknown,
): Promise<void> {
  const expected = new Map<
    TaskRequestedEffectRow["sequence"],
    CurrentPersistedTaskRequestedEffect
  >();
  const acceptances = aggregate.lastLifecycleAcceptance === null
    ? aggregate.completionReplays.map((replay) => replay.accepted)
    : [
        aggregate.lastLifecycleAcceptance.accepted,
        ...aggregate.completionReplays.map((replay) => replay.accepted),
      ];
  for (const acceptance of acceptances) {
    for (const effect of acceptance.requestedEffects) {
      const existing = expected.get(effect.sequence);
      if (
        existing !== undefined
        && !taskSystemPersistedValueEqualV1(existing, effect)
      ) {
        throw onCorruption("effect_sequence_invalid");
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
    throw onCorruption("effect_sequence_invalid");
  }
  for (const row of rows) {
    const effect = expected.get(row.sequence);
    if (effect === undefined || !requestedEffectRowMatches(row, effect, generation)) {
      throw onCorruption("effect_sequence_invalid");
    }
  }
}

function requestedEffectRowMatches(
  row: TaskRequestedEffectRow,
  expected: CurrentPersistedTaskRequestedEffect,
  generation: PersistedTaskRunAttemptAggregate["generation"],
): boolean {
  const decoded = generation === "legacy_definition_v1"
    ? decodeAndCorrelateTaskSystemRequestedEffectRowV1(row).pipe(
        Result.map(effect => toCurrentTaskRequestedEffect({ generation, effect: effect.effect })),
      )
    : decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1(row).pipe(
        Result.map(effect => toCurrentTaskRequestedEffect({ generation, effect: effect.effect })),
      );
  return decoded.pipe(
    Result.map((effect) => taskSystemPersistedValueEqualV1(
      Object.freeze({ sequence: row.sequence, effect }),
      expected,
    )),
    Result.getOrElse(() => false),
  );
}

async function correlateAttemptIdentities(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: TaskRunIdV1,
  aggregate: CurrentTaskRunAttemptAggregate,
  generation: PersistedTaskRunAttemptAggregate["generation"],
  onCorruption: (
    reason: "effect_sequence_invalid" | "acceptance_invalid",
  ) => unknown,
): Promise<void> {
  const expected = collectExpectedAttemptIdentities(aggregate, onCorruption);
  const rows = await tx.select().from(fxSystemDurableTaskAttemptIdentitiesV1)
    .where(and(
      eq(fxSystemDurableTaskAttemptIdentitiesV1.scopeId, scopeId),
      eq(fxSystemDurableTaskAttemptIdentitiesV1.runId, runId),
    )).orderBy(fxSystemDurableTaskAttemptIdentitiesV1.attemptNumber);
  const expectedCount = aggregate.attemptHistory.kind === "none"
    ? 0
    : aggregate.attemptHistory.lastAttemptNumber;
  if (rows.length !== expectedCount) throw onCorruption("acceptance_invalid");

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
    ) throw onCorruption("acceptance_invalid");
    identitiesById.set(row.attemptId, row);
    previousFence = row.executionFence;
    previousAcceptedRunVersion = row.acceptedRunVersion;
  }
  for (const identity of expected.values()) {
    const row = identitiesById.get(identity.attemptId);
    if (
      row === undefined
      || !attemptIdentityRowMatches(row, identity, aggregate.runVersion)
    ) throw onCorruption("acceptance_invalid");
  }

  const dispatchRows = await tx.select()
    .from(fxSystemDurableTaskRequestedEffectsV1)
    .where(and(
      eq(fxSystemDurableTaskRequestedEffectsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRequestedEffectsV1.runId, runId),
      eq(fxSystemDurableTaskRequestedEffectsV1.kind, "dispatch_attempt"),
    ))
    .orderBy(fxSystemDurableTaskRequestedEffectsV1.sequence)
    .limit(expectedCount + 1);
  if (dispatchRows.length !== rows.length) {
    throw onCorruption("acceptance_invalid");
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
    ) throw onCorruption("acceptance_invalid");
    const decoded = Result.getOrThrowWith(
      generation === "legacy_definition_v1"
        ? decodeAndCorrelateTaskSystemRequestedEffectRowV1(dispatchRow).pipe(
            Result.map(effect => toCurrentTaskRequestedEffect({ generation, effect: effect.effect })),
          )
        : decodeAndCorrelateApplicationTaskSystemRequestedEffectRowV1(dispatchRow).pipe(
            Result.map(effect => toCurrentTaskRequestedEffect({ generation, effect: effect.effect })),
          ),
      () => onCorruption("acceptance_invalid"),
    );
    if (
      decoded.kind !== "dispatch_attempt"
      || !taskSystemPersistedValueEqualV1(
        decoded.definitionReference,
        aggregate.definitionReference,
      )
    ) throw onCorruption("acceptance_invalid");
    const attempt = decoded.attempt;
    const identity = identitiesById.get(attempt.attemptId);
    if (
      identity === undefined
      || identity !== orderedIdentity
      || dispatchedAttemptIds.has(attempt.attemptId)
      || identity.attemptNumber !== attempt.attemptNumber
      || identity.executionFence !== attempt.executionFence
      || identity.acceptedRunVersion !== decoded.acceptedRunVersion
    ) throw onCorruption("acceptance_invalid");
    dispatchedAttemptIds.add(attempt.attemptId);
    previousDispatchSequence = dispatchRow.sequence;
  }
}

function collectExpectedAttemptIdentities(
  aggregate: CurrentTaskRunAttemptAggregate,
  onCorruption: (
    reason: "effect_sequence_invalid" | "acceptance_invalid",
  ) => unknown,
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
    ) throw onCorruption("acceptance_invalid");
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
  for (const replay of aggregate.completionReplays) add(replay.attempt);
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

export function taskSystemPersistedValueEqualV1(
  left: unknown,
  right: unknown,
): boolean {
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
    if (
      !Array.isArray(left) || !Array.isArray(right)
      || left.length !== right.length
    ) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!persistedValueEqualAtDepth(left[index], right[index], depth + 1)) {
        return false;
      }
    }
    return true;
  }
  if (!isNonArrayRecord(left) || !isNonArrayRecord(right)) return false;
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key === undefined || key !== rightKeys[index]) return false;
    if (!persistedValueEqualAtDepth(left[key], right[key], depth + 1)) {
      return false;
    }
  }
  return true;
}
