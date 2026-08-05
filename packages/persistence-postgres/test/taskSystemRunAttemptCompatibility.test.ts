import { PGlite } from "@electric-sql/pglite";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskDatabaseTimeMsV1,
  type TaskRunAttemptAggregateV1,
  type TaskSystemRunAttemptStoreShape,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import suiteJson from "../../../integration/durable-task-compatibility/scenarios/v1/run-attempt-lifecycle.json";
import {
  normalizeCompatibilityLifecycleFailureV1,
  normalizeCompatibilityReceiptV1,
  normalizeExpectedV1,
  prepareCompatibilityVectorsV1,
  type CompatibilityEffectCursorCaseV1,
  type CompatibilityLifecycleCommandV1,
  type CompatibilityVectorV1,
} from "../../durable-task/test/compatibility-harness.js";
import { createPGlitePersistence } from "../src/pglite";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeTaskSystemRunAttemptStoreV1,
} from "../src/taskSystemRunAttemptStoreV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  TASK_LOCATOR,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  resetCompatibilityTaskRunV1,
  seedCompatibilityLifecycleLedgerV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

interface CompatibilityVectorSuiteV1 {
  readonly vectors: readonly CompatibilityVectorV1[];
  readonly effectCursorCases: readonly CompatibilityEffectCursorCaseV1[];
}

const FOREIGN_SCOPE_ID = "scope_72000000-0000-4000-8000-000000000099";

const COMMAND_BOUNDARY_VECTOR_IDS = Object.freeze([
  "invalid-command-is-redacted",
  "waitpoint-completion-outside-v1",
]);

const EXPLICIT_STORE_SETUP_VECTOR_IDS = Object.freeze([
  "effect-sequence-overflow-rejected",
]);

const suite = decodeCompatibilityVectorSuiteV1(suiteJson);

describe("DTE04-B canonical compatibility lane - PGlite adapter", () => {
  it("executes every store-addressable vector through the adapter", async () => {
    const raw = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db: raw });
      await persistence.migrate();
      await seedTaskSystemRunAttemptStoreV1(persistence);
      const prepared = prepareCompatibilityVectorsV1(
        suite.vectors,
        suite.effectCursorCases,
      );
      let transitionDerivedStoreVectors = 0;
      const commandBoundaryVectors: string[] = [];
      const explicitStoreSetupVectors: string[] = [];

      for (const vector of suite.vectors) {
        const entry = prepared.get(vector.id);
        if (entry === undefined) throw new Error(`missing prepared ${vector.id}`);
        if (entry.command === null) {
          commandBoundaryVectors.push(vector.id);
          expect(entry.execution.actual, vector.id).toEqual(
            normalizeExpectedV1(vector.expected),
          );
          continue;
        }
        const persisted = entry.persistence;
        if (persisted === null) {
          expect(
            EXPLICIT_STORE_SETUP_VECTOR_IDS.includes(vector.id),
            `unexpected non-transition store vector: ${vector.id}`,
          ).toBe(true);
          explicitStoreSetupVectors.push(vector.id);
        } else {
          transitionDerivedStoreVectors += 1;
        }
        const current = persisted?.current ?? entry.current;
        await resetCompatibilityTaskRunV1(persistence, current);
        if (
          persisted !== null
          && vector.id !== "missing-run-is-unavailable"
          && vector.id !== "cross-scope-run-is-unavailable"
        ) {
          await seedCompatibilityLifecycleLedgerV1(
            persistence,
            persisted.current,
            persisted.history,
          );
        }
        await arrangeStoreBoundary(
          persistence,
          vector.id,
          current.runId,
          entry.command.runId,
        );
        const mutationSnapshot = vector.id === "effect-sequence-overflow-rejected"
          ? await readStoreMutationSnapshot(persistence, current.runId)
          : null;
        if (mutationSnapshot !== null) {
          expect(mutationSnapshot).toMatchObject({
            runVersion: "1",
            requestedEffectSequence: "9223372036854775805",
            attemptCount: "0",
            effectCount: "0",
          });
        }

        const runReadCommitted = transactionRunnerFor(
          persistence.drizzle,
          vector.id,
        );
        const target = createLocatedTaskSystemRunAttemptTargetV1(
          persistence.drizzle,
          TASK_LOCATOR,
          runReadCommitted,
          async () => Result.getOrThrow(
            decodeTaskDatabaseTimeMsV1(vector.input.databaseNowMs),
          ),
        );
        const located = await locatedTaskAuthorityV1(
          persistence.drizzle,
          target,
        );
        const store = makeTaskSystemRunAttemptStoreV1(located, {
          randomUuid: () => nextCompatibilityAttemptUuid(current),
        });
        try {
          const effect = runCompatibilityCommand(entry.command, store);
          const actual = vector.expected.kind === "receipt"
            ? normalizeCompatibilityReceiptV1(await runEffect(effect))
            : normalizeCompatibilityLifecycleFailureV1(
                await runEffectFailure(effect),
              );
          expect(actual, vector.id).toEqual(normalizeExpectedV1(vector.expected));
          if (mutationSnapshot !== null) {
            expect(
              await readStoreMutationSnapshot(persistence, current.runId),
              `${vector.id} must not mutate the store`,
            ).toEqual(mutationSnapshot);
          }
        } catch (cause) {
          throw new Error(`compatibility adapter vector failed: ${vector.id}`, {
            cause,
          });
        } finally {
          await restoreStoreBoundary(
            persistence,
            vector.id,
            current.runId,
            entry.command.runId,
          );
        }
      }

      expect(transitionDerivedStoreVectors).toBe(62);
      expect(commandBoundaryVectors).toEqual(COMMAND_BOUNDARY_VECTOR_IDS);
      expect(explicitStoreSetupVectors).toEqual(EXPLICIT_STORE_SETUP_VECTOR_IDS);
      expect(
        transitionDerivedStoreVectors + explicitStoreSetupVectors.length,
      ).toBe(63);
    } finally {
      await raw.close();
    }
  }, 120_000);
});

