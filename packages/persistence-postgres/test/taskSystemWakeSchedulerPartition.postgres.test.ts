import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  makeTaskSystemWakeSchedulerPartitionV1,
} from "../src/taskSystemWakeSchedulerPartitionV1";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  TASK_LOCATOR,
  TASK_RUN_ID,
  locatedTaskAuthorityV1,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const EARLY_RUN_ID = "run_72000000-0000-4000-8000-000000000001";
const LATE_RUN_ID = "run_72000000-0000-4000-8000-000000000005";
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

describe("DTE05-C1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-C1.",
    ).not.toBeNull();
  });
});

describePostgres("DTE05-C1 located-scope scheduler composition - PostgreSQL", () => {
  it("resumes a durable page after reconstructing the scope-bound scheduler", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const seeded = await seedTaskSystemRunAttemptStoreV1(persistence);
      await seedAdditionalTaskSystemRunV1(
        persistence,
        LATE_RUN_ID,
        seeded.scopeId,
      );
      await seedAdditionalTaskSystemRunV1(
        persistence,
        EARLY_RUN_ID,
        seeded.scopeId,
      );
      const target = createPostgresLocatedTaskSystemRunAttemptTargetV1(
        persistence,
        TASK_LOCATOR,
      );
      const located = await locatedTaskAuthorityV1(
        persistence.drizzle,
        target,
        seeded.scopeId,
        seeded.deploymentId,
      );
      const firstScheduler = makeScheduler(located, attemptUuidSequence(201));
      const first = await runEffect(firstScheduler.run({
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

      const reconstructed = makeScheduler(
        located,
        attemptUuidSequence(203),
      );
      const second = await runEffect(reconstructed.run({
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
      await expect(taskCounts(persistence)).resolves.toEqual({
        runs: 3,
        attempts: 3,
        effects: 12,
      });
    });
  });
});

function makeScheduler(
  located: Parameters<typeof makeTaskSystemWakeSchedulerPartitionV1>[0],
  randomUuid: () => string,
) {
  return Result.getOrThrow(makeTaskSystemWakeSchedulerPartitionV1(located, {
    scheduler: {
      pageSize: 2,
      maximumPages: 1,
      maximumCandidates: 10,
    },
    retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
    runAttemptStore: { randomUuid },
  }));
}

function attemptUuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `72000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
}

async function taskCounts(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query<{
    runs: number;
    attempts: number;
    effects: number;
  }>(`
    select
      (select count(*)::int from fx_system_durable_task_run_v1) as runs,
      (select count(*)::int
       from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*)::int
       from fx_system_durable_task_requested_effect_v1) as effects
  `);
  const counts = result.rows[0];
  if (counts === undefined) throw new Error("task counts returned no row");
  return Object.freeze(counts);
}
