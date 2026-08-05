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

const DEFERRED_HISTORY_REASONS = Object.freeze({
  "start-durable-retry-due": "non_transition_cursor",
  "effect-sequence-overflow-rejected": "explicit_corruption_setup",
} satisfies Readonly<Record<string, CompatibilityHistoryDeferralReasonV1>>);

type CompatibilityHistoryDeferralReasonV1 =
  | "non_transition_cursor"
  | "explicit_corruption_setup";

const COMMAND_BOUNDARY_VECTOR_IDS = Object.freeze([
  "invalid-command-is-redacted",
  "waitpoint-completion-outside-v1",
]);

const suite = decodeCompatibilityVectorSuiteV1(suiteJson);

describe("DTE04-B canonical compatibility lane - PGlite adapter", () => {
  it("executes every transition-derived vector through the adapter", async () => {
    const raw = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db: raw });
      await persistence.migrate();
      await seedTaskSystemRunAttemptStoreV1(persistence);
      const prepared = prepareCompatibilityVectorsV1(
        suite.vectors,
        suite.effectCursorCases,
      );
      let storeVectors = 0;
      const commandBoundaryVectors: string[] = [];
      const deferredHistoryVectors: Array<Readonly<{
        readonly id: string;
        readonly reason: CompatibilityHistoryDeferralReasonV1;
      }>> = [];

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
        if (entry.persistence === null) {
          const reason = Object.entries(DEFERRED_HISTORY_REASONS)
            .find(([id]) => id === vector.id)?.[1];
          expect(reason, `unexpected deferred vector: ${vector.id}`).toBeDefined();
          if (reason === undefined) {
            throw new Error(`unexpected deferred vector: ${vector.id}`);
          }
          deferredHistoryVectors.push(Object.freeze({ id: vector.id, reason }));
          expect(entry.execution.actual, vector.id).toEqual(
            normalizeExpectedV1(vector.expected),
          );
          continue;
        }
        storeVectors += 1;
        const persisted = entry.persistence;
        await resetCompatibilityTaskRunV1(persistence, persisted.current);
        if (
          vector.id !== "missing-run-is-unavailable"
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
          persisted.current.runId,
          entry.command.runId,
        );

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
          randomUuid: () => nextCompatibilityAttemptUuid(persisted.current),
        });
        try {
          const effect = runCompatibilityCommand(entry.command, store);
          const actual = vector.expected.kind === "receipt"
            ? normalizeCompatibilityReceiptV1(await runEffect(effect))
            : normalizeCompatibilityLifecycleFailureV1(
                await runEffectFailure(effect),
              );
          expect(actual, vector.id).toEqual(normalizeExpectedV1(vector.expected));
        } catch (cause) {
          throw new Error(`compatibility adapter vector failed: ${vector.id}`, {
            cause,
          });
        } finally {
          await restoreStoreBoundary(
            persistence,
            vector.id,
            persisted.current.runId,
            entry.command.runId,
          );
        }
      }

      expect(storeVectors).toBe(61);
      expect(commandBoundaryVectors).toEqual(COMMAND_BOUNDARY_VECTOR_IDS);
      expect(deferredHistoryVectors).toEqual(
        Object.entries(DEFERRED_HISTORY_REASONS).map(([id, reason]) => ({
          id,
          reason,
        })),
      );
    } finally {
      await raw.close();
    }
  }, 120_000);
});

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
