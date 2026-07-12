import { setTimeout as delay } from "node:timers/promises";

import {
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  applySchemaManifestAppTableBindingsV1InTransaction,
  prepareSchemaManifestAppTableBindingsV1,
  type PreparedSchemaManifestAppTableBindingsV1,
  SchemaManifestTableBindingPlanStaleError,
} from "../src/schemaManifestTableBindings";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByName,
} from "../src/stableTableCatalog";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
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
      const locker = await acquireDeploymentLock(persistence, deploymentId);
      const applications = [
        apply(persistence, plan),
        apply(persistence, plan),
      ] as const;

      await releaseAfterBlocked(locker, persistence, 2, applications);
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
      const locker = await acquireDeploymentLock(persistence, deploymentId);
      const applications = [
        apply(persistence, usersPlan),
        apply(persistence, productsPlan),
      ] as const;

      await releaseAfterBlocked(locker, persistence, 2, applications);
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
      const locker = await acquireDeploymentLock(persistence, deploymentId);
      const allocation = persistence.drizzle.transaction((tx) =>
        ensureStableTableIdentityInTransaction(tx, {
          deploymentId,
          namespace: "app",
          logicalName: "users",
        }),
      );
      let application: Promise<ApplyAttempt> | undefined;
      let released = false;
      let setupError: unknown;
      try {
        await waitForBlockedDeploymentLocks(persistence, 1);
        application = attemptApply(persistence, plan);
        await waitForBlockedDeploymentLocks(persistence, 2);
        await locker.query("commit");
        released = true;
      } catch (error) {
        setupError = error;
      } finally {
        if (!released) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
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
        getStableTableIdentityByName(persistence.drizzle, {
          deploymentId,
          namespace: "app",
          logicalName: "products",
        }),
      ).resolves.toBeNull();
    });
  }, 30_000);
});

async function acquireDeploymentLock(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<PoolClient> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        select 1
        from deployments
        where deployment_id = $1
        for update
      `,
      [deploymentId],
    );
    return client;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function releaseAfterBlocked(
  locker: PoolClient,
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
  operations: ReadonlyArray<Promise<unknown>>,
): Promise<void> {
  let released = false;
  let setupError: unknown;
  try {
    await waitForBlockedDeploymentLocks(persistence, expectedBlocked);
    await locker.query("commit");
    released = true;
  } catch (error) {
    setupError = error;
  } finally {
    if (!released) {
      await locker.query("rollback").catch(() => undefined);
    }
    locker.release();
  }
  if (setupError !== undefined) {
    await Promise.allSettled(operations);
    throw setupError;
  }
}

async function waitForBlockedDeploymentLocks(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where wait_event_type = 'Lock'
          and query ilike '%from "deployments"%'
          and query ilike '%for update%'
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked deployment locks.`,
  );
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
    applySchemaManifestAppTableBindingsV1InTransaction(tx, prepared),
  );
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
