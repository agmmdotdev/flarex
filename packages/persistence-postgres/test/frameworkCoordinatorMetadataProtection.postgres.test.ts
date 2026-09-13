import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import {
  fxSystemFrameworkMigrationPlans,
  fxSystemFrameworkMigrationPlanSteps,
} from "../src/migrationCoordination/schema";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import {
  postgresUrl,
  rollbackAndReleasePostgresClient,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

// Administrative credentials are used only to create/drop this test's role.
// Every coordinator operation below uses a separate, non-owner login pool.
const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
const native =
  postgresUrl === null || !provisioningUrl ? describe.skip : describe;

native(
  "framework installation metadata under a restricted PostgreSQL login",
  () => {
    it("rolls back the complete guard migration and preserves prior application data", async () => {
      await withTemporaryPostgresSchema(async (options) => {
        const pool = new Pool({
          connectionString: options.connectionString,
          ...options.poolConfig,
        });
        const client = await pool.connect();
        try {
          const migrations = readMigrationFiles({
            migrationsFolder: fileURLToPath(
              new URL("../drizzle", import.meta.url),
            ),
          });
          const index = migrations.findIndex((migration) =>
            migration.sql.some((statement) =>
              statement.includes(
                "CREATE FUNCTION fx_framework_stamp_creation_transaction",
              ),
            ),
          );
          const protection = migrations[index];
          if (protection === undefined)
            throw new Error("Missing metadata protection migration");
          await client.query("begin");
          for (const migration of migrations.slice(0, index))
            for (const statement of migration.sql)
              await client.query(statement);
          await client.query("commit");
          await client.query(
            "insert into deployments(deployment_id, project_id) values ('retained', 'project')",
          );
          await client.query("begin");
          for (const statement of protection.sql) await client.query(statement);
          expect(
            (
              await client.query(`select count(*)::int as count from pg_trigger t
          join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
          where n.nspname=current_schema() and tgname like 'fx_framework_%'`)
            ).rows,
          ).toEqual([{ count: 42 }]);
          await client.query("rollback");
          expect(
            (
              await client.query(
                "select count(*)::int as count from information_schema.columns where table_schema=current_schema() and column_name='created_transaction_id'",
              )
            ).rows,
          ).toEqual([{ count: 0 }]);
          expect(
            (
              await client.query(
                "select to_regprocedure('fx_framework_stamp_creation_transaction()') as name",
              )
            ).rows,
          ).toEqual([{ name: null }]);
          await client.query("begin");
          for (const statement of protection.sql) await client.query(statement);
          await client.query("commit");
          expect(
            (
              await client.query(
                "select project_id from deployments where deployment_id='retained'",
              )
            ).rows,
          ).toEqual([{ project_id: "project" }]);
        } finally {
          try {
            await rollbackAndReleasePostgresClient(client);
          } finally {
            await pool.end();
          }
        }
      });
    }, 180_000);

    it("installs, preserves replay, prevents guard removal, and rejects a racing late child", async () => {
      await withNativeCoordinator(async (fixture) => {
        const runtime = {
          query: fixture.migrationPool.query.bind(fixture.migrationPool),
          drizzle: drizzle(fixture.migrationPool),
        };
        expect(
          (
            await runtime.query(
              "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname=current_user",
            )
          ).rows,
        ).toEqual([
          {
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolbypassrls: false,
          },
        ]);
        const input = fixture.input;
        expect(
          await runEffect(
            runFreshFrameworkMigrationCoordinatorEffect(input),
          ),
        ).toMatchObject({ kind: "ready", replayed: false });
        expect(
          await runEffect(
            runFreshFrameworkMigrationCoordinatorEffect(input),
          ),
        ).toMatchObject({ kind: "ready", replayed: true });
        await expect(
          runtime.query(
            "update fx_system_framework_migration_plan set created_transaction_id=1",
          ),
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          runtime.query(
            "delete from fx_system_framework_migration_plan_step_dependency",
          ),
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          runtime.query(
            "truncate fx_system_framework_migration_plan_step_dependency",
          ),
        ).rejects.toMatchObject({ code: "55000" });
        await expect(
          runtime.query(
            "alter table fx_system_framework_migration_plan disable trigger fx_framework_history_immutable",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          runtime.query(
            "alter function fx_framework_reject_history_mutation() rename to bypass_history",
          ),
        ).rejects.toMatchObject({ code: "42501" });

        const [original] = await runtime.drizzle
          .select()
          .from(fxSystemFrameworkMigrationPlans);
        const [step] = await runtime.drizzle
          .select()
          .from(fxSystemFrameworkMigrationPlanSteps);
        if (original === undefined || step === undefined)
          throw new Error("Missing installed graph");
        await runtime.drizzle
          .insert(fxSystemFrameworkMigrationPlanSteps)
          .values(step)
          .onConflictDoNothing();
        const { planStorageId: _planStorageId, ...copy } = original;
        const parentId = await runtime.drizzle.transaction(
          async (parent) => {
            const [inserted] = await parent
              .insert(fxSystemFrameworkMigrationPlans)
              .values({
                ...copy,
                createdTransactionId: 1n,
                migrationPlanSha256: new Uint8Array(32).fill(9),
              })
              .returning();
            if (inserted === undefined)
              throw new Error("Missing new parent");
            expect(inserted.createdTransactionId).not.toBe(1n);
            // A separate transaction cannot reference this uncommitted parent.
            // After it commits, the creation-transaction guard must reject the
            // same insertion rather than letting the child join a closed set.
            await expect(
              runtime.drizzle.transaction(async (child) => {
                await child.execute(
                  sql`set local statement_timeout = '2000ms'`,
                );
                return child
                  .insert(fxSystemFrameworkMigrationPlanSteps)
                  .values({
                    ...step,
                    planStorageId: inserted.planStorageId,
                  });
              }),
            ).rejects.toMatchObject({ cause: { code: "23503" } });
            return inserted.planStorageId;
          },
        );
        await expect(
          runtime.drizzle
            .insert(fxSystemFrameworkMigrationPlanSteps)
            .values({ ...step, planStorageId: parentId }),
        ).rejects.toMatchObject({ cause: { code: "55000" } });
        expect(
          await runtime.drizzle
            .select()
            .from(fxSystemFrameworkMigrationPlanSteps)
            .where(
              eq(
                fxSystemFrameworkMigrationPlanSteps.planStorageId,
                original.planStorageId,
              ),
            ),
        ).toHaveLength(7);
      });
    }, 180_000);
  },
);
