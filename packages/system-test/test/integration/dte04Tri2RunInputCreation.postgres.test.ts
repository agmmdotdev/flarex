import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "@flarex/persistence-postgres/internal/system-test/postgresLocatedReadCommitted";
import {
  makeTaskRunCreationCoordinator,
} from "flarex-backend/internal/task-run-creation";
import {
  makeTaskRunInputStore,
} from "flarex-backend/internal/task-run-input-store";
import { Cause, Effect, Encoding, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createLocatedTaskSystemRunAttemptTargetV1,
} from "../../../persistence-postgres/src/taskSystemRunAttemptStoreV1.js";
import {
  TASK_LOCATOR,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "../../../persistence-postgres/test/taskSystemRunAttemptStoreTestSupport.js";
import {
  TASK_SYSTEM_CREATION_RUN_UUID_A,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1,
  taskSystemCreationCountsV1,
} from "../../../persistence-postgres/test/taskSystemRunCreationTestSupport.js";
import {
  seedRegisteredTaskSystemParentV1,
} from "../../../persistence-postgres/test/taskSystemPostgresTestSupport.js";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";
import {
  MemoryTaskRunInputBucket,
  runInputCreationCommand,
} from "../support/taskRunInputCreationSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("DTE04-TRI2 run-input creation composition - PostgreSQL", () => {
  it("replays the exact input and request after a hidden committed creation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await makeFixture(persistence);
      let releaseCalls = 0;
      const hiddenRelease = new Error("hide committed TRI2 creation response");
      const runner = createPostgresLocatedReadCommittedTransactionRunnerV1(
        persistence.pool,
        {
          release: (client, discard) => {
            releaseCalls += 1;
            if (releaseCalls === 1 && discard === undefined) {
              throw hiddenRelease;
            }
            client.release(discard);
          },
        },
      );
      const hiddenTarget = createLocatedTaskSystemRunAttemptTargetV1(
        persistence.drizzle,
        TASK_LOCATOR,
        runner,
      );
      const hiddenLocated = await locatedTaskAuthorityV1(
        persistence.drizzle,
        hiddenTarget,
        fixture.scopeId,
        fixture.deploymentId,
      );
      const hiddenPort = makeTaskSystemCreationStoreForTestV1({
        ...fixture,
        located: hiddenLocated,
      }, {
        randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
      });
      const bucket = new MemoryTaskRunInputBucket();
      const hiddenCoordinator = Result.getOrThrow(
        makeTaskRunCreationCoordinator(
          makeTaskRunInputStore(bucket),
          hiddenPort,
        ),
      );
      const command = runInputCreationCommand(
        "tri2:postgres:hidden-commit",
        fixture.creationAuthority.taskDefinitionRevisionId,
        { orderId: "postgres-hidden", quantity: 3n },
      );

      const hiddenFailure = await effectError(
        hiddenCoordinator.create(command),
      );
      expect(hiddenFailure).toMatchObject({
        _tag: "TaskSystemRunCreationTransientStoreError",
        reason: "driver_failure",
      });
      expect(releaseCalls).toBe(1);
      expect(bucket.values.size).toBe(1);
      expect(bucket.deleteCalls).toBe(0);
      expect(await taskSystemCreationCountsV1(persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });

      let replayAllocations = 0;
      const replayPort = makeTaskSystemCreationStoreForTestV1(fixture, {
        randomUuid: () => {
          replayAllocations += 1;
          throw new Error("TRI2 exact replay must not allocate a run ID");
        },
      });
      const replayCoordinator = Result.getOrThrow(
        makeTaskRunCreationCoordinator(
          makeTaskRunInputStore(bucket),
          replayPort,
        ),
      );
      const replay = await Effect.runPromise(replayCoordinator.create(command));

      expect(replay.runId).toBe(`run_${TASK_SYSTEM_CREATION_RUN_UUID_A}`);
      expect(replayAllocations).toBe(0);
      expect(bucket.putCalls).toBe(2);
      expect(bucket.values.size).toBe(1);
      expect(bucket.deleteCalls).toBe(0);
      expect(await taskSystemCreationCountsV1(persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
    });
  }, 480_000);
});

async function makeFixture(persistence: PostgresFlarexPersistence) {
  const parent = await seedRegisteredTaskSystemParentV1(
    persistence,
    "dte04-tri2:task-creation-parent",
  );
  const seeded = await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = $1
  `, [seeded.scopeId]);
  const candidateSha256 = Result.getOrThrow(
    Encoding.decodeHex(parent.candidateSha256Hex),
  );
  const identity = Object.freeze({
    applicationRevisionId: parent.applicationRevisionId,
    candidateSha256,
  });
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1(identity);
  const creationAuthority = makeTaskSystemCreationAuthorityV1(identity);
  await installTaskSystemCreationRuntimeBindingV1(
    persistence.drizzle,
    runtimeBinding,
    creationAuthority,
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
  return Object.freeze({
    persistence,
    scopeId: seeded.scopeId,
    deploymentId: seeded.deploymentId,
    located,
    runtimeBinding,
    creationAuthority,
  });
}

async function effectError(effect: Effect.Effect<unknown, unknown>) {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error("Expected operation to fail.");
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
}
