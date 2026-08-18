import { describe, expect, it } from "vitest";
import { decodeCatalogIndexDefinitionId } from "flarex-protocol/catalog";

import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  inspectPhysicalDefinitionLifecycleEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../src/physicalDefinitionLifecycle";
import { createPostgresPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
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
