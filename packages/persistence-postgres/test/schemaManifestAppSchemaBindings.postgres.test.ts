import type {
  SchemaManifestAppIndexDeclarationInputV1,
  SchemaManifestAppSchemaV1,
  SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  prepareSchemaManifestAppSchemaBindingsV1Effect,
  type PreparedSchemaManifestAppSchemaBindingsV1,
  SchemaManifestAppSchemaBindingPlanStaleError,
} from "../src/schemaManifestAppSchemaBindings";
import { runEffect } from "./effectTestRuntime";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
  type HeldPostgresDeploymentLock,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const prepareSchemaManifestAppSchemaBindingsV1 = (
  ...args: Parameters<typeof prepareSchemaManifestAppSchemaBindingsV1Effect>
) => runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(...args));

describePostgres("real Postgres schema manifest app-schema bindings", () => {
  it("converges concurrent exact table/index plan applications", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_replay";
      await insertDeployment(persistence, deploymentId);
      const plan = await prepareSchemaManifestAppSchemaBindingsV1(
        persistence.drizzle,
        {
          deploymentId,
          tables: [appTable("users"), appTable("products")],
          indexes: [
            appIndex("users", "by_name", ["name"]),
            appIndex("products", "by_sku", ["sku"]),
          ],
        },
      );
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const applications = [
        apply(persistence, plan),
        apply(persistence, plan),
      ] as const;

      await releaseAfterBlocked(lock, persistence, 2, applications);
      await expect(Promise.all(applications)).resolves.toEqual([
        plan.manifest,
        plan.manifest,
      ]);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 2,
        indexes: 2,
      });
    });
  }, 30_000);

  it("gives competing index-frontier plans one winner and a typed stale loser", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_competing";
      await insertDeployment(persistence, deploymentId);
      const tablePlan = await prepareSchemaManifestAppSchemaBindingsV1(
        persistence.drizzle,
        { deploymentId, tables: [appTable("users")], indexes: [] },
      );
      await apply(persistence, tablePlan);
      const descriptors = ["by_email", "by_name"] as const;
      const plans = await Promise.all(
        descriptors.map((descriptor) =>
          prepareSchemaManifestAppSchemaBindingsV1(persistence.drizzle, {
            deploymentId,
            tables: [appTable("users")],
            indexes: [appIndex("users", descriptor, [descriptor === "by_email" ? "email" : "name"])],
          })
        ),
      );
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const applications = plans.map((plan, index) =>
        attemptApply(persistence, descriptors[index] ?? "missing", plan)
      );

      await releaseAfterBlocked(lock, persistence, 2, applications);
      const outcomes = await Promise.all(applications);
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const loser = rejected[0];
      if (loser?.status !== "rejected") {
        throw new Error("Expected one rejected competing app-schema plan.");
      }
      expect(loser.error).toBeInstanceOf(
        SchemaManifestAppSchemaBindingPlanStaleError,
      );
      expect(loser.error).toMatchObject({
        stale: { reason: "indexCatalogHighWaterChanged" },
      });

      const loserPlan = await prepareSchemaManifestAppSchemaBindingsV1(
        persistence.drizzle,
        {
          deploymentId,
          tables: [appTable("users")],
          indexes: [
            appIndex(
              "users",
              loser.descriptor,
              [loser.descriptor === "by_email" ? "email" : "name"],
            ),
          ],
        },
      );
      await expect(apply(persistence, loserPlan)).resolves.toBe(
        loserPlan.manifest,
      );
      const rows = await persistence.query<{
        descriptor: string;
        logicalIndexId: number;
      }>(
        `
          select
            descriptor,
            logical_index_id as "logicalIndexId"
          from fx_control_index
          where deployment_id = $1
          order by logical_index_id
        `,
        [deploymentId],
      );
      expect(rows.rows.map((row) => row.logicalIndexId)).toEqual([1, 2]);
      expect(rows.rows.map((row) => row.descriptor).sort()).toEqual([
        "by_email",
        "by_name",
      ]);
    });
  }, 30_000);

  it("rolls both catalogs back when the caller transaction fails", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_rollback";
      await insertDeployment(persistence, deploymentId);
      const plan = await prepareSchemaManifestAppSchemaBindingsV1(
        persistence.drizzle,
        {
          deploymentId,
          tables: [appTable("users")],
          indexes: [appIndex("users", "by_name", ["name"])],
        },
      );

      await expect(
        persistence.drizzle.transaction(async (tx) => {
          await runEffect(
            applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, plan),
          );
          throw new Error("injected real Postgres rollback");
        }),
      ).rejects.toThrow("injected real Postgres rollback");
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 0,
        indexes: 0,
      });
      await expect(apply(persistence, plan)).resolves.toBe(plan.manifest);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 1,
      });
    });
  }, 30_000);
});

type ApplyAttempt =
  | {
      readonly status: "fulfilled";
      readonly descriptor: string;
      readonly manifest: SchemaManifestAppSchemaV1;
    }
  | {
      readonly status: "rejected";
      readonly descriptor: string;
      readonly error: unknown;
    };

async function attemptApply(
  persistence: PostgresFlarexPersistence,
  descriptor: string,
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Promise<ApplyAttempt> {
  try {
    return {
      status: "fulfilled",
      descriptor,
      manifest: await apply(persistence, prepared),
    };
  } catch (error) {
    return { status: "rejected", descriptor, error };
  }
}

async function releaseAfterBlocked(
  lock: HeldPostgresDeploymentLock,
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
  operations: ReadonlyArray<Promise<unknown>>,
): Promise<void> {
  let released = false;
  let setupError: unknown;
  try {
    await waitForBlockedPostgresDeploymentLocks(
      persistence,
      lock,
      expectedBlocked,
    );
    await lock.client.query("commit");
    released = true;
  } catch (error) {
    setupError = error;
  } finally {
    if (!released) {
      await lock.client.query("rollback").catch(() => undefined);
    }
    lock.client.release();
  }
  if (setupError !== undefined) {
    await Promise.allSettled(operations);
    throw setupError;
  }
}

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
          email: {
            fieldType: { type: "string" },
            optional: true,
          },
          sku: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

function apply(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Promise<SchemaManifestAppSchemaV1> {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, prepared),
    ),
  );
}

async function catalogCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<{ readonly tables: number; readonly indexes: number }> {
  const result = await persistence.query<{
    tables: number;
    indexes: number;
  }>(
    `
      select
        (
          select count(*)::int
          from fx_control_table
          where deployment_id = $1
        ) as tables,
        (
          select count(*)::int
          from fx_control_index
          where deployment_id = $1
        ) as indexes
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Catalog count query returned no row.");
  return row;
}
