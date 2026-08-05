import { PGlite } from "@electric-sql/pglite";
import {
  decodeTaskRunCreationRequestV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskDurationMsV1,
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  decodeTaskRuntimeEntryFrameV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  encodeTaskRunCreationAuthorityReceiptPreimageV1,
  hashCanonicalTaskCatalogV1,
  hashTaskDefinitionRuntimeBindingV1,
  hashTaskRunCreationAuthorityReceiptV1,
  hashTaskRuntimeEntryFrameV1,
  makeStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { eq } from "drizzle-orm";
import { Effect, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import { fxSystemDurableTaskDefinitionRevisionsV1 } from "../src/schema";
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

const RUN_UUID_A = "73000000-0000-4000-8000-000000000001";
const RUN_UUID_B = "73000000-0000-4000-8000-000000000002";
const ATTEMPT_UUID = "73000000-0000-4000-8000-000000000003";
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const leaseDurationMs = Result.getOrThrow(decodeTaskDurationMsV1(30_000));
const immediateRetryThresholdMs = Result.getOrThrow(
  decodeTaskDurationMsV1(5_000),
);
const retryJitter = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));

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
  const runtimeBinding = await makeRuntimeBinding();
  const bindingBytes = success(
    encodeTaskDefinitionRuntimeBindingPreimageV1(runtimeBinding),
  );
  const bindingSha256 = await runEffect(
    hashTaskDefinitionRuntimeBindingV1(runtimeBinding, sha256),
  );
  await persistence.drizzle.update(
    fxSystemDurableTaskDefinitionRevisionsV1,
  ).set({
    taskId: runtimeBinding.taskId,
    applicationRevisionId: runtimeBinding.applicationRevisionId,
    candidateSha256: runtimeBinding.candidateSha256,
    bindingCodecVersion: 1,
    bindingByteLength: BigInt(bindingBytes.byteLength),
    bindingSha256,
    bindingBytes,
    applicationRevisionTaskBindingSha256:
      runtimeBinding.applicationRevisionTaskBindingSha256,
    canonicalTaskManifestSha256:
      runtimeBinding.canonicalTaskManifestSha256,
    taskRuntimeEntrySha256: runtimeBinding.taskRuntimeEntrySha256,
    taskCatalogSha256: runtimeBinding.taskCatalogSha256,
    taskEntryRootSha256: runtimeBinding.taskEntryRootSha256,
    taskRuntimeProjectionSha256:
      runtimeBinding.taskRuntimeProjectionSha256,
    taskRuntimeGroupManifestSha256:
      runtimeBinding.taskRuntimeGroupManifestSha256,
    taskRuntimeMaterializationSpecSha256:
      runtimeBinding.taskRuntimeMaterializationSpecSha256,
    packageSha256: runtimeBinding.packageSha256,
    artifactSha256: runtimeBinding.artifactSha256,
    sourceRootSha256: runtimeBinding.sourceRootSha256,
    semanticRootSha256: runtimeBinding.semanticRootSha256,
  }).where(eq(
    fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
    success(decodeTaskRunCreationAuthorityReceiptV1(
      creationAuthority(),
    )).taskDefinitionRevisionId,
  ));
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
    creationAuthority: success(
      decodeTaskRunCreationAuthorityReceiptV1(creationAuthority()),
    ),
  };
}

function creationStore(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  options: Readonly<{
    readonly randomUuid: () => string;
    readonly runtimeBinding?: TaskDefinitionRuntimeBindingV1;
    readonly creationAuthority?: Awaited<
      ReturnType<typeof makeFixture>
    >["creationAuthority"];
  }>,
) {
  return makeTaskSystemRunCreationStoreV1(fixture.located, {
    sha256,
    runtimeBinding: options.runtimeBinding ?? fixture.runtimeBinding,
    creationAuthority:
      options.creationAuthority ?? fixture.creationAuthority,
    leaseDurationMs,
    immediateRetryThresholdMs,
    randomUuid: options.randomUuid,
  });
}

