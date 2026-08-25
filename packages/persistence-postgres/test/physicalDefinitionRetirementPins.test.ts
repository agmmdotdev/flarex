import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { decodeTaskDurationMsV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { makeStandardApplicationTaskSha256V1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { Effect, Result } from "effect";
import { projectScopeIdUuidV1Result } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import { selectApplicationActionAdmission } from
  "../src/applicationActionAdmission";
import { selectApplicationMutationAdmission } from
  "../src/applicationMutationAdmission";
import { makeApplicationTaskSystemRunCreationStore } from
  "../src/applicationTaskSystemRunCreation";
import { selectApplicationTask } from "../src/applicationTaskSelection";
import {
  inspectPhysicalDefinitionRetirementPinsInTransactionEffect,
} from "../src/physicalDefinitionRetirementPins";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { createLocatedTaskSystemRunAttemptTargetV1 } from
  "../src/taskSystemRunAttemptStoreV1";
import { runEffect } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  insertSnapshotLeaseFixture,
  insertTransactionSessionFixture,
  snapshotLeaseFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

describe("M05-B3 physical-definition retirement pins - PGlite", {
  timeout: 180_000,
}, () => {
  it("authenticates every persisted resumable owner in deterministic order", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/m05-b3-pin-runtime-host",
      compatibilityDate: "2026-08-19",
      includeTask: true,
    });
    const schemaVersionId = fixture.active.basis.schemaVersionId;
    const admissionContext = {
      deploymentId: fixture.deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    } as const;
    const mutation = await runEffect(selectApplicationMutationAdmission(
      fixture.active.selection,
      "users:create",
      admissionContext,
    ));
    const action = await runEffect(selectApplicationActionAdmission(
      fixture.active.selection,
      "users:notify",
      admissionContext,
    ));
    const scopeUuid = Result.getOrThrow(
      projectScopeIdUuidV1Result(fixture.authority.scopeId),
    ).scopeUuid;
    const sessionId = transactionSessionIdAt(951);
    await insertTransactionSessionFixture(
      fixture.target,
      transactionSessionFixture(sessionId, {
        scopeUuid,
        schemaVersionId,
        functionPath: "users:create",
        functionKind: "mutation",
        storageGenerationFence:
          fixture.authority.storageGenerationFence.toString(),
      }),
    );
    await fixture.target.query(
      `update fx_system_tx_session
          set execution_authority_generation = 'application_v1',
              package_id = null,
              artifact_runtime = null,
              artifact_id = null,
              source_package_hash = null,
              execution_module = null,
              application_execution_authority_json = $1::jsonb,
              application_execution_authority_canonical_bytes = $2,
              application_execution_authority_sha256 = $3
        where scope_uuid = $4 and session_id = $5`,
      [
        JSON.stringify(mutation.executionAuthority.authority),
        mutation.executionAuthority.canonicalBytes,
        mutation.executionAuthority.sha256,
        scopeUuid,
        sessionId,
      ],
    );

    await fixture.target.query(
      `insert into fx_system_application_action_invocation_v1
         (scope_id, scope_epoch, storage_generation_fence, request_key,
          invocation_id, request_identity_sha256,
          execution_authority_generation,
          application_execution_authority_json,
          application_execution_authority_canonical_bytes,
          application_execution_authority_sha256,
          action_function_path, execution_identity_sha256,
          compatibility_date, host_policy_sha256,
          argument_store_identity, argument_codec_identity,
          argument_object_key, argument_byte_length, argument_sha256,
          lifecycle)
       values ($1, $2, $3, 'm05-b3-action-pin',
         '97000000-0000-4000-8000-000000000001',
         decode(repeat('11', 32), 'hex'), 'application_v1', $4::jsonb,
         $5, $6, 'users:notify', decode(repeat('22', 32), 'hex'),
         '2026-08-19', decode(repeat('33', 32), 'hex'),
         'flarex.r2/execution-evidence-body/v1',
         'flarex.codec/canonical-flarex-value/v1',
         'execution-evidence-body/v1/action_arguments/m05-b3', 1,
         decode(repeat('44', 32), 'hex'), 'admitted')`,
      [
        fixture.authority.scopeId,
        fixture.authority.epoch,
        fixture.authority.storageGenerationFence,
        JSON.stringify(action.executionAuthority.authority),
        action.executionAuthority.canonicalBytes,
        action.executionAuthority.sha256,
      ],
    );

    const selectedTask = await runEffect(selectApplicationTask(
      fixture.active.selection,
      "tasks.users.task",
      {
        deploymentId: fixture.deploymentId,
        runtimeHostIdentity: "flarex.test/m05-b3-pin-runtime-host",
        compatibilityDate: "2026-08-19",
        authority: fixture.authorityPorts,
      },
    ));
    const taskStore = makeApplicationTaskSystemRunCreationStore(
      Object.freeze({
        authority: fixture.active.basis.authority,
        target: createLocatedTaskSystemRunAttemptTargetV1(
          fixture.target.drizzle,
          fixture.active.basis.authority.physicalLocator,
        ),
      }),
      {
        sha256: taskSha256,
        leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
        immediateRetryThresholdMs:
          Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
        randomUuid: () => "98000000-0000-4000-8000-000000000001",
      },
    );
    const task = await runEffect(taskStore.createRun(
      selectedTask.selection,
      Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
        version: 1,
        requestKey: "m05-b3-task-pin",
        applicationTaskRuntimeTargetSha256:
          selectedTask.metadata.runtimeTargetSha256,
        input: Result.getOrThrow(makeTaskInputReferenceV1(
          new Uint8Array(32).fill(0x55),
          1,
        )),
        principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
          new Uint8Array(32).fill(0x66),
          1,
        )),
      })),
    ));

    const inspect = () => fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.gen(function* () {
        yield* lockScopeClockForUpdateInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* inspectPhysicalDefinitionRetirementPinsInTransactionEffect(
          tx,
          fixture.active.basis.authority,
          fixture.deploymentId,
          [schemaVersionId],
        );
      }))
    );
    const activeEvidence = await fixture.target.query<{
      head_sha256: Uint8Array;
    }>(
      `select head_sha256
         from fx_system_application_active_head
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    const activeHeadSha256 = activeEvidence.rows[0]?.head_sha256;
    if (activeHeadSha256 === undefined) {
      throw new Error("M05-B3 active-head evidence was not seeded.");
    }
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_sha256 = decode(repeat('00', 32), 'hex')
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "active_application",
    });
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_sha256 = $1
        where scope_id = $2`,
      [activeHeadSha256, fixture.authority.scopeId],
    );

    await fixture.target.query(
      `delete from fx_system_application_active_head where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    const candidateEvidence = await fixture.target.query<{
      frame_sha256: Uint8Array;
    }>(
      `select frame_sha256
         from fx_system_app_schema_candidate_validation
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    const candidateFrameSha256 = candidateEvidence.rows[0]?.frame_sha256;
    if (candidateFrameSha256 === undefined) {
      throw new Error("M05-B3 candidate evidence was not seeded.");
    }
    await fixture.target.query(
      `update fx_system_app_schema_candidate_validation
          set frame_sha256 = decode(repeat('00', 32), 'hex')
        where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "candidate_validation",
    });
    await fixture.target.query(
      `update fx_system_app_schema_candidate_validation
          set frame_sha256 = $1
        where scope_id = $2`,
      [candidateFrameSha256, fixture.authority.scopeId],
    );
    await fixture.target.query(
      `delete from fx_system_app_schema_candidate_validation where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    await expect(inspect()).resolves.toMatchObject({
      status: "pinned",
      pin: { owner: "mutation_session", identity: sessionId },
    });
    await fixture.target.query(
      `update fx_system_tx_session set lifecycle = 'committed'
        where scope_uuid = $1 and session_id = $2`,
      [scopeUuid, sessionId],
    );
    await fixture.target.query(
      `insert into fx_system_application_action_invocation_v1
         (scope_id, scope_epoch, storage_generation_fence, request_key,
          invocation_id, request_identity_sha256,
          execution_authority_generation,
          application_execution_authority_json,
          application_execution_authority_canonical_bytes,
          application_execution_authority_sha256,
          action_function_path, execution_identity_sha256,
          compatibility_date, host_policy_sha256,
          argument_store_identity, argument_codec_identity,
          argument_object_key, argument_byte_length, argument_sha256,
          lifecycle)
       select $1, $2, $3, 'm05-b3-overflow-' || lpad(value::text, 2, '0'),
         ('97100000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
         decode(lpad(to_hex(value), 64, '0'), 'hex'),
         'application_v1', $4::jsonb, $5, $6, 'users:notify',
         decode(repeat('22', 32), 'hex'), '2026-08-19',
         decode(repeat('33', 32), 'hex'),
         'flarex.r2/execution-evidence-body/v1',
         'flarex.codec/canonical-flarex-value/v1',
         'execution-evidence-body/v1/action_arguments/m05-b3-overflow-' ||
           lpad(value::text, 2, '0'),
         1, decode(repeat('44', 32), 'hex'), 'admitted'
         from generate_series(1, 32) as values(value)`,
      [
        fixture.authority.scopeId,
        fixture.authority.epoch,
        fixture.authority.storageGenerationFence,
        JSON.stringify(action.executionAuthority.authority),
        action.executionAuthority.canonicalBytes,
        action.executionAuthority.sha256,
      ],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinDirectoryLimitError",
      owner: "direct_action",
      observed: 33,
      maximum: 32,
    });
    await fixture.target.query(
      `delete from fx_system_application_action_invocation_v1
        where scope_id = $1 and request_key like 'm05-b3-overflow-%'`,
      [fixture.authority.scopeId],
    );
    await fixture.target.query(
      `update fx_system_application_action_invocation_v1
          set application_execution_authority_canonical_bytes = decode('00', 'hex')
        where scope_id = $1 and request_key = 'm05-b3-action-pin'`,
      [fixture.authority.scopeId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "direct_action",
      identity: "m05-b3-action-pin",
    });
    await fixture.target.query(
      `update fx_system_application_action_invocation_v1
          set application_execution_authority_canonical_bytes = $1
        where scope_id = $2 and request_key = 'm05-b3-action-pin'`,
      [
        action.executionAuthority.canonicalBytes,
        fixture.authority.scopeId,
      ],
    );
    await expect(inspect()).resolves.toMatchObject({
      status: "pinned",
      pin: { owner: "direct_action", identity: "m05-b3-action-pin" },
    });
    await fixture.target.query(
      `delete from fx_system_application_action_invocation_v1
        where scope_id = $1 and request_key = 'm05-b3-action-pin'`,
      [fixture.authority.scopeId],
    );
    const taskProjectionResult = await fixture.target.query<{
      aggregate_json_text: string;
      current_attempt_id: string | null;
      current_lease_expires_at_ms: bigint | null;
      current_lease_version: bigint | null;
      due_at_ms: bigint | null;
      due_kind: string | null;
      execution_fence_basis: bigint | null;
      phase: string;
    }>(
      `select aggregate_json::text as aggregate_json_text,
              phase, due_kind, due_at_ms, current_attempt_id,
              execution_fence_basis, current_lease_version,
              current_lease_expires_at_ms
         from fx_system_durable_task_run_v1
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    const taskProjection = taskProjectionResult.rows[0];
    if (taskProjection === undefined) {
      throw new Error("M05-B3 task projection was not seeded.");
    }
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set phase = 'terminal', due_kind = null, due_at_ms = null,
              current_attempt_id = null, execution_fence_basis = null,
              current_lease_version = null, current_lease_expires_at_ms = null
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "durable_task",
      identity: task.runId,
    });
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set phase = $1, due_kind = $2, due_at_ms = $3,
              current_attempt_id = $4, execution_fence_basis = $5,
              current_lease_version = $6, current_lease_expires_at_ms = $7
        where scope_id = $8 and run_id = $9`,
      [
        taskProjection.phase,
        taskProjection.due_kind,
        taskProjection.due_at_ms,
        taskProjection.current_attempt_id,
        taskProjection.execution_fence_basis,
        taskProjection.current_lease_version,
        taskProjection.current_lease_expires_at_ms,
        fixture.authority.scopeId,
        task.runId,
      ],
    );
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set aggregate_json = '{}'::jsonb
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "durable_task",
      identity: task.runId,
    });
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set aggregate_json = $1::jsonb
        where scope_id = $2 and run_id = $3`,
      [
        taskProjection.aggregate_json_text,
        fixture.authority.scopeId,
        task.runId,
      ],
    );
    await fixture.target.query("set session_replication_role = replica");
    try {
      await fixture.target.query(
        `insert into fx_system_application_revision_schema_v1
           (scope_id, revision_id, deployment_id, application_schema_sha256,
            schema_version_id, schema_version, schema_manifest_sha256,
            schema_binding_sha256, bound_at)
         select scope_id, 'apprev_wrong_existing_m05_b3', deployment_id,
                application_schema_sha256, schema_version_id, schema_version,
                schema_manifest_sha256, schema_binding_sha256, bound_at
           from fx_system_application_revision_schema_v1
          where scope_id = $1 and revision_id = $2`,
        [fixture.authority.scopeId, fixture.active.basis.revisionId],
      );
    } finally {
      await fixture.target.query("set session_replication_role = origin");
    }
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set application_revision_id = 'apprev_wrong_existing_m05_b3'
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    await expect(inspect()).rejects.toMatchObject({
      _tag: "PhysicalDefinitionRetirementPinCorruptionError",
      owner: "durable_task",
      identity: task.runId,
    });
    await fixture.target.query(
      `update fx_system_durable_task_run_v1
          set application_revision_id = $1
        where scope_id = $2 and run_id = $3`,
      [
        fixture.active.basis.revisionId,
        fixture.authority.scopeId,
        task.runId,
      ],
    );
    await expect(fixture.target.query(
      `update fx_system_durable_task_run_v1
          set application_revision_id = 'apprev_missing_m05_b3'
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    )).rejects.toThrow();
    await expect(inspect()).resolves.toMatchObject({
      status: "pinned",
      pin: { owner: "durable_task", identity: task.runId },
    });
    await fixture.target.query(
      `delete from fx_system_durable_task_run_request_v1
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    await fixture.target.query(
      `delete from fx_system_durable_task_run_v1
        where scope_id = $1 and run_id = $2`,
      [fixture.authority.scopeId, task.runId],
    );
    await insertSnapshotLeaseFixture(
      fixture.target,
      snapshotLeaseFixture(sessionId, {
        scopeUuid,
        leaseExpiresAt: "2030-01-01T12:00:00.000Z",
      }),
    );
    await expect(inspect()).resolves.toMatchObject({
      status: "pinned",
      pin: { owner: "snapshot_lease", identity: sessionId },
    });
    await fixture.target.query(
      `delete from fx_system_snapshot_lease
        where scope_uuid = $1 and session_id = $2`,
      [scopeUuid, sessionId],
    );
    await expect(inspect()).resolves.toEqual({ status: "clear" });
    const legacySessionId = transactionSessionIdAt(952);
    await insertTransactionSessionFixture(
      fixture.target,
      transactionSessionFixture(legacySessionId, {
        scopeUuid,
        schemaVersionId,
        functionPath: "users:create",
        functionKind: "mutation",
        storageGenerationFence:
          fixture.authority.storageGenerationFence.toString(),
      }),
    );
    await insertSnapshotLeaseFixture(
      fixture.target,
      snapshotLeaseFixture(legacySessionId, {
        scopeUuid,
        leaseExpiresAt: "2030-01-01T12:00:00.000Z",
      }),
    );
    await expect(inspect()).resolves.toEqual({ status: "clear" });
  });
});