interface StoreMutationSnapshotV1 extends Record<string, unknown> {
  readonly aggregateJson: string;
  readonly aggregateByteLength: string;
  readonly runVersion: string;
  readonly phase: string;
  readonly dueKind: string | null;
  readonly dueAtMs: string | null;
  readonly currentAttemptId: string | null;
  readonly executionFenceBasis: string;
  readonly currentLeaseVersion: string | null;
  readonly currentLeaseExpiresAtMs: string | null;
  readonly cancellationGeneration: string;
  readonly requestedEffectSequence: string;
  readonly attemptCount: string;
  readonly effectCount: string;
}

async function readStoreMutationSnapshot(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  runId: string,
): Promise<StoreMutationSnapshotV1> {
  const result = await persistence.query<StoreMutationSnapshotV1>(`
    select aggregate_json::text as "aggregateJson",
      aggregate_byte_length::text as "aggregateByteLength",
      run_version::text as "runVersion",
      phase,
      due_kind as "dueKind",
      due_at_ms::text as "dueAtMs",
      current_attempt_id as "currentAttemptId",
      execution_fence_basis::text as "executionFenceBasis",
      current_lease_version::text as "currentLeaseVersion",
      current_lease_expires_at_ms::text as "currentLeaseExpiresAtMs",
      cancellation_generation::text as "cancellationGeneration",
      requested_effect_sequence::text as "requestedEffectSequence",
      (select count(*)::text
        from fx_system_durable_task_attempt_identity_v1 as attempt
        where attempt.scope_id = run.scope_id and attempt.run_id = run.run_id
      ) as "attemptCount",
      (select count(*)::text
        from fx_system_durable_task_requested_effect_v1 as effect
        where effect.scope_id = run.scope_id and effect.run_id = run.run_id
      ) as "effectCount"
    from fx_system_durable_task_run_v1 as run
    where scope_id = '${TASK_SCOPE_ID}' and run_id = '${runId}'
  `);
  const snapshot = result.rows[0];
  if (snapshot === undefined) throw new Error("compatibility run snapshot missing");
  return snapshot;
}

const runCompatibilityCommand = Effect.fn("runCompatibilityCommand")((
  command: CompatibilityLifecycleCommandV1,
  store: TaskSystemRunAttemptStoreShape,
) => Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    switch (command.type) {
      case "start_attempt":
        return yield* lifecycle.startAttempt(command);
      case "heartbeat_attempt":
        return yield* lifecycle.heartbeatAttempt(command);
      case "complete_attempt":
        return yield* lifecycle.completeAttempt(command);
      case "request_cancellation":
        return yield* lifecycle.requestCancellation(command);
      case "handle_lease_expiry":
        return yield* lifecycle.handleLeaseExpiry(command);
    }
  }).pipe(Effect.provide(
    RunAttemptLifecycleLive.pipe(
      Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, store)),
    ),
  )));

function transactionRunnerFor(
  db: Parameters<typeof createDefaultLocatedReadCommittedTransactionRunnerV1>[0],
  vectorId: string,
): RunLocatedReadCommittedTransactionV1 {
  if (vectorId === "transient-store-failure") {
    return async () => {
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "infrastructureFailure",
        phase: "acquire",
        cause: Object.freeze({ code: "08006" }),
      }));
    };
  }
  if (vectorId === "terminal-store-failure") {
    return async () => {
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "infrastructureFailure",
        phase: "beginOrConfigure",
        cause: new Error("transaction configuration unsupported"),
      }));
    };
  }
  return createDefaultLocatedReadCommittedTransactionRunnerV1(db);
}

