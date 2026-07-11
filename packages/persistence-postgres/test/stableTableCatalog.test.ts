import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureStableTableIdentityInput,
  FlarexPersistence,
  StableTableIdentity,
} from "../src";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityById,
  getStableTableIdentityByName,
  InvalidStableTableIdentityInputError,
  StableTableCatalogDeploymentNotFoundError,
  StableTableCatalogIdExhaustedError,
} from "../src/stableTableCatalog";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";

interface AnalyzerDerivedTableIdentity {
  readonly deploymentId: string;
  readonly namespace: "app";
  readonly logicalName: string;
  readonly tableId: number;
}

type AnalyzerOrdinalAccepted = AnalyzerDerivedTableIdentity extends
  EnsureStableTableIdentityInput
  ? true
  : false;

type PublicAllocatorMethod = Extract<
  keyof FlarexPersistence,
  "ensureStableTableIdentity" | "allocateStableTableIdentity"
>;

describe("stable table catalog", () => {
  it("keeps allocation transaction-only and analyzer ordinals out of input", () => {
    expectTypeOf<AnalyzerOrdinalAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicAllocatorMethod>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureStableTableIdentityInTransaction>[0]
      >();
    expectTypeOf<StableTableIdentity["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
  });

  it("allocates once, replays exactly, and supports deployment-qualified reads", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_catalog_a",
      projectId: "project_catalog_a",
    });

    const users = await ensure(persistence, {
      deploymentId: "deployment_catalog_a",
      namespace: "app",
      logicalName: "users",
    });
    const replay = await ensure(persistence, {
      deploymentId: "deployment_catalog_a",
      namespace: "app",
      logicalName: "users",
    });
    const payloadUsers = await ensure(persistence, {
      deploymentId: "deployment_catalog_a",
      namespace: "payload",
      logicalName: "users",
    });
    const products = await ensure(persistence, {
      deploymentId: "deployment_catalog_a",
      namespace: "app",
      logicalName: "products",
    });

    expect(users).toMatchObject({ status: "created", table: { tableId: 1 } });
    expect(replay).toEqual({ status: "existing", table: users.table });
    expect(payloadUsers).toMatchObject({
      status: "created",
      table: { tableId: 2 },
    });
    expect(products).toMatchObject({ status: "created", table: { tableId: 3 } });
    expect(users.table.createdAt).toBeInstanceOf(Date);

    await expect(
      getStableTableIdentityById(
        persistence.drizzle,
        "deployment_catalog_a",
        users.table.tableId,
      ),
    ).resolves.toEqual(users.table);
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId: "deployment_catalog_a",
        namespace: "payload",
        logicalName: "users",
      }),
    ).resolves.toEqual(payloadUsers.table);
    await expect(
      getStableTableIdentityById(
        persistence.drizzle,
        "deployment_catalog_a",
        CatalogTableIdSchema.make(99),
      ),
    ).resolves.toBeNull();
  });

  it("isolates the compact identity sequence by deployment", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    for (const suffix of ["a", "b"] as const) {
      await persistence.insertDeploymentMetadata({
        deploymentId: `deployment_isolated_${suffix}`,
        projectId: `project_isolated_${suffix}`,
      });
    }

    const [first, second] = await Promise.all([
      ensure(persistence, {
        deploymentId: "deployment_isolated_a",
        namespace: "medusa",
        logicalName: "product",
      }),
      ensure(persistence, {
        deploymentId: "deployment_isolated_b",
        namespace: "medusa",
        logicalName: "product",
      }),
    ]);

    expect(first.table.tableId).toBe(1);
    expect(second.table.tableId).toBe(1);
    expect(first.table.deploymentId).not.toBe(second.table.deploymentId);
  });

  it("fails closed for invalid ownership and names", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      ensure(persistence, {
        deploymentId: "missing_deployment",
        namespace: "app",
        logicalName: "users",
      }),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);

    await expect(
      ensure(persistence, {
        deploymentId: " ",
        namespace: "app",
        logicalName: "users",
      }),
    ).rejects.toBeInstanceOf(InvalidStableTableIdentityInputError);

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_invalid_name",
      projectId: "project_invalid_name",
    });
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_invalid_name",
        namespace: "system",
        logicalName: "\t\n",
      }),
    ).rejects.toBeInstanceOf(InvalidStableTableIdentityInputError);

    await expect(
      persistence.drizzle.transaction((tx) =>
        ensureStableTableIdentityInTransaction(tx, {
          deploymentId: "deployment_invalid_name",
          namespace: "app",
          logicalName: "analyzer_ordinal",
          // @ts-expect-error Analyzer ordinals are forbidden allocator input.
          tableId: 17,
        }),
      ),
    ).rejects.toMatchObject({
      name: "InvalidStableTableIdentityInputError",
      field: "tableId",
    });
  });

  it("does not consume an identity when the owning transaction rolls back", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_catalog_rollback",
      projectId: "project_catalog_rollback",
    });

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await ensureStableTableIdentityInTransaction(tx, {
          deploymentId: "deployment_catalog_rollback",
          namespace: "app",
          logicalName: "rolled_back",
        });
        throw new Error("injected rollback");
      }),
    ).rejects.toThrow("injected rollback");

    const committed = await ensure(persistence, {
      deploymentId: "deployment_catalog_rollback",
      namespace: "app",
      logicalName: "committed",
    });
    expect(committed).toMatchObject({
      status: "created",
      table: { tableId: 1 },
    });
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId: "deployment_catalog_rollback",
        namespace: "app",
        logicalName: "rolled_back",
      }),
    ).resolves.toBeNull();
  });

  it("enforces catalog constraints below the typed API", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_catalog_constraints",
      projectId: "project_catalog_constraints",
    });

    for (const row of [
      { tableId: 0, namespace: "app", logicalName: "zero" },
      { tableId: 1, namespace: "commerce", logicalName: "namespace" },
      { tableId: 1, namespace: "app", logicalName: "\t\n" },
    ]) {
      await expect(
        persistence.query(
          `
            insert into fx_control_table
              (deployment_id, table_id, namespace, logical_name)
            values ($1, $2, $3, $4)
          `,
          [
            "deployment_catalog_constraints",
            row.tableId,
            row.namespace,
            row.logicalName,
          ],
        ),
      ).rejects.toThrow();
    }

    await persistence.query(
      `
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values ($1, $2, $3, $4)
      `,
      [
        "deployment_catalog_constraints",
        2_147_483_647,
        "system",
        "maximum_table_id",
      ],
    );
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_catalog_constraints",
        namespace: "app",
        logicalName: "after_maximum",
      }),
    ).rejects.toBeInstanceOf(StableTableCatalogIdExhaustedError);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

function ensure(
  persistence: PGlitePersistence,
  input: EnsureStableTableIdentityInput,
) {
  return persistence.drizzle.transaction((tx) =>
    ensureStableTableIdentityInTransaction(tx, input),
  );
}
