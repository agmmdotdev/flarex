import {
  decodeTaskRunCreationRequestV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskDurationMsV1,
  decodeTaskRetryJitterV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  decodeTaskRuntimeEntryFrameV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  hashCanonicalTaskCatalogV1,
  hashTaskDefinitionRuntimeBindingV1,
  hashTaskRuntimeEntryFrameV1,
  makeStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRunCreationAuthorityReceiptV1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexSqlClient } from "../src/index";
import { fxSystemDurableTaskDefinitionRevisionsV1 } from "../src/schema";
import type { LocatedTrustedScopeAuthority } from
  "../src/scopeAuthorityResolution";
import {
  makeTaskSystemRunCreationStoreV1,
} from "../src/taskSystemRunCreationV1";
import type { LocatedReadCommittedAttemptTargetV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect } from "./effectTestRuntime";
import { TASK_DEFINITION_ID } from
  "./taskSystemRunAttemptStoreTestSupport";

export const TASK_SYSTEM_CREATION_RUN_UUID_A =
  "73000000-0000-4000-8000-000000000001";
export const TASK_SYSTEM_CREATION_RUN_UUID_B =
  "73000000-0000-4000-8000-000000000002";
export const TASK_SYSTEM_CREATION_ATTEMPT_UUID =
  "73000000-0000-4000-8000-000000000003";

export const taskSystemCreationSha256V1 = makeStandardApplicationTaskSha256V1(
  input => globalThis.crypto.subtle.digest("SHA-256", input),
);
export const taskSystemCreationLeaseDurationMsV1 = taskSystemCreationSuccessV1(
  decodeTaskDurationMsV1(30_000),
);
export const taskSystemCreationImmediateRetryThresholdMsV1 =
  taskSystemCreationSuccessV1(decodeTaskDurationMsV1(5_000));
export const taskSystemCreationRetryJitterV1 = taskSystemCreationSuccessV1(
  decodeTaskRetryJitterV1(0.25),
);

export interface TaskSystemCreationTestFixtureV1 {
  readonly located: LocatedTrustedScopeAuthority<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly runtimeBinding: TaskDefinitionRuntimeBindingV1;
  readonly creationAuthority: TaskRunCreationAuthorityReceiptV1;
}

export function makeTaskSystemCreationStoreForTestV1(
  fixture: TaskSystemCreationTestFixtureV1,
  options: Readonly<{
    readonly randomUuid: () => string;
    readonly runtimeBinding?: TaskDefinitionRuntimeBindingV1;
    readonly creationAuthority?: TaskRunCreationAuthorityReceiptV1;
  }>,
) {
  return makeTaskSystemRunCreationStoreV1(fixture.located, {
    sha256: taskSystemCreationSha256V1,
    runtimeBinding: options.runtimeBinding ?? fixture.runtimeBinding,
    creationAuthority:
      options.creationAuthority ?? fixture.creationAuthority,
    leaseDurationMs: taskSystemCreationLeaseDurationMsV1,
    immediateRetryThresholdMs:
      taskSystemCreationImmediateRetryThresholdMsV1,
    randomUuid: options.randomUuid,
  });
}

export async function makeTaskSystemCreationRuntimeBindingV1(
  input: Readonly<{
    readonly applicationRevisionId: string;
    readonly candidateSha256: Uint8Array;
  }> = Object.freeze({
    applicationRevisionId: "apprev_task_store_v1",
    candidateSha256: taskSystemCreationDigestV1(0x31),
  }),
): Promise<TaskDefinitionRuntimeBindingV1> {
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
  }, taskSystemCreationSha256V1));
  const entry = taskSystemCreationSuccessV1(decodeTaskRuntimeEntryFrameV1({
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: catalog.entries[0]!.taskId,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    logicalExecutionModule: "tasks/orders",
    artifactExecutionModule: "tasks/orders.js",
    exportName: "run",
    group: "durable_task",
    projectionSha256: taskSystemCreationDigestV1(0x50),
  }));
  const entrySha256 = await runEffect(
    hashTaskRuntimeEntryFrameV1(entry, taskSystemCreationSha256V1),
  );
  return taskSystemCreationSuccessV1(decodeTaskDefinitionRuntimeBindingV1({
    version: 1,
    applicationRevisionId: input.applicationRevisionId,
    candidateSha256: input.candidateSha256,
    applicationRevisionTaskBindingSha256: taskSystemCreationDigestV1(0x42),
    taskId: catalog.entries[0]!.taskId,
    manifest: catalog.entries[0]!.manifest,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    taskRuntimeEntrySha256: entrySha256,
    taskRuntimeEntry: entry,
    taskCatalogSha256: catalog.taskCatalogSha256,
    taskEntryRootSha256: taskSystemCreationDigestV1(0x43),
    taskRuntimeProjectionSha256: taskSystemCreationDigestV1(0x50),
    taskRuntimeGroupManifestSha256: taskSystemCreationDigestV1(0x51),
    taskRuntimeMaterializationSpecSha256: taskSystemCreationDigestV1(0x52),
    packageSha256: taskSystemCreationDigestV1(0x53),
    artifactSha256: taskSystemCreationDigestV1(0x54),
    sourceRootSha256: taskSystemCreationDigestV1(0x55),
    semanticRootSha256: taskSystemCreationDigestV1(0x56),
    runtimeObjects: [
      taskRuntimeObjectReferenceV1(
        "runtime_projection_module",
        taskSystemCreationDigestV1(0x57),
        100n,
      ),
      taskRuntimeObjectReferenceV1(
        "task_runtime_projection",
        taskSystemCreationDigestV1(0x50),
        70n,
      ),
      taskRuntimeObjectReferenceV1(
        "task_runtime_entry",
        entrySha256,
        40n,
      ),
      taskRuntimeObjectReferenceV1(
        "task_runtime_group_manifest",
        taskSystemCreationDigestV1(0x51),
        60n,
      ),
      taskRuntimeObjectReferenceV1(
        "task_runtime_materialization_spec",
        taskSystemCreationDigestV1(0x52),
        50n,
      ),
    ],
  }));
}

