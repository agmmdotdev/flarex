import { PGlite } from "@electric-sql/pglite";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskDurationMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  encodeTaskRunCreationAuthorityReceiptPreimageV1,
  hashTaskRunCreationAuthorityReceiptV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  TaskSystemRunCreationBindingError,
  TaskSystemRunCreationCorruptionError,
  TaskSystemRunCreationStaleScopeAuthorityError,
  TaskSystemRunCreationTerminalStoreError,
  makeTaskSystemRunCreationStoreV1,
} from "../src/taskSystemRunCreationV1";
import { makeTaskSystemRunAttemptStoreV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  TASK_DEFINITION_ID,
  TASK_LOCATOR,
  TASK_SCOPE_ID,
  locatedTaskAuthorityV1,
  seedTaskSystemRunAttemptStoreV1,
} from "./taskSystemRunAttemptStoreTestSupport";
import {
  TASK_SYSTEM_CREATION_ATTEMPT_UUID as ATTEMPT_UUID,
  TASK_SYSTEM_CREATION_RUN_UUID_A as RUN_UUID_A,
  TASK_SYSTEM_CREATION_RUN_UUID_B as RUN_UUID_B,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRequestV1 as creationRequest,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1 as creationStore,
  taskSystemCreationCountsV1 as taskCounts,
  taskSystemCreationDigestV1 as digest,
  taskSystemCreationImmediateRetryThresholdMsV1 as immediateRetryThresholdMs,
  taskSystemCreationLeaseDurationMsV1 as leaseDurationMs,
  taskSystemCreationRetryJitterV1 as retryJitter,
  taskSystemCreationSha256V1 as sha256,
  taskSystemCreationSuccessV1 as success,
} from "./taskSystemRunCreationTestSupport";

