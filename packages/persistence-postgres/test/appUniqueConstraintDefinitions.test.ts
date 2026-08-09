import {
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import {
  AppSchemaVersionUniqueConstraintBindingConflictError,
  AppUniqueConstraintCatalogParentError,
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  InvalidPreparedAppUniqueConstraintDefinitionError,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
  type PreparedAppUniqueConstraintDefinitionBindingV1,
} from "../src/appUniqueConstraintDefinitions";
import { createPGlitePersistence } from "../src/pglite";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  prepareSchemaManifestAppSchemaBindingsV1Effect,
} from "../src/schemaManifestAppSchemaBindings";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  prepareSchemaVersionArtifactEffect,
} from "../src/schemaVersionArtifacts";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("immutable app unique-constraint definitions", () => {
  it("replays exact bindings and keeps changed physical generations", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_unique_definition_generations";
    await insertDeployment(persistence, deploymentId);
    const v1 = await registerSchema(persistence, deploymentId, "unique_v1", 1);
    const created = await ensurePrepared(
      persistence,
      await prepare(persistence, v1, false),
    );
    const replay = await ensurePrepared(
      persistence,
      await prepare(persistence, v1, false),
    );

    expect(created).toMatchObject({
      identityStatus: "created",
      definitionStatus: "created",
      bindingStatus: "created",
      identity: { logicalUniqueConstraintId: 1, tableId: 1 },
      definition: { uniqueConstraintDefinitionId: 1 },
    });
    expect(replay).toMatchObject({
      identityStatus: "existing",
      definitionStatus: "existing",
      bindingStatus: "existing",
    });

    const v2 = await registerSchema(persistence, deploymentId, "unique_v2", 2);
    const replacement = await ensurePrepared(
      persistence,
      await prepare(persistence, v2, true),
    );
    expect(replacement).toMatchObject({
      identityStatus: "existing",
      definitionStatus: "created",
      bindingStatus: "created",
      identity: { logicalUniqueConstraintId: 1 },
      definition: { uniqueConstraintDefinitionId: 2, physicalSpec: { sparse: true } },
    });

    const counts = await persistence.query<{
      identities: number;
      definitions: number;
      bindings: number;
    }>(`
      select
        (select count(*)::int from fx_control_unique_constraint) identities,
        (select count(*)::int from fx_control_unique_constraint_definition) definitions,
        (select count(*)::int from fx_control_schema_version_unique_constraint_binding) bindings
    `);
    expect(counts.rows[0]).toEqual({ identities: 1, definitions: 2, bindings: 2 });
  });

  it("rejects a competing generation for an already-bound schema version", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_unique_binding_conflict";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerSchema(
      persistence,
      deploymentId,
      "unique_conflict_v1",
      1,
    );
    await ensurePrepared(
      persistence,
      await prepare(persistence, registered, false),
    );

    await expect(
      ensurePrepared(persistence, await prepare(persistence, registered, true)),
    ).rejects.toBeInstanceOf(
      AppSchemaVersionUniqueConstraintBindingConflictError,
    );
    const count = await persistence.query<{ count: number }>(
      "select count(*)::int count from fx_control_unique_constraint_definition",
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it("rolls back identity, definition, and binding atomically", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_unique_definition_rollback";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerSchema(
      persistence,
      deploymentId,
      "unique_rollback_v1",
      1,
    );
    const prepared = await prepare(persistence, registered, false);
    await expect(persistence.drizzle.transaction(async (tx) => {
      await runEffect(
        ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
      );
      tx.rollback();
    })).rejects.toBeDefined();

    for (const table of [
      "fx_control_unique_constraint",
      "fx_control_unique_constraint_definition",
      "fx_control_schema_version_unique_constraint_binding",
    ]) {
      const result = await persistence.query<{ count: number }>(
        `select count(*)::int count from ${table}`,
      );
      expect(result.rows[0]?.count).toBe(0);
    }
  });

  it("rejects structurally forged preparation tokens", async () => {
    const persistence = await migratedPersistence();
    const failure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(
        ensureAppUniqueConstraintDefinitionBindingV1InTransaction(
          tx,
          Object.freeze({
            deploymentId: "forged",
            schemaVersionId: schemaId("forged"),
            tableId: CatalogTableIdSchema.make(1),
            descriptor: "by_email",
          }) as PreparedAppUniqueConstraintDefinitionBindingV1,
        ),
      )
    );
    expect(failure).toBeInstanceOf(
      InvalidPreparedAppUniqueConstraintDefinitionError,
    );
  });

  it("rejects decodable manifest JSON that disagrees with stored evidence", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_unique_tampered_manifest";
    await insertDeployment(persistence, deploymentId);
    const registered = await registerSchema(
      persistence,
      deploymentId,
      "unique_tampered_v1",
      1,
    );
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_json = jsonb_set(
          manifest_json,
          '{tableDefinitions,tables,0,logicalName}',
          '"tampered"'::jsonb
        )
        where deployment_id = $1 and schema_version_id = $2
      `,
      [deploymentId, registered.schemaVersionId],
    );

    await expect(
      prepare(persistence, registered, false),
    ).rejects.toMatchObject({
      _tag: "SchemaVersionArtifactCorruptionError",
    });
  });

  it("rejects a deployment table omitted from the exact schema", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_unique_omitted_table";
    await insertDeployment(persistence, deploymentId);
    const users = await registerSchema(
      persistence,
      deploymentId,
      "unique_users_v1",
      1,
    );
    const recipes = await registerSchema(
      persistence,
      deploymentId,
      "unique_recipes_v2",
      2,
      "recipes",
    );
    await expect(prepare(
      persistence,
      { ...users, schemaVersionId: recipes.schemaVersionId },
      false,
    )).rejects.toMatchObject({
      _tag: "AppUniqueConstraintCatalogParentError",
      parent: "schemaTableBinding",
    } satisfies Partial<AppUniqueConstraintCatalogParentError>);
    const result = await persistence.query<{ count: number }>(
      "select count(*)::int count from fx_control_unique_constraint",
    );
    expect(result.rows[0]?.count).toBe(0);
  });
});

type Persistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<Persistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertDeployment(persistence: Persistence, deploymentId: string) {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

async function registerSchema(
  persistence: Persistence,
  deploymentId: string,
  schemaVersionIdValue: string,
  version: number,
  tableName = "users",
) {
  const preparedBindings = await runEffect(
    prepareSchemaManifestAppSchemaBindingsV1Effect(persistence.drizzle, {
      deploymentId,
      tables: [appTable(tableName)],
      indexes: [],
    }),
  );
  const manifest = await persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(
        tx,
        preparedBindings,
      ),
    )
  );
  const schemaVersionId = schemaId(schemaVersionIdValue);
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(version),
    manifest,
  }));
  await persistence.drizzle.transaction((tx) =>
    runEffect(ensureSchemaVersionArtifactInTransactionEffect(tx, artifact))
  );
  const table = manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Expected registered app table.");
  return Object.freeze({ deploymentId, schemaVersionId, tableId: table.tableId });
}

function prepare(
  persistence: Persistence,
  registered: Awaited<ReturnType<typeof registerSchema>>,
  sparse: boolean,
) {
  return runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(
    persistence.drizzle,
    {
    ...registered,
    descriptor: SchemaManifestAppIndexDescriptorSchema.make(
      "by_tenant_email",
    ),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
      kind: "appUniqueConstraint",
      specVersion: 1,
      orderedFields: ["tenantId", "email"],
      sparse,
      localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
    }),
    },
  ));
}

function ensurePrepared(
  persistence: Persistence,
  prepared: PreparedAppUniqueConstraintDefinitionBindingV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
    )
  );
}

function schemaId(value: string): CatalogSchemaVersionId {
  return CatalogSchemaVersionIdSchema.make(value);
}

function appTable(logicalName: string): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          tenantId: {
            fieldType: { type: "string" },
            optional: false,
          },
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}