export function makeTaskSystemCreationAuthorityV1(
  input: Readonly<{
    readonly applicationRevisionId: string;
    readonly candidateSha256: Uint8Array;
  }> = Object.freeze({
    applicationRevisionId: "apprev_task_store_v1",
    candidateSha256: taskSystemCreationDigestV1(0x31),
  }),
): TaskRunCreationAuthorityReceiptV1 {
  return taskSystemCreationSuccessV1(
    decodeTaskRunCreationAuthorityReceiptV1({
      version: 1,
      applicationRevisionId: input.applicationRevisionId,
      activationRevision: 7n,
      activationHeadSha256: taskSystemCreationDigestV1(0x61),
      readinessReceiptSha256: taskSystemCreationDigestV1(0x62),
      candidateSha256: input.candidateSha256,
      applicationRevisionTaskBindingSha256:
        taskSystemCreationDigestV1(0x42),
      taskDefinitionRevisionId: TASK_DEFINITION_ID,
    }),
  );
}

export function makeTaskSystemCreationRequestV1(
  requestKey: string,
  inputDigest: number,
) {
  return taskSystemCreationSuccessV1(decodeTaskRunCreationRequestV1({
    version: 1,
    requestKey,
    taskDefinitionRevisionId: TASK_DEFINITION_ID,
    input: taskSystemCreationSuccessV1(
      makeTaskInputReferenceV1(taskSystemCreationDigestV1(inputDigest), 19),
    ),
  }));
}

export async function installTaskSystemCreationRuntimeBindingV1(
  db: FlarexMetadataDatabase,
  runtimeBinding: TaskDefinitionRuntimeBindingV1,
  creationAuthority: TaskRunCreationAuthorityReceiptV1,
  scopeId?: (
    typeof fxSystemDurableTaskDefinitionRevisionsV1.$inferSelect
  )["scopeId"],
): Promise<void> {
  const bindingBytes = taskSystemCreationSuccessV1(
    encodeTaskDefinitionRuntimeBindingPreimageV1(runtimeBinding),
  );
  const bindingSha256 = await runEffect(
    hashTaskDefinitionRuntimeBindingV1(
      runtimeBinding,
      taskSystemCreationSha256V1,
    ),
  );
  await db.update(fxSystemDurableTaskDefinitionRevisionsV1).set({
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
  }).where(scopeId === undefined
    ? eq(
      fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      creationAuthority.taskDefinitionRevisionId,
    )
    : and(
      eq(fxSystemDurableTaskDefinitionRevisionsV1.scopeId, scopeId),
      eq(
        fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
        creationAuthority.taskDefinitionRevisionId,
      ),
    ));
}

export async function taskSystemCreationCountsV1(
  persistence: Pick<FlarexSqlClient, "query">,
) {
  const result = await persistence.query<{
    runs: number | string;
    requests: number | string;
    attempts: number | string;
    effects: number | string;
  }>(`
    select
      (select count(*)::int from fx_system_durable_task_run_v1) as runs,
      (select count(*)::int from fx_system_durable_task_run_request_v1)
        as requests,
      (select count(*)::int from fx_system_durable_task_attempt_identity_v1)
        as attempts,
      (select count(*)::int from fx_system_durable_task_requested_effect_v1)
        as effects
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Task System counts returned no row.");
  return Object.freeze({
    runs: Number(row.runs),
    requests: Number(row.requests),
    attempts: Number(row.attempts),
    effects: Number(row.effects),
  });
}

export function taskSystemCreationDigestV1(
  seed: number,
): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(seed) as TaskDefinitionSha256V1;
}

export function taskSystemCreationSuccessV1<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

function taskRuntimeObjectReferenceV1(
  role: TaskRuntimeObjectRoleV1,
  sha256: TaskDefinitionSha256V1,
  byteLength: bigint,
): TaskRuntimeObjectReferenceV1 {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(role, lowercaseHex(sha256)),
    byteLength,
    sha256,
  };
}

function lowercaseHex(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    value => value.toString(16).padStart(2, "0"),
  ).join("");
}
