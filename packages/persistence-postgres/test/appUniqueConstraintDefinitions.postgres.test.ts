import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
  type PreparedAppUniqueConstraintDefinitionBindingV1,
} from "../src/appUniqueConstraintDefinitions";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect,
  prepareSchemaManifestAppSchemaBindingsV1Effect,
} from "../src/schemaManifestAppSchemaBindings";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  prepareSchemaVersionArtifactEffect,
} from "../src/schemaVersionArtifacts";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres immutable unique-constraint definitions", () => {
  it("serializes concurrent exact replay to one identity, definition, and binding", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const registered = await registerSchema(
        persistence,
        "deployment_unique_definition_pg_replay",
      );
      const prepared = await prepare(persistence, registered);
      const results = await Promise.all([
        ensurePrepared(persistence, prepared),
        ensurePrepared(persistence, prepared),
      ]);

      expect(results.map((result) => result.identityStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(results.map((result) => result.definitionStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(results.map((result) => result.bindingStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(await counts(persistence)).toEqual({
        identities: 1,
        definitions: 1,
        bindings: 1,
      });
    });
  }, 60_000);

  it("rolls back all three authority rows together", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const registered = await registerSchema(
        persistence,
        "deployment_unique_definition_pg_rollback",
      );
      const prepared = await prepare(persistence, registered);
      await expect(persistence.drizzle.transaction(async (tx) => {
        await runEffect(
          ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
        );
        tx.rollback();
      })).rejects.toBeDefined();
      expect(await counts(persistence)).toEqual({
        identities: 0,
        definitions: 0,
        bindings: 0,
      });
    });
  }, 60_000);
});

async function registerSchema(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
) {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  const bindings = await runEffect(
    prepareSchemaManifestAppSchemaBindingsV1Effect(persistence.drizzle, {
      deploymentId,
      tables: [appTable("users")],
      indexes: [],
    }),
  );
  const manifest = await persistence.drizzle.transaction((tx) =>
    runEffect(
      applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, bindings),
    )
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make("unique_pg_v1");
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
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
  persistence: PostgresFlarexPersistence,
  registered: Awaited<ReturnType<typeof registerSchema>>,
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
      sparse: false,
      localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
    }),
    },
  ));
}

function ensurePrepared(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedAppUniqueConstraintDefinitionBindingV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
    )
  );
}

async function counts(persistence: PostgresFlarexPersistence) {
  const result = await persistence.query<{
    identities: number;
    definitions: number;
    bindings: number;
  }>(`
    select
      (select count(*)::int from fx_control_unique_constraint) identities,
      (select count(*)::int from fx_control_unique_constraint_definition) definitions,
      (select count(*)::int from fx_control_schema_version_unique_constraint_binding) bindings
  `);
  return result.rows[0];
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
          tenantId: { fieldType: { type: "string" }, optional: false },
          email: { fieldType: { type: "string" }, optional: false },
        },
      },
    },
  };
}
