import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  TaskWakeRequestedEffectV1,
} from "@flarex/durable-task/internal/scheduling-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createTaskSystemWakeSchedulerResolverV1,
} from "../src/taskSystemWakeSchedulerResolverV1";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";
import {
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const MISSED_RUN_ID = "run_76000000-0000-4000-8000-000000000001";
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

describe("DTE05-D PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-D.",
    ).not.toBeNull();
  });
});

describePostgres("DTE05-D fresh Queue scheduler resolution - PostgreSQL", () => {
  it("publishes after commit and repairs omitted publication through later discovery", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const parent = await seedRegisteredTaskSystemParentV1(
        persistence,
        "dte05-d:task-queue-wake-parent",
      );
      await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
      const published: Array<Readonly<{
        readonly kind: TaskWakeRequestedEffectV1["effect"]["kind"];
        readonly sequence: bigint;
        readonly counts: Awaited<ReturnType<typeof taskCounts>>;
      }>> = [];
      const resolver = makeResolver(persistence, attemptUuidSequence(901));
      const scheduler = await runEffect(resolver.resolveEffect(
        parent.deploymentId,
        {
          publish: requested => Effect.promise(async () => {
            published.push(Object.freeze({
              kind: requested.effect.kind,
              sequence: requested.sequence,
              counts: await taskCounts(persistence),
            }));
          }),
        },
      ));

      const accepted = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(accepted).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 1,
      });
      expect(published).toEqual([{
        kind: "wake_lease_expiry",
        sequence: 2n,
        counts: { runs: 1, attempts: 1, effects: 4 },
      }]);

      await seedAdditionalTaskSystemRunV1(
        persistence,
        MISSED_RUN_ID,
        parent.scopeId,
      );
      const reconstructed = await runEffect(
        makeResolver(persistence, attemptUuidSequence(1_001)).resolveEffect(
          parent.deploymentId,
          { publish: () => Effect.void },
        ),
      );
      const repaired = await runEffect(reconstructed.run({
        dueKind: "start_attempt",
        cursor: null,
      }));
      expect(repaired).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 1,
      });
      expect(repaired.handled[0]).toMatchObject({
        runId: MISSED_RUN_ID,
        disposition: "accepted",
      });
    }, { historicalApplicationAnalysis: true });
  });
});

function makeResolver(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
) {
  return createTaskSystemWakeSchedulerResolverV1({
    authority: {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared Task scope must not read split receipts.");
        },
      },
      scopeClockTargets: {
        resolve: async (physicalLocator) =>
          createPostgresLocatedTaskSystemRunAttemptTargetV1(
            persistence,
            physicalLocator,
          ),
      },
    },
    partition: {
      scheduler: {
        pageSize: 10,
        maximumPages: 10,
        maximumCandidates: 100,
      },
      retryJitter: makeFixedTaskRetryJitterSourceV1(retryJitter),
      runAttemptStore: { randomUuid },
    },
  });
}

function attemptUuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `76000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
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
