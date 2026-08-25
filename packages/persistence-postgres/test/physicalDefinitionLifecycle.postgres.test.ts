import { describe, expect, it } from "vitest";
import {
  canonicalAppUniqueConstraintSpecBytesHexV1ToBytes,
  appUniqueConstraintSpecSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";

import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  finalizePhysicalDefinitionRetirementEffect,
  inspectPhysicalDefinitionLifecycleEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../src/physicalDefinitionLifecycle";
import { createPostgresPersistence } from "../src/postgres";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  injectPhysicalDefinitionLifecycleMigrationFailure,
  makePhysicalDefinitionLifecycleMigrationFixture,
  restorePhysicalDefinitionLifecycleMigration,
  writePhysicalDefinitionLifecycleJournalThrough,
} from "./physicalDefinitionLifecycleMigrationSupport";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistencePair,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres(
  "M05-B1 physical-definition lifecycle - PostgreSQL",
  { timeout: 480_000 },
  () => {
    it("runs split-control/target transitions and serializes exact replay", async () => {
      await withTemporaryPostgresPersistencePair(async (control, target) => {
        const fixture = await createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: "flarex.test/m05-b1-postgres-runtime-host",
          compatibilityDate: "2026-08-18",
        }, { control, target });
        const definition = await control.query<{ index_definition_id: number }>(
          `select index_definition_id
             from fx_control_index_definition
            where deployment_id = $1
            order by index_definition_id
            limit 1`,
          [fixture.deploymentId],
        );
        const indexDefinitionId = decodeCatalogIndexDefinitionId(
          definition.rows[0]?.index_definition_id,
        );
        const prepared = await runEffect(
          preparePhysicalDefinitionLifecycleSubjectEffect(
            createPhysicalDefinitionLifecyclePort({
              controlDb: control.drizzle,
              authority: fixture.authorityPorts,
            }),
            {
              definitionKind: "index",
              deploymentId: fixture.deploymentId,
              indexDefinitionId,
            },
          ),
        );
        const settled = await Promise.all([
          runEffect(beginPhysicalDefinitionDrainingEffect(
            prepared,
            { expectedTransitionFence: 0n },
          )),
          runEffect(beginPhysicalDefinitionDrainingEffect(
            prepared,
            { expectedTransitionFence: 0n },
          )),
        ]);
        expect(settled.map(result => result.disposition).sort()).toEqual([
          "created",
          "replayed",
        ]);
        await expect(runEffect(cancelPhysicalDefinitionDrainingEffect(
          prepared,
          { expectedTransitionFence: 1n },
        ))).resolves.toMatchObject({
          disposition: "transitioned",
          lifecycle: { lifecycle: "active", transitionFence: 2n },
        });
        await expect(runEffect(inspectPhysicalDefinitionLifecycleEffect(prepared)))
          .resolves.toMatchObject({
            status: "persisted",
            lifecycle: {
              deploymentId: fixture.deploymentId,
              definitionKind: "index",
              definitionId: indexDefinitionId,
              lifecycle: "active",
            },
          });
        await withPostgresSequentialScansDisabled(control, async client => {
          const indexPlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select schema_version_id
               from fx_control_schema_version_index_binding
              where deployment_id = $1
                and index_definition_id = $2
              order by schema_version_id
              limit 4097`,
            [fixture.deploymentId, indexDefinitionId],
          );
          expect(JSON.stringify(indexPlan.rows)).toContain(
            "fx_control_schema_index_binding_definition_lookup_idx",
          );
          const uniquePlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select schema_version_id
               from fx_control_schema_version_unique_constraint_binding
              where deployment_id = $1
                and unique_constraint_definition_id = $2
              order by schema_version_id
              limit 4097`,
            [fixture.deploymentId, 1],
          );
          expect(JSON.stringify(uniquePlan.rows)).toContain(
            "fx_control_schema_unique_binding_definition_lookup_idx",
          );
        });
        await withPostgresSequentialScansDisabled(target, async client => {
          const sessionPlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select session_id
               from fx_system_tx_session
              where scope_uuid = replace($1, 'scope_', '')::uuid
                and execution_authority_generation = 'application_v1'
                and lifecycle in (
                  'created', 'running', 'finishing', 'committing', 'retrying'
                )
              order by session_id
              limit 33
              for share`,
            [fixture.authority.scopeId],
          );
          expect(JSON.stringify(sessionPlan.rows)).toContain(
            "fx_system_tx_session_application_retirement_pin_idx",
          );
          const actionPlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select request_key
               from fx_system_application_action_invocation_v1
              where scope_id = $1
                and execution_authority_generation = 'application_v1'
                and lifecycle in ('admitted', 'executing')
              order by request_key
              limit 33
              for share`,
            [fixture.authority.scopeId],
          );
          expect(JSON.stringify(actionPlan.rows)).toContain(
            "fx_action_invocation_v1_application_retirement_pin_idx",
          );
          const taskPlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select run_id
               from fx_system_durable_task_run_v1
              where scope_id = $1
                and definition_generation = 'application_v1'
                and (aggregate_json #>> '{aggregate,phase}')
                  is distinct from 'terminal'
              order by run_id
              limit 33
              for share`,
            [fixture.authority.scopeId],
          );
          expect(JSON.stringify(taskPlan.rows)).toContain(
            "fx_task_run_v1_application_retirement_pin_idx",
          );
          const leasePlan = await client.query<{ "QUERY PLAN": unknown }>(
            `explain (format json)
             select session_id
               from fx_system_snapshot_lease
              where scope_uuid = replace($1, 'scope_', '')::uuid
                and lease_expires_at > clock_timestamp()
              order by lease_expires_at, session_id
              limit 33
              for share`,
            [fixture.authority.scopeId],
          );
          expect(JSON.stringify(leasePlan.rows)).toContain(
            "fx_system_snapshot_lease_retirement_pin_idx",
          );
        });

        const uniqueConstraintDefinitionId =
          decodeCatalogUniqueConstraintDefinitionId(9_101);
        const canonical = await canonicalizeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["name"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: "flarex.unique-key/ordered-index-components/v1",
          keyCodecVersion: 1,
        });
        await control.query(
          `insert into fx_control_unique_constraint
             (deployment_id, logical_unique_constraint_id, table_id, descriptor)
           values ($1, 9101, 1, 'unique_name_m05_b3')`,
          [fixture.deploymentId],
        );
        await control.query(
          `insert into fx_control_unique_constraint_definition
             (deployment_id, unique_constraint_definition_id,
              logical_unique_constraint_id, table_id,
              physical_spec_codec_version, physical_spec_json,
              physical_spec_bytes, physical_spec_sha256)
           values ($1, $2, 9101, 1, 1, $3::jsonb, $4, $5)`,
          [
            fixture.deploymentId,
            uniqueConstraintDefinitionId,
            JSON.stringify(canonical.physicalSpec),
            canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
              canonical.canonicalBytesHex,
            ),
            appUniqueConstraintSpecSha256HexV1ToBytes(canonical.sha256Hex),
          ],
        );
        await control.query(
          `insert into fx_control_schema_version_unique_constraint_binding
             (deployment_id, schema_version_id, logical_unique_constraint_id,
              unique_constraint_definition_id, required_for_activation)
           values ($1, $2, 9101, $3, true)`,
          [
            fixture.deploymentId,
            fixture.active.basis.schemaVersionId,
            uniqueConstraintDefinitionId,
          ],
        );
        const uniquePrepared = await runEffect(
          preparePhysicalDefinitionLifecycleSubjectEffect(
            createPhysicalDefinitionLifecyclePort({
              controlDb: control.drizzle,
              authority: fixture.authorityPorts,
            }),
            {
              definitionKind: "unique_constraint",
              deploymentId: fixture.deploymentId,
              uniqueConstraintDefinitionId,
            },
          ),
        );
        await runEffect(beginPhysicalDefinitionDrainingEffect(
          uniquePrepared,
          { expectedTransitionFence: 0n },
        ));
        await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
          uniquePrepared,
          { expectedTransitionFence: 1n },
        ))).resolves.toMatchObject({
          _tag: "PhysicalDefinitionLifecyclePinnedError",
          pin: { owner: "active_application" },
        });
        await target.query(
          `delete from fx_system_application_active_head where scope_id = $1`,
          [fixture.authority.scopeId],
        );
        await expect(runEffectFailure(finalizePhysicalDefinitionRetirementEffect(
          uniquePrepared,
          { expectedTransitionFence: 1n },
        ))).resolves.toMatchObject({
          _tag: "PhysicalDefinitionLifecyclePinnedError",
          pin: { owner: "candidate_validation" },
        });
        await target.query(
          `delete from fx_system_app_schema_candidate_validation where scope_id = $1`,
          [fixture.authority.scopeId],
        );
        await control.query(
          `insert into fx_control_schema_version
             (deployment_id, schema_version_id, version, manifest_codec_version,
              manifest_json, manifest_bytes, manifest_sha256)
           select deployment_id, 'schema_m05_b3_pg_stale_binding',
                  version + 1000, manifest_codec_version, manifest_json,
                  manifest_bytes, manifest_sha256
             from fx_control_schema_version
            where deployment_id = $1 and schema_version_id = $2`,
          [fixture.deploymentId, fixture.active.basis.schemaVersionId],
        );
        await control.query(
          `insert into fx_control_schema_version_unique_constraint_binding
             (deployment_id, schema_version_id, logical_unique_constraint_id,
              unique_constraint_definition_id, required_for_activation)
           values ($1, 'schema_m05_b3_pg_stale_binding', 9101, $2, true)`,
          [fixture.deploymentId, uniqueConstraintDefinitionId],
        );
        await expect(runEffectFailure(
          finalizePhysicalDefinitionRetirementEffect(
            uniquePrepared,
            { expectedTransitionFence: 1n },
          ),
        )).resolves.toMatchObject({
          _tag: "PhysicalDefinitionLifecycleConflictError",
          reason: "storedStateInvalid",
        });
        await control.query(
          `delete from fx_control_schema_version_unique_constraint_binding
            where deployment_id = $1
              and schema_version_id = 'schema_m05_b3_pg_stale_binding'`,
          [fixture.deploymentId],
        );
        await control.query(
          `delete from fx_control_schema_version
            where deployment_id = $1
              and schema_version_id = 'schema_m05_b3_pg_stale_binding'`,
          [fixture.deploymentId],
        );
        await expect(runEffect(finalizePhysicalDefinitionRetirementEffect(
          uniquePrepared,
          { expectedTransitionFence: 1n },
        ))).resolves.toMatchObject({
          disposition: "transitioned",
          lifecycle: { lifecycle: "retired", transitionFence: 2n },
        });
        await expect(runEffect(finalizePhysicalDefinitionRetirementEffect(
          uniquePrepared,
          { expectedTransitionFence: 1n },
        ))).resolves.toMatchObject({
          disposition: "replayed",
          lifecycle: { lifecycle: "retired", transitionFence: 2n },
        });
      });
    });

    it("upgrades and rolls back atomically in a non-public schema", async () => {
      const fixture = await makePhysicalDefinitionLifecycleMigrationFixture(
        "postgres",
      );
      try {
        await writePhysicalDefinitionLifecycleJournalThrough(
          fixture.currentJournal,
          fixture.temporaryJournal,
          66,
        );
        await withTemporaryPostgresSchema(async databaseOptions => {
          const persistence = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await persistence.migrate();
            await persistence.query(
              `insert into fx_system_scope_clock
                (scope_id, storage_generation, storage_generation_fence,
                 last_commit_seq, last_outbox_seq, epoch)
               values ('scope_93000000-0000-4000-8000-000000000001',
                 'flarexdb_v1', 1, 0, 0,
                 'epoch_94000000-0000-4000-8000-000000000001')`,
            );
            await writePhysicalDefinitionLifecycleJournalThrough(
              fixture.currentJournal,
              fixture.temporaryJournal,
              67,
            );
            await injectPhysicalDefinitionLifecycleMigrationFailure(
              fixture.migrationPath,
            );
            await expect(persistence.migrate()).rejects.toThrow();
            expect(await tableCount(persistence)).toBe(0);
            await restorePhysicalDefinitionLifecycleMigration(
              fixture.migrationPath,
              fixture.currentMigrationsFolder,
            );
            await expect(persistence.migrate()).resolves.toBeUndefined();
            await expect(persistence.migrate()).resolves.toBeUndefined();
            expect(await tableCount(persistence)).toBe(1);
            const schema = await persistence.query<{ name: string }>(
              "select current_schema() name",
            );
            expect(schema.rows[0]?.name).not.toBe("public");
          } finally {
            await persistence.close();
          }
        });
      } finally {
        await fixture.cleanup();
      }
    });
  },
);

async function tableCount(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
) {
  const result = await persistence.query<{ count: number }>(
    `select count(*)::int count
       from information_schema.tables
      where table_schema = current_schema()
        and table_name = 'fx_system_physical_definition_lifecycle'`,
  );
  return result.rows[0]?.count ?? 0;
}
