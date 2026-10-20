import { migratedPGliteDataDir } from "../support/pgliteTestFixture";
import { fxSystemScopeExecutionAuthorities } from "../../src/database/schema";
import { useFileScopedPGliteTaskPersistence } from "./taskPGliteFixture";
import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { count, eq } from "drizzle-orm";
import { Result } from "effect";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  type PGliteFlarexPersistence,
} from "../../src/database/pglite";
import {
  TaskSystemRunReadStaleScopeAuthorityError,
  type TaskSystemRunReadQueryObserverV1,
} from "../../src/tasks/taskSystemRunReadV1";
import {
  makeTaskSystemWakeSchedulerPartitionV1,
} from "../../src/tasks/taskSystemWakeSchedulerPartitionV1";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemScopeClocks,
} from "../../src/database/schema";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";
import {
  TASK_LOCATOR,
  TASK_RUN_ID,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const EARLY_RUN_ID = "run_72000000-0000-4000-8000-000000000001";
const LATE_RUN_ID = "run_72000000-0000-4000-8000-000000000005";
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
const taskScopeId = ScopeIdSchema.make(TASK_SCOPE_ID);
const staleScopeEpoch = ScopeEpochSchema.make(
  "epoch_72000000-0000-4000-8000-000000000099",
);

beforeAll(() => migratedPGliteDataDir(), 120_000);
const withPersistence = useFileScopedPGliteTaskPersistence();

describe("DTE05-C1 located-scope scheduler composition - PGlite", () => {
  it("runs bounded Drizzle pages through the real lifecycle and resumes exactly", async () => {
    await withFixture(async ({ persistence, located }) => {
      await seedAdditionalTaskSystemRunV1(persistence, LATE_RUN_ID);
      await seedAdditionalTaskSystemRunV1(persistence, EARLY_RUN_ID);
      const observations: Parameters<TaskSystemRunReadQueryObserverV1>[0][] = [];
      const scheduler = Result.getOrThrow(
        makeTaskSystemWakeSchedulerPartitionV1(located, {
          scheduler: {
            pageSize: 2,
            maximumPages: 1,
            maximumCandidates: 10,
          },
          retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
          runRead: {
            observeQuery: observation => observations.push(observation),
          },
          runAttemptStore: {
            randomUuid: attemptUuidSequence(),
          },
        }),
      );

      const first = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(first).toMatchObject({
        stopReason: "page_budget",
        pagesRead: 1,
        candidatesHandled: 2,
      });
      expect(first.handled.map(receipt => receipt.runId)).toEqual([
        EARLY_RUN_ID,
        TASK_RUN_ID,
      ]);
      expect(first.handled.map(receipt => receipt.disposition)).toEqual([
        "accepted",
        "accepted",
      ]);

      const second = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: first.continuation,
      }));
      expect(second).toMatchObject({
        stopReason: "source_exhausted",
        pagesRead: 1,
        candidatesHandled: 1,
        continuation: null,
      });
      expect(second.handled.map(receipt => receipt.runId)).toEqual([
        LATE_RUN_ID,
      ]);

      const recovered = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(recovered).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 0,
        continuation: null,
      });
      expect(observations).toHaveLength(3);
      expect(observations.every(observation =>
        observation.name === "discoverDueRuns"
      )).toBe(true);
      await expect(taskCounts(persistence)).resolves.toEqual({
        runs: 3,
        attempts: 3,
        effects: 12,
      });
    });
  });

  it("fails before candidate handling when captured scope authority is stale", async () => {
    await withFixture(async ({ persistence, located }) => {
      const scheduler = Result.getOrThrow(
        makeTaskSystemWakeSchedulerPartitionV1(located, {
          scheduler: {
            pageSize: 10,
            maximumPages: 1,
            maximumCandidates: 10,
          },
          retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
          runAttemptStore: { randomUuid: attemptUuidSequence() },
        }),
      );
      await persistence.drizzle.update(fxSystemScopeExecutionAuthorities).set({epoch: staleScopeEpoch}).where(eq(fxSystemScopeExecutionAuthorities.scopeId, taskScopeId));

      const observed = await runEffectFailure(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));

      expect(observed).toBeInstanceOf(
        TaskSystemRunReadStaleScopeAuthorityError,
      );
      expect(observed).toMatchObject({ authority: "epoch" });
      await expect(taskCounts(persistence)).resolves.toEqual({
        runs: 1,
        attempts: 0,
        effects: 0,
      });
    });
  });
});

function attemptUuidSequence(): () => string {
  const values = [
    "72000000-0000-4000-8000-000000000101",
    "72000000-0000-4000-8000-000000000102",
    "72000000-0000-4000-8000-000000000103",
  ];
  let index = 0;
  return () => values[index++] ?? "72000000-0000-4000-8000-000000000104";
}

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  await withPersistence(async persistence => {
    await run(await makeFixture(persistence));
  });
}

async function makeFixture(persistence: PGliteFlarexPersistence) {
  await seedTaskSystemRunAttemptStoreV1(persistence);
  const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const located = await locatedTaskAuthorityV1(persistence.drizzle, target);
  return Object.freeze({ persistence, located });
}

async function taskCounts(
  persistence: PGliteFlarexPersistence,
) {
  const [[runs], [attempts], [effects]] = await Promise.all([
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskRunsV1,
    ),
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskAttemptIdentitiesV1,
    ),
    persistence.drizzle.select({ count: count() }).from(
      fxSystemDurableTaskRequestedEffectsV1,
    ),
  ]);
  return {
    runs: runs?.count ?? -1,
    attempts: attempts?.count ?? -1,
    effects: effects?.count ?? -1,
  };
}
