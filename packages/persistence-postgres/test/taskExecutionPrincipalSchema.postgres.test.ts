import { describe, expect, it } from "vitest";

import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";
import {
  seedTaskSystemRunAttemptStoreV1,
  TASK_RUN_ID,
} from "./taskSystemRunAttemptStoreTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("DTE06-F0 Task execution principal schema - PostgreSQL", () => {
  it("admits only exact principal generations and correlated evidence", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const seeded = await seedTaskSystemRunAttemptStoreV1(persistence);
      const legacy = await persistence.query<{ generation: string }>(`
        select execution_principal_generation as generation
        from fx_system_durable_task_run_v1
        where scope_id = $1 and run_id = $2
      `, [seeded.scopeId, TASK_RUN_ID]);
      expect(legacy.rows).toEqual([{ generation: "not_applicable" }]);

      await persistence.query("set session_replication_role = replica");
      try {
        await persistence.query(`
          insert into fx_system_application_revision_schema_v1
            (scope_id, revision_id, deployment_id, application_schema_sha256,
             schema_version_id, schema_version, schema_manifest_sha256,
             schema_binding_sha256)
          values
            ($1, 'apprev_task_principal_v1', $2,
             decode(repeat('61', 32), 'hex'), 'schema_task_principal_v1', 1,
             decode(repeat('62', 32), 'hex'),
             decode(repeat('63', 32), 'hex'))
        `, [seeded.scopeId, seeded.deploymentId]);
      } finally {
        await persistence.query("set session_replication_role = origin");
      }
      await persistence.query(`
        update fx_system_durable_task_run_v1
        set definition_generation = 'application_v1',
            task_definition_revision_id = null,
            application_revision_id = 'apprev_task_principal_v1',
            application_task_runtime_target_sha256 =
              decode(repeat('ab', 32), 'hex'),
            execution_principal_generation = 'legacy_absent'
        where scope_id = $1 and run_id = $2
      `, [seeded.scopeId, TASK_RUN_ID]);
      await expect(persistence.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_generation = 'present_v1'
        where scope_id = $1 and run_id = $2
      `, [seeded.scopeId, TASK_RUN_ID])).rejects.toThrow(
        /fx_task_run_v1_identity_check/,
      );
      await persistence.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_generation = 'present_v1',
            execution_principal_kind = 'authenticated_user',
            execution_principal_codec =
              'flarex.task-execution-principal-reference.v1',
            execution_principal_store =
              'flarex.task-execution-principal-object-store.v1',
            execution_principal_value_codec = 'flarex-value/v1',
            execution_principal_object_key =
              'durable-task-principal/v1/sha256/' || repeat('cd', 32),
            execution_principal_byte_length = 23,
            execution_principal_sha256 = decode(repeat('cd', 32), 'hex'),
            execution_principal_retention = 'run_lifetime'
        where scope_id = $1 and run_id = $2
      `, [seeded.scopeId, TASK_RUN_ID]);
      await expect(persistence.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_object_key =
          'durable-task-principal/v1/sha256/' || repeat('ef', 32)
        where scope_id = $1 and run_id = $2
      `, [seeded.scopeId, TASK_RUN_ID])).rejects.toThrow(
        /fx_task_run_v1_identity_check/,
      );
    });
  }, 480_000);
});
