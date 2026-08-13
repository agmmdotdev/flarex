import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
} from "@flarex/persistence-postgres/pglite";
import {
  makeTaskRunCreationCoordinator,
} from "flarex-backend/internal/task-run-creation";
import {
  makeTaskRunInputStore,
} from "flarex-backend/internal/task-run-input-store";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TASK_DEFINITION_ID,
  TASK_LOCATOR,
  TASK_SCOPE_ID,
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
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import {
  MemoryTaskRunInputBucket,
  runInputCreationCommand,
} from "../support/taskRunInputCreationSupport";

describe("DTE04-TRI2 run-input creation composition - PGlite", () => {
  it("publishes before creation and converges exact replay", async () => {
    const fixture = await makeFixture();
    const bucket = new MemoryTaskRunInputBucket();
    const coordinator = coordinatorFor(fixture, bucket);
    const command = runInputCreationCommand(
      "tri2:pglite:exact",
      TASK_DEFINITION_ID,
      { orderId: "order-exact", quantity: 2n },
    );

    const first = await Effect.runPromise(coordinator.create(command));
    const replay = await Effect.runPromise(coordinator.create(command));

    expect(replay).toEqual(first);
    expect(bucket.putCalls).toBe(2);
    expect(bucket.values.size).toBe(1);
    expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
      runs: 1,
      requests: 1,
      attempts: 0,
      effects: 0,
    });
  });

  it("short-circuits the transaction when input publication cannot settle", async () => {
    const fixture = await makeFixture();
    const bucket = new MemoryTaskRunInputBucket();
    bucket.rejectPuts = true;
    bucket.rejectGets = true;
    const coordinator = coordinatorFor(fixture, bucket);

    const failure = await effectError(coordinator.create(
      runInputCreationCommand(
        "tri2:pglite:object-failure",
        TASK_DEFINITION_ID,
        { orderId: "object-failure" },
      ),
    ));
    expect(failure).toMatchObject({
      _tag: "TaskRunInputStoreSettlementUncertainError",
    });
    expect(await taskSystemCreationCountsV1(fixture.persistence)).toEqual({
      runs: 0,
      requests: 0,
      attempts: 0,
      effects: 0,
    });
  });

  it("retains the inert body after rollback and preserves request-key conflict", async () => {
    const fixture = await makeFixture();
    const bucket = new MemoryTaskRunInputBucket();
    const coordinator = coordinatorFor(fixture, bucket);
    await fixture.persistence.query(`
      update fx_system_scope_clock
      set epoch = 'epoch_73000000-0000-4000-8000-000000000099'
      where scope_id = '${TASK_SCOPE_ID}'
    `);

    const stale = await effectError(coordinator.create(
      runInputCreationCommand(
        "tri2:pglite:rollback",
        TASK_DEFINITION_ID,
        { orderId: "rollback" },
      ),
    ));
    expect(stale).toMatchObject({
      _tag: "TaskSystemRunCreationStaleScopeAuthorityError",
    });
    expect(bucket.values.size).toBe(1);
    expect(bucket.deleteCalls).toBe(0);
    expect(await taskSystemCreationCountsV1(fixture.persistence)).toMatchObject({
      runs: 0,
      requests: 0,
    });

    const fresh = await makeFixture();
    const freshBucket = new MemoryTaskRunInputBucket();
    const freshCoordinator = coordinatorFor(fresh, freshBucket);
    await Effect.runPromise(freshCoordinator.create(runInputCreationCommand(
      "tri2:pglite:conflict",
      TASK_DEFINITION_ID,
      { orderId: "first" },
    )));
    const conflict = await effectError(freshCoordinator.create(
      runInputCreationCommand(
        "tri2:pglite:conflict",
        TASK_DEFINITION_ID,
        { orderId: "second" },
      ),
    ));
    expect(conflict).toMatchObject({
      _tag: "TaskRunCreationIdempotencyConflictError",
      requestKey: "tri2:pglite:conflict",
    });
    expect(freshBucket.values.size).toBe(2);
    expect(freshBucket.deleteCalls).toBe(0);
    expect(await taskSystemCreationCountsV1(fresh.persistence)).toMatchObject({
      runs: 1,
      requests: 1,
    });
  });
});

async function makeFixture() {
  const persistence = await createMigratedPGlitePersistence();
  await seedTaskSystemRunAttemptStoreV1(persistence);
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = '${TASK_SCOPE_ID}'
  `);
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1();
  const creationAuthority = makeTaskSystemCreationAuthorityV1();
  await installTaskSystemCreationRuntimeBindingV1(
    persistence.drizzle,
    runtimeBinding,
    creationAuthority,
  );
  const target = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    TASK_LOCATOR,
  );
  const located = await locatedTaskAuthorityV1(
    persistence.drizzle,
    target,
  );
  return Object.freeze({
    persistence,
    located,
    runtimeBinding,
    creationAuthority,
  });
}

function coordinatorFor(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  bucket: MemoryTaskRunInputBucket,
) {
  const creationPort = makeTaskSystemCreationStoreForTestV1(fixture, {
    randomUuid: () => TASK_SYSTEM_CREATION_RUN_UUID_A,
  });
  return Result.getOrThrow(makeTaskRunCreationCoordinator(
    makeTaskRunInputStore(bucket),
    creationPort,
  ));
}

async function effectError(effect: Effect.Effect<unknown, unknown>) {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error("Expected operation to fail.");
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
}
