import {
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  FlarexMetadataDatabase,
  FlarexPersistence,
} from "../src";
import { getSchemaVersionArtifactByVersion } from "../src/schemaVersionArtifacts";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppTableBindingsV1InTransaction,
  InvalidPreparedSchemaManifestTableBindingsError,
  InvalidSchemaManifestTableBindingInputError,
  prepareSchemaManifestAppTableBindingsV1,
  type PrepareSchemaManifestAppTableBindingsV1Input,
  type PreparedSchemaManifestAppTableBindingsV1,
} from "../src/schemaManifestTableBindings";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByName,
  StableTableCatalogDeploymentNotFoundError,
} from "../src/stableTableCatalog";

type PublicBindingMethod = Extract<
  keyof FlarexPersistence,
  | "prepareSchemaManifestAppTableBindingsV1"
  | "applySchemaManifestAppTableBindingsV1InTransaction"
>;

type PublicBindingExport = Extract<
  keyof typeof import("../src"),
  | "prepareSchemaManifestAppTableBindingsV1"
  | "applySchemaManifestAppTableBindingsV1InTransaction"
>;

describe("schema manifest app table bindings", () => {
  it("keeps optimistic planning and allocation behind concrete boundaries", () => {
    expectTypeOf<PublicBindingMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicBindingExport>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<
          typeof applySchemaManifestAppTableBindingsV1InTransaction
        >[0]
      >();
    expectTypeOf<PrepareSchemaManifestAppTableBindingsV1Input>()
      .not.toMatchTypeOf<PreparedSchemaManifestAppTableBindingsV1>();
    expectTypeOf<
      PreparedSchemaManifestAppTableBindingsV1["section"]
    >().toEqualTypeOf<SchemaManifestTableDefinitionsV1>();
  });

  it("plans name-order candidates and replays the exact committed bindings", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_deterministic";
    await insertDeployment(persistence, deploymentId);

    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );

    expect(tableIdentities(plan.section)).toEqual([
      { logicalName: "products", tableId: 1 },
      { logicalName: "users", tableId: 2 },
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.section)).toBe(true);
    expect(Object.isFrozen(plan.section.tables)).toBe(true);
    expect(Object.isFrozen(plan.section.tables[0]?.definition.documentType))
      .toBe(true);

    const first = await apply(persistence, plan);
    const replay = await apply(persistence, plan);
    const replanned = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("products"), appDeclaration("users")],
      },
    );
    const replayFromFreshPlan = await apply(persistence, replanned);

    expect(first).toEqual(plan.section);
    expect(replay).toEqual(plan.section);
    expect(replayFromFreshPlan).toEqual(plan.section);
    expect(
      await getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        deploymentId,
        CatalogSchemaVersionSchema.make(1),
      ),
    ).toBeNull();
  });

  it("keeps existing IDs and emits the final section in numeric ID order", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_existing";
    await insertDeployment(persistence, deploymentId);

    const users = await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "users",
    });
    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });

    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );
    expect(tableIdentities(plan.section)).toEqual([
      { logicalName: "users", tableId: users.table.tableId },
      { logicalName: "products", tableId: 3 },
    ]);

    await apply(persistence, plan);
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "products",
      }),
    ).resolves.toMatchObject({ tableId: 3 });
  });

  it("rejects malformed and duplicate declarations before allocating", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_invalid";
    await insertDeployment(persistence, deploymentId);

    await expect(
      Reflect.apply(prepareSchemaManifestAppTableBindingsV1, undefined, [
        persistence.drizzle,
        {
          deploymentId,
          tables: [
            { ...appDeclaration("users"), tableId: 42 },
          ],
        },
      ]),
    ).rejects.toBeInstanceOf(InvalidSchemaManifestTableBindingInputError);
    await expect(
      prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("users")],
      }),
    ).rejects.toBeInstanceOf(InvalidSchemaManifestTableBindingInputError);
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("fails stale when an unrelated allocation changes the observed frontier", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_stale_frontier";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: { reason: "catalogHighWaterChanged" },
    });
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("fails stale when a planned logical name is bound to another ID", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_changed";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "payload",
      logicalName: "payload_internal",
    });
    await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "users",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: {
        reason: "bindingChanged",
        logicalName: "users",
        plannedTableId: 1,
        currentTableId: 2,
      },
    });
  });

  it("fails stale rather than completing a partially applied plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_partial";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      {
        deploymentId,
        tables: [appDeclaration("users"), appDeclaration("products")],
      },
    );

    await ensureTable(persistence, {
      deploymentId,
      namespace: "app",
      logicalName: "products",
    });

    await expect(apply(persistence, plan)).rejects.toMatchObject({
      name: "SchemaManifestTableBindingPlanStaleError",
      stale: { reason: "partiallyApplied" },
    });
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();
  });

  it("rolls planned IDs back with the caller-owned transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_rollback";
    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [appDeclaration("users")] },
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await applySchemaManifestAppTableBindingsV1InTransaction(tx, plan);
        throw new Error("injected rollback");
      }),
    ).rejects.toThrow("injected rollback");
    await expect(
      getStableTableIdentityByName(persistence.drizzle, {
        deploymentId,
        namespace: "app",
        logicalName: "users",
      }),
    ).resolves.toBeNull();

    await expect(apply(persistence, plan)).resolves.toEqual(plan.section);
  });

  it("supports empty schemas, rejects missing deployments, and authenticates plans", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_binding_empty";
    await expect(
      prepareSchemaManifestAppTableBindingsV1(persistence.drizzle, {
        deploymentId: "missing_binding_deployment",
        tables: [],
      }),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);

    await insertDeployment(persistence, deploymentId);
    const plan = await prepareSchemaManifestAppTableBindingsV1(
      persistence.drizzle,
      { deploymentId, tables: [] },
    );
    await expect(apply(persistence, plan)).resolves.toMatchObject({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [],
    });

    await expect(
      persistence.drizzle.transaction((tx) =>
        Reflect.apply(
          applySchemaManifestAppTableBindingsV1InTransaction,
          undefined,
          [tx, { deploymentId, section: plan.section }],
        ),
      ),
    ).rejects.toBeInstanceOf(InvalidPreparedSchemaManifestTableBindingsError);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertDeployment(
  persistence: PGlitePersistence,
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

function tableIdentities(
  section: SchemaManifestTableDefinitionsV1,
): ReadonlyArray<{ readonly logicalName: string; readonly tableId: number }> {
  return section.tables.map((table) => ({
    logicalName: table.logicalName,
    tableId: table.tableId,
  }));
}

function apply(
  persistence: PGlitePersistence,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Promise<SchemaManifestTableDefinitionsV1> {
  return persistence.drizzle.transaction((tx) =>
    applySchemaManifestAppTableBindingsV1InTransaction(tx, prepared),
  );
}

function ensureTable(
  persistence: PGlitePersistence,
  input: Parameters<typeof ensureStableTableIdentityInTransaction>[1],
) {
  return persistence.drizzle.transaction((tx) =>
    ensureStableTableIdentityInTransaction(tx, input),
  );
}
