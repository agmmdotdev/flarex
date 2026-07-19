import {
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  applySchemaManifestAppTableBindingsV1InTransactionEffect,
  prepareSchemaManifestAppTableBindingsV1Effect,
  type PreparedSchemaManifestAppTableBindingsV1,
  SchemaManifestTableBindingPlanStaleError,
} from "../src/schemaManifestTableBindings";
import {
  ensureStableTableIdentityEffect,
  getStableTableIdentityByNameEffect,
} from "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
  type HeldPostgresDeploymentLock,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres schema manifest table bindings", () => {
  it("converges concurrent exact-plan applications", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_binding_pg_replay";
      await insertDeployment(persistence, deploymentId);
      const plan = await prepareSchemaManifestAppTableBindingsV1(
        persistence.drizzle,
        {
          deploymentId,
          tables: [appDeclaration("users"), appDeclaration("products")],
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
        plan.section,
        plan.section,
      ]);
      const rows = await persistence.query<{ count: number }>(
        `
          select count(*)::int as count
          from fx_control_table
          where deployment_id = $1
        `,
        [deploymentId],
      );
      expect(rows.rows).toEqual([{ count: 2 }]);
    });
  }, 30_000);

  it("gives competing same-frontier plans one winner and one typed stale loser", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_binding_pg_competing";
      await insertDeployment(persistence, deploymentId);
      const [usersPlan, productsPlan] = await Promise.all([
        prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
          deploymentId,
          tables: [appDeclaration("users")],
        }),
        prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
          deploymentId,
          tables: [appDeclaration("products")],
        }),
      ]);
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const applications = [
        apply(persistence, usersPlan),
        apply(persistence, productsPlan),
      ] as const;

      await releaseAfterBlocked(lock, persistence, 2, applications);
      const outcomes = await Promise.allSettled(applications);
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
        throw new Error("Expected one rejected competing binding plan.");
      }
      expect(loser.reason).toBeInstanceOf(
        SchemaManifestTableBindingPlanStaleError,
      );
      expect(loser.reason).toMatchObject({
        stale: { reason: "catalogHighWaterChanged" },
      });
      const rows = await persistence.query<{
        logicalName: string;
        tableId: number;
      }>(
        `
          select logical_name as "logicalName", table_id as "tableId"
          from fx_control_table
          where deployment_id = $1
        `,
        [deploymentId],
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.tableId).toBe(1);
      expect(["products", "users"]).toContain(rows.rows[0]?.logicalName);
    });
  }, 30_000);

  it("observes an allocator that wins while the prepared plan waits", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_binding_pg_allocator_first";
      await insertDeployment(persistence, deploymentId);
      const plan = await prepareSchemaManifestAppTableBindingsV1(
        persistence.drizzle,
        {
          deploymentId,
          tables: [appDeclaration("users"), appDeclaration("products")],
        },
      );
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const allocation = runEffect(
        ensureStableTableIdentityEffect(persistence.drizzle, {
          deploymentId,
          namespace: "app",
          logicalName: "users",
        }),
      );
      let application: Promise<ApplyAttempt> | undefined;
      let released = false;
      let setupError: unknown;
      try {
        await waitForBlockedPostgresDeploymentLocks(persistence, lock, 1);
        application = attemptApply(persistence, plan);
        await waitForBlockedPostgresDeploymentLocks(persistence, lock, 2);
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
        await Promise.allSettled(
          application === undefined
            ? [allocation]
            : [allocation, application],
        );
        throw setupError;
      }

      await expect(allocation).resolves.toMatchObject({
        status: "created",
        table: { tableId: 1, logicalName: "users" },
      });
      if (application === undefined) {
        throw new Error("Expected the binding application to be queued.");
      }
      await expect(application).resolves.toMatchObject({
        status: "rejected",
        error: {
          name: "SchemaManifestTableBindingPlanStaleError",
          stale: {
            reason: "bindingChanged",
            logicalName: "users",
            plannedTableId: 2,
            currentTableId: 1,
          },
        },
      });
      await expect(
        runEffect(
          getStableTableIdentityByNameEffect(persistence.drizzle, {
            deploymentId,
            namespace: "app",
            logicalName: "products",
          }),
        ),
      ).resolves.toBeNull();
    });
  }, 30_000);
});

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

function appDeclaration(
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
        },
      },
    },
  };
}

function apply(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Promise<SchemaManifestTableDefinitionsV1> {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppTableBindingsV1InTransactionEffect(tx, prepared),
    ),
  );
}

function prepareSchemaManifestAppTableBindingsV1(
  ...args: Parameters<typeof prepareSchemaManifestAppTableBindingsV1Effect>
) {
  return runEffect(prepareSchemaManifestAppTableBindingsV1Effect(...args));
}

type ApplyAttempt =
  | {
      readonly status: "fulfilled";
      readonly section: SchemaManifestTableDefinitionsV1;
    }
  | {
      readonly status: "rejected";
      readonly error: unknown;
    };

async function attemptApply(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Promise<ApplyAttempt> {
  try {
    return { status: "fulfilled", section: await apply(persistence, prepared) };
  } catch (error) {
    return { status: "rejected", error };
  }
}