async function arrangeStoreBoundary(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  vectorId: string,
  storedRunId: string,
  requestedRunId: string,
): Promise<void> {
  if (vectorId === "missing-run-is-unavailable") {
    return;
  }
  if (vectorId === "cross-scope-run-is-unavailable") {
    await persistence.query("set session_replication_role = replica");
    try {
      await persistence.query(`
        update fx_system_durable_task_run_v1
        set scope_id = '${FOREIGN_SCOPE_ID}', run_id = '${requestedRunId}'
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${storedRunId}'
      `);
    } finally {
      await persistence.query("set session_replication_role = origin");
    }
    return;
  }
  const path = malformedAggregatePath(vectorId);
  if (path === null) return;
  await persistence.query(`
    update fx_system_durable_task_run_v1
    set aggregate_json = jsonb_set(aggregate_json, '${path}', $1::jsonb)
    where scope_id = '${TASK_SCOPE_ID}' and run_id = '${storedRunId}'
  `, [malformedAggregateValue(vectorId)]);
}

async function restoreStoreBoundary(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  vectorId: string,
  storedRunId: string,
  requestedRunId: string,
): Promise<void> {
  if (vectorId !== "cross-scope-run-is-unavailable") return;
  await persistence.query("set session_replication_role = replica");
  try {
    await persistence.query(`
      update fx_system_durable_task_run_v1
      set scope_id = '${TASK_SCOPE_ID}', run_id = '${storedRunId}'
      where scope_id = '${FOREIGN_SCOPE_ID}' and run_id = '${requestedRunId}'
    `);
  } finally {
    await persistence.query("set session_replication_role = origin");
  }
}

function malformedAggregatePath(vectorId: string): string | null {
  switch (vectorId) {
    case "malformed-aggregate-decodes-as-corruption":
      return "{aggregate,version}";
    case "malformed-completion-replay-decodes-as-corruption":
      return "{aggregate,completionReplays}";
    case "malformed-evidence-decodes-as-corruption":
      return "{aggregate,lastLifecycleAcceptance,accepted,evidence}";
    case "malformed-effect-sequence-decodes-as-corruption":
      return "{aggregate,requestedEffectCursor}";
    default:
      return null;
  }
}

function malformedAggregateValue(vectorId: string): string {
  switch (vectorId) {
    case "malformed-aggregate-decodes-as-corruption":
      return JSON.stringify("not-an-aggregate-version");
    case "malformed-completion-replay-decodes-as-corruption":
    case "malformed-evidence-decodes-as-corruption":
      return JSON.stringify([{ invalid: true }]);
    case "malformed-effect-sequence-decodes-as-corruption":
      return JSON.stringify({ kind: "issued", lastSequence: "not-a-counter" });
    default:
      throw new Error(`not a malformed aggregate vector: ${vectorId}`);
  }
}

function nextCompatibilityAttemptUuid(
  aggregate: TaskRunAttemptAggregateV1,
): string {
  const ordinal = aggregate.attemptHistory.kind === "none"
    ? 1
    : Number(aggregate.attemptHistory.lastAttemptNumber) + 1;
  return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

function decodeCompatibilityVectorSuiteV1(
  value: unknown,
): CompatibilityVectorSuiteV1 {
  if (!isRecord(value) || !Array.isArray(value.vectors)
    || !Array.isArray(value.effectCursorCases)
    || !value.vectors.every(isCompatibilityVectorV1)
    || !value.effectCursorCases.every(isEffectCursorCaseV1)) {
    throw new Error("invalid admitted compatibility vector suite");
  }
  return Object.freeze({
    vectors: value.vectors,
    effectCursorCases: value.effectCursorCases,
  });
}

function isCompatibilityVectorV1(value: unknown): value is CompatibilityVectorV1 {
  return isRecord(value) && typeof value.id === "string"
    && isRecord(value.input)
    && typeof value.input.databaseNowMs === "number"
    && typeof value.input.retryRandomize === "boolean"
    && isRecord(value.initial)
    && typeof value.initial.phase === "string"
    && typeof value.initial.cancellation === "string"
    && typeof value.initial.runVersion === "number"
    && isRecord(value.command)
    && typeof value.command.operation === "string"
    && typeof value.command.identity === "string"
    && isRecord(value.expected)
    && (value.expected.kind === "receipt" || value.expected.kind === "error")
    && (value.expected.transition === null
      || typeof value.expected.transition === "string")
    && (value.expected.acceptedRunVersion === null
      || typeof value.expected.acceptedRunVersion === "number")
    && (value.expected.recordedAtMs === null
      || typeof value.expected.recordedAtMs === "number")
    && Array.isArray(value.expected.evidenceKinds)
    && Array.isArray(value.expected.effects);
}

function isEffectCursorCaseV1(
  value: unknown,
): value is CompatibilityEffectCursorCaseV1 {
  return isRecord(value) && typeof value.scenarioId === "string"
    && typeof value.priorEffectCursor === "number"
    && typeof value.resultingEffectCursor === "number";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