async function makeRuntimeBinding(): Promise<TaskDefinitionRuntimeBindingV1> {
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [{
      version: 1,
      taskId: "orders.process",
      handler: {
        logicalModulePath: "tasks/orders",
        artifactModulePath: "tasks/orders.js",
        exportName: "run",
      },
      payloadValidator: {
        type: "object",
        value: {
          orderId: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
      outputValidator: null,
      runAttemptPolicy: {
        version: 1,
        retry: {
          maxAttempts: 3,
          factor: 2,
          minTimeoutInMs: 1_000,
          maxTimeoutInMs: 60_000,
          randomize: true,
        },
        outOfMemory: { kind: "disabled" },
      },
      maximumDurationInSeconds: 300,
      computeProfile: "standard-1x",
      queue: { kind: "default" },
    }],
  }, sha256));
  const entry = success(decodeTaskRuntimeEntryFrameV1({
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: catalog.entries[0]!.taskId,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    logicalExecutionModule: "tasks/orders",
    artifactExecutionModule: "tasks/orders.js",
    exportName: "run",
    group: "durable_task",
    projectionSha256: digest(0x50),
  }));
  const entrySha256 = await runEffect(
    hashTaskRuntimeEntryFrameV1(entry, sha256),
  );
  return success(decodeTaskDefinitionRuntimeBindingV1({
    version: 1,
    applicationRevisionId: "apprev_task_store_v1",
    candidateSha256: digest(0x31),
    applicationRevisionTaskBindingSha256: digest(0x42),
    taskId: catalog.entries[0]!.taskId,
    manifest: catalog.entries[0]!.manifest,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    taskRuntimeEntrySha256: entrySha256,
    taskRuntimeEntry: entry,
    taskCatalogSha256: catalog.taskCatalogSha256,
    taskEntryRootSha256: digest(0x43),
    taskRuntimeProjectionSha256: digest(0x50),
    taskRuntimeGroupManifestSha256: digest(0x51),
    taskRuntimeMaterializationSpecSha256: digest(0x52),
    packageSha256: digest(0x53),
    artifactSha256: digest(0x54),
    sourceRootSha256: digest(0x55),
    semanticRootSha256: digest(0x56),
    runtimeObjects: [
      objectReference("runtime_projection_module", digest(0x57), 100n),
      objectReference("task_runtime_projection", digest(0x50), 70n),
      objectReference("task_runtime_entry", entrySha256, 40n),
      objectReference("task_runtime_group_manifest", digest(0x51), 60n),
      objectReference(
        "task_runtime_materialization_spec",
        digest(0x52),
        50n,
      ),
    ],
  }));
}

function creationAuthority() {
  return {
    version: 1,
    applicationRevisionId: "apprev_task_store_v1",
    activationRevision: 7n,
    activationHeadSha256: digest(0x61),
    readinessReceiptSha256: digest(0x62),
    candidateSha256: digest(0x31),
    applicationRevisionTaskBindingSha256: digest(0x42),
    taskDefinitionRevisionId: TASK_DEFINITION_ID,
  };
}

function creationRequest(requestKey: string, inputDigest: number) {
  return success(decodeTaskRunCreationRequestV1({
    version: 1,
    requestKey,
    taskDefinitionRevisionId: TASK_DEFINITION_ID,
    input: success(makeTaskInputReferenceV1(digest(inputDigest), 19)),
  }));
}

function objectReference(
  role: TaskRuntimeObjectRoleV1,
  sha: TaskDefinitionSha256V1,
  byteLength: bigint,
): TaskRuntimeObjectReferenceV1 {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(role, hex(sha)),
    byteLength,
    sha256: sha,
  };
}

function digest(seed: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(seed) as TaskDefinitionSha256V1;
}

function hex(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    value => value.toString(16).padStart(2, "0"),
  ).join("");
}

async function taskCounts(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    runs: string;
    requests: string;
    attempts: string;
    effects: string;
  }>(`
    select
      (select count(*)::text from fx_system_durable_task_run_v1) as runs,
      (select count(*)::text from fx_system_durable_task_run_request_v1)
        as requests,
      (select count(*)::text from fx_system_durable_task_attempt_identity_v1)
        as attempts,
      (select count(*)::text from fx_system_durable_task_requested_effect_v1)
        as effects
  `);
  const row = result.rows[0]!;
  return {
    runs: Number(row.runs),
    requests: Number(row.requests),
    attempts: Number(row.attempts),
    effects: Number(row.effects),
  };
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