describe("DTE04-C scope-bound Task System run creation - PGlite", () => {
  it("creates the only legal initial state and interoperates with lifecycle", async () => {
    await withFixture(async fixture => {
      const store = creationStore(fixture, {
        randomUuid: () => RUN_UUID_A,
      });
      const created = await runEffect(store.createRun(fixture.request));
      expect(created).toMatchObject({
        status: "created",
        version: 1,
        runId: `run_${RUN_UUID_A}`,
        taskDefinitionRevisionId: TASK_DEFINITION_ID,
      });
      expect(created.createdAtMs).toBeGreaterThan(0);

      const initialCounts = await taskCounts(fixture.persistence);
      expect(initialCounts).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });

      const lifecycleStore = makeTaskSystemRunAttemptStoreV1(fixture.located, {
        randomUuid: () => ATTEMPT_UUID,
      });
      const inspected = await runEffect(lifecycleStore.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: created.runId,
      }));
      expect(inspected.current).toMatchObject({
        runId: created.runId,
        taskDefinitionRevisionId: TASK_DEFINITION_ID,
        createdAtMs: created.createdAtMs,
        runVersion: 1n,
        phase: "ready",
        ready: { kind: "initial", eligibleAtMs: created.createdAtMs },
        attemptHistory: { kind: "none" },
        leaseHistory: { kind: "none" },
        requestedEffectCursor: { kind: "none" },
        cancellation: { kind: "not_requested", generation: 0n },
      });

      const layer = RunAttemptLifecycleLive.pipe(
        Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, lifecycleStore)),
      );
      const started = await runEffect(Effect.gen(function* () {
        const lifecycle = yield* RunAttemptLifecycle;
        return yield* lifecycle.startAttempt({
          type: "start_attempt",
          runId: created.runId,
          expectedRunVersion: inspected.current.runVersion,
          retryJitter,
        });
      }).pipe(Effect.provide(layer)));
      expect(started.disposition).toBe("accepted");

      let replayAllocations = 0;
      const replayOnly = creationStore(fixture, {
        randomUuid: () => {
          replayAllocations += 1;
          throw new Error("exact replay must not allocate a run ID");
        },
      });
      await expect(runEffect(replayOnly.createRun(fixture.request)))
        .resolves.toEqual(created);
      expect(replayAllocations).toBe(0);
    });
  });

  it("returns stable replay, rejects conflicting reuse, and retries run-ID collision", async () => {
    await withFixture(async fixture => {
      const firstStore = creationStore(fixture, {
        randomUuid: () => RUN_UUID_A,
      });
      const first = await runEffect(firstStore.createRun(fixture.request));
      await expect(runEffect(firstStore.createRun(fixture.request)))
        .resolves.toEqual(first);

      await expect(runEffectFailure(firstStore.createRun(
        creationRequest("request-a", 0x66),
      )))
        .resolves.toMatchObject({
          _tag: "TaskRunCreationIdempotencyConflictError",
          requestKey: "request-a",
          reason: "request_digest_mismatch",
        });
      expect(await taskCounts(fixture.persistence)).toMatchObject({
        runs: 1,
        requests: 1,
      });

      const allocated = [RUN_UUID_A, RUN_UUID_B];
      let allocationIndex = 0;
      const collisionRetryStore = creationStore(fixture, {
          randomUuid: () => allocated[allocationIndex++]!,
      });
      const second = await runEffect(collisionRetryStore.createRun(
        creationRequest("request-b", 0x55),
      ));
      expect(second.runId).toBe(`run_${RUN_UUID_B}`);
      expect(allocationIndex).toBe(2);
      expect(await taskCounts(fixture.persistence)).toEqual({
        runs: 2,
        requests: 2,
        attempts: 0,
        effects: 0,
      });

      let exhaustedAllocations = 0;
      const exhaustedStore = creationStore(fixture, {
        randomUuid: () => {
          exhaustedAllocations += 1;
          return RUN_UUID_A;
        },
      });
      const exhausted = await runEffectFailure(exhaustedStore.createRun(
        creationRequest("request-c", 0x55),
      ));
      expect(exhausted).toBeInstanceOf(
        TaskSystemRunCreationTerminalStoreError,
      );
      expect(exhausted).toMatchObject({
        reason: "identity_allocation_exhausted",
      });
      expect(exhaustedAllocations).toBe(3);
      expect(await taskCounts(fixture.persistence)).toEqual({
        runs: 2,
        requests: 2,
        attempts: 0,
        effects: 0,
      });
    });
  });

  it("captures trusted factory options before lazy execution", async () => {
    await withFixture(async fixture => {
      const alternateBinding = success(decodeTaskDefinitionRuntimeBindingV1({
        ...fixture.runtimeBinding,
        artifactSha256: digest(0x77),
      }));
      const alternateAuthority = success(
        decodeTaskRunCreationAuthorityReceiptV1({
          ...fixture.creationAuthority,
          taskDefinitionRevisionId:
            "taskdef_73000000-0000-4000-8000-000000000008",
        }),
      );
      const options = {
        sha256,
        runtimeBinding: fixture.runtimeBinding,
        creationAuthority: fixture.creationAuthority,
        leaseDurationMs,
        immediateRetryThresholdMs,
        randomUuid: () => RUN_UUID_A,
      };
      const store = makeTaskSystemRunCreationStoreV1(fixture.located, options);
      options.sha256 = (() => {
        throw new Error("captured hasher must be used");
      }) as typeof sha256;
      options.runtimeBinding = alternateBinding;
      options.creationAuthority = alternateAuthority;
      options.leaseDurationMs = success(decodeTaskDurationMsV1(60_000));
      options.immediateRetryThresholdMs = success(
        decodeTaskDurationMsV1(15_000),
      );
      options.randomUuid = () => RUN_UUID_B;

      const created = await runEffect(store.createRun(fixture.request));
      expect(created.runId).toBe(`run_${RUN_UUID_A}`);
    });
  });

  it("converges concurrent exact creation onto one stable receipt", async () => {
    await withFixture(async fixture => {
      const stores = [RUN_UUID_A, RUN_UUID_B].map(randomUuid =>
        creationStore(fixture, {
          randomUuid: () => randomUuid,
        })
      );
      const [first, second] = await Promise.all(
        stores.map(store => runEffect(store.createRun(fixture.request))),
      );
      expect(second).toEqual(first);
      expect([`run_${RUN_UUID_A}`, `run_${RUN_UUID_B}`]).toContain(
        first!.runId,
      );
      expect(await taskCounts(fixture.persistence)).toEqual({
        runs: 1,
        requests: 1,
        attempts: 0,
        effects: 0,
      });
    });
  });

  it("fails closed on immutable binding, authority evidence, and stale scope", async () => {
    await withFixture(async fixture => {
      const store = creationStore(fixture, {
        randomUuid: () => RUN_UUID_A,
      });
      const authorityMismatchStore = creationStore(fixture, {
        randomUuid: () => RUN_UUID_A,
        creationAuthority: success(
          decodeTaskRunCreationAuthorityReceiptV1({
            ...fixture.creationAuthority,
            taskDefinitionRevisionId:
              "taskdef_73000000-0000-4000-8000-000000000008",
          }),
        ),
      });
      const authorityMismatch = await runEffectFailure(
        authorityMismatchStore.createRun(fixture.request),
      );
      expect(authorityMismatch).toBeInstanceOf(
        TaskSystemRunCreationBindingError,
      );
      expect(authorityMismatch).toMatchObject({
        reason: "request_authority_mismatch",
      });
      const mismatchedBinding = success(decodeTaskDefinitionRuntimeBindingV1({
        ...fixture.runtimeBinding,
        artifactSha256: digest(0x77),
      }));
      const bindingFailure = await runEffectFailure(creationStore(fixture, {
        randomUuid: () => RUN_UUID_A,
        runtimeBinding: mismatchedBinding,
      }).createRun(fixture.request));
      expect(bindingFailure).toBeInstanceOf(TaskSystemRunCreationBindingError);
      expect(bindingFailure).toMatchObject({
        reason: "stored_binding_mismatch",
      });
      expect(await taskCounts(fixture.persistence)).toMatchObject({
        runs: 0,
        requests: 0,
      });

      const created = await runEffect(store.createRun(fixture.request));
      const forgedAuthority = success(
        decodeTaskRunCreationAuthorityReceiptV1({
          ...fixture.creationAuthority,
          applicationRevisionId: "apprev_task_store_v2",
        }),
      );
      const forgedBytes = success(
        encodeTaskRunCreationAuthorityReceiptPreimageV1(forgedAuthority),
      );
      const forgedSha256 = await runEffect(
        hashTaskRunCreationAuthorityReceiptV1(forgedAuthority, sha256),
      );
      await fixture.persistence.query(`
        update fx_system_durable_task_run_v1
        set creation_authority_bytes = $1,
            creation_authority_sha256 = $2,
            creation_authority_byte_length = $3
        where scope_id = '${TASK_SCOPE_ID}' and run_id = '${created.runId}'
      `, [forgedBytes, forgedSha256, BigInt(forgedBytes.byteLength)]);
      const corruptionFailure = await runEffectFailure(
        store.createRun(fixture.request),
      );
      expect(corruptionFailure).toBeInstanceOf(
        TaskSystemRunCreationCorruptionError,
      );
      expect(corruptionFailure).toMatchObject({
        reason: "creation_authority_invalid",
      });

      await fixture.persistence.query(`
        update fx_system_scope_clock
        set epoch = 'epoch_73000000-0000-4000-8000-000000000009'
        where scope_id = '${TASK_SCOPE_ID}'
      `);
      const staleFailure = await runEffectFailure(store.createRun(
        creationRequest("request-stale", 0x55),
      ));
      expect(staleFailure).toBeInstanceOf(
        TaskSystemRunCreationStaleScopeAuthorityError,
      );
      expect(staleFailure).toMatchObject({ authority: "epoch" });
    });
  });
});

async function withFixture(
  run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>,
): Promise<void> {
  const raw = new PGlite();
  try {
    await run(await makeFixture(raw));
  } finally {
    await raw.close();
  }
}

async function makeFixture(raw: PGlite) {
  const persistence = await createPGlitePersistence({ db: raw });
  await persistence.migrate();
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
  return {
    persistence,
    located,
    request: creationRequest("request-a", 0x55),
    runtimeBinding,
    creationAuthority,
  };
}
