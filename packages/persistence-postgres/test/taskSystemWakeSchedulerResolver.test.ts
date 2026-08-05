import { PGlite } from "@electric-sql/pglite";
import {
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  type TaskWakeRequestedEffectV1,
} from "@flarex/durable-task/internal/scheduling-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import { Effect, Result } from "effect";
import { replacementScopeIdV1FromUuid } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  createTaskSystemWakeSchedulerResolverV1,
} from "../src/taskSystemWakeSchedulerResolverV1";
import { runEffect } from "./effectTestRuntime";
import {
  TASK_LOCATOR,
  TASK_RUN_ID,
  TASK_SCOPE_ID,
  seedAdditionalTaskSystemRunV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";

const TASK_DEPLOYMENT_ID = "deployment_task_store_v1";
const MISSED_RUN_ID = "run_75000000-0000-4000-8000-000000000001";
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

describe("DTE05-D fresh Queue scheduler resolution - PGlite", () => {
  it("publishes after commit and a later hint discovers work with no prior publication", async () => {
    await withFixture(async (persistence) => {
      const published: Array<Readonly<{
        readonly kind: TaskWakeRequestedEffectV1["effect"]["kind"];
        readonly sequence: bigint;
        readonly counts: Awaited<ReturnType<typeof taskCounts>>;
      }>> = [];
      const resolver = makeResolver(persistence, attemptUuidSequence(701));
      const publisher = Object.freeze({
        publish: (requested: TaskWakeRequestedEffectV1) =>
          Effect.promise(async () => {
            published.push(Object.freeze({
              kind: requested.effect.kind,
              sequence: requested.sequence,
              counts: await taskCounts(persistence),
            }));
          }),
      });
      const scheduler = await runEffect(
        resolver.resolveEffect(TASK_DEPLOYMENT_ID, publisher),
      );

      const first = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }));

      expect(first).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 1,
      });
      expect(first.handled[0]).toMatchObject({
        runId: TASK_RUN_ID,
        disposition: "accepted",
      });
      expect(published).toEqual([{
        kind: "wake_lease_expiry",
        sequence: 2n,
        counts: { runs: 1, attempts: 1, effects: 4 },
      }]);

      // This due run deliberately has no Queue publication. A later opaque
      // partition hint still reconstructs the scheduler and discovers it.
      await seedAdditionalTaskSystemRunV1(persistence, MISSED_RUN_ID);
      const reconstructed = await runEffect(
        makeResolver(persistence, attemptUuidSequence(801)).resolveEffect(
          TASK_DEPLOYMENT_ID,
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
    });
  });

  it("proves the original hint cannot replay a derived wake after publication fails post-commit", async () => {
    await withFixture(async (persistence) => {
      const publicationFailure = Object.freeze({
        _tag: "InjectedPostCommitPublicationFailure" as const,
      });
      const resolver = makeResolver(persistence, attemptUuidSequence(901));
      const scheduler = await runEffect(resolver.resolveEffect(
        TASK_DEPLOYMENT_ID,
        { publish: () => Effect.fail(publicationFailure) },
      ));

      const observed = await runEffect(scheduler.run({
        dueKind: "start_attempt",
        cursor: null,
      }).pipe(Effect.flip));

      expect(observed).toBe(publicationFailure);
      expect(await taskCounts(persistence)).toEqual({
        runs: 1,
        attempts: 1,
        effects: 4,
      });

      let replayedPublications = 0;
      const replay = await runEffect(
        makeResolver(persistence, attemptUuidSequence(1_001)).resolveEffect(
          TASK_DEPLOYMENT_ID,
          {
            publish: () => Effect.sync(() => {
              replayedPublications += 1;
            }),
          },
        ),
      );
      const retriedOriginalHint = await runEffect(replay.run({
        dueKind: "start_attempt",
        cursor: null,
      }));

      expect(retriedOriginalHint).toMatchObject({
        stopReason: "source_exhausted",
        candidatesHandled: 0,
      });
      expect(replayedPublications).toBe(0);
    });
  });
});

function makeResolver(
  persistence: PGliteFlarexPersistence,
  randomUuid: () => string,
) {
  const runAttemptStore = {
    source: randomUuid,
    randomUuid() {
      return this.source();
    },
  };
  const retryJitterSource = makeFixedTaskRetryJitterSourceV1(retryJitter);
  const retryJitterOwner = {
    source: retryJitterSource,
    nextRetryJitter(runId: Parameters<
      typeof retryJitterSource.nextRetryJitter
    >[0]) {
      return this.source.nextRetryJitter(runId);
    },
  };
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
          createPGliteLocatedTaskSystemRunAttemptTargetV1(
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
      retryJitter: retryJitterOwner,
      runAttemptStore,
    },
  });
}

async function withFixture(
  run: (persistence: PGliteFlarexPersistence) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db: raw });
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: TASK_DEPLOYMENT_ID,
      projectId: "project_task_store_v1",
    });
    await persistence.insertScopeMetadata({
      deploymentId: TASK_DEPLOYMENT_ID,
      scopeId: replacementScopeIdV1FromUuid(TASK_SCOPE_ID.slice(6)),
      physicalLocator: TASK_LOCATOR,
    });
    await seedTaskSystemRunAttemptStoreV1(persistence);
    await run(persistence);
  } finally {
    await raw.close();
  }
}

function attemptUuidSequence(start: number): () => string {
  let ordinal = start;
  return () =>
    `75000000-0000-4000-8000-${String(ordinal++).padStart(12, "0")}`;
}

async function taskCounts(persistence: PGliteFlarexPersistence) {
  const result = await persistence.query<{
    runs: string;
    attempts: string;
    effects: string;
  }>(`
    select
      (select count(*)::text from fx_system_durable_task_run_v1) as runs,
      (select count(*)::text
       from fx_system_durable_task_attempt_identity_v1) as attempts,
      (select count(*)::text
       from fx_system_durable_task_requested_effect_v1) as effects
  `);
  return Object.freeze({
    runs: Number(result.rows[0]?.runs ?? "-1"),
    attempts: Number(result.rows[0]?.attempts ?? "-1"),
    effects: Number(result.rows[0]?.effects ?? "-1"),
  });
}
