import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import {
  prepareAppSchemaCatalogPublicationV2,
  type PreparedAppSchemaCatalogPublicationV2,
} from "../src/appSchemaCatalogPublicationV2";
import { publishPreparedAppSchemaCatalogV2InTransaction } from "../src/appSchemaCatalogPublicationV2Transaction";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres app-schema catalog V2 publication", () => {
  it("publishes and exactly replays the full projection sequentially", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_catalog_v2_pg_replay";
      await insertDeployment(persistence, deploymentId);
      const input = publicationInput(
        deploymentId,
        "schema_catalog_v2_pg_replay",
      );
      const prepared = await prepareAppSchemaCatalogPublicationV2(
        persistence.drizzle,
        input,
      );

      const created = await publishPrepared(persistence, prepared);
      const replayed = await publishPrepared(
        persistence,
        await prepareAppSchemaCatalogPublicationV2(persistence.drizzle, input),
      );

      expect(created.creationTimeIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([1]);
      expect(created.developerIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([2]);
      expect(replayed.creationTimeIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([1]);
      expect(replayed.developerIndexDefinitions.map(
        (definition) => definition.indexDefinitionId,
      )).toEqual([2]);
      expect(replayed.artifact.manifestJson).toEqual(replayed.manifest);
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 1,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    });
  }, 30_000);

  it("rolls the whole projection back with its caller transaction", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_catalog_v2_pg_rollback";
      await insertDeployment(persistence, deploymentId);
      const prepared = await prepareAppSchemaCatalogPublicationV2(
        persistence.drizzle,
        publicationInput(deploymentId, "schema_catalog_v2_pg_rollback"),
      );

      await expect(
        persistence.drizzle.transaction(async (tx) => {
          await publishPreparedAppSchemaCatalogV2InTransaction(tx, prepared);
          throw new Error("injected real Postgres D2c rollback");
        }),
      ).rejects.toThrow("injected real Postgres D2c rollback");
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 0,
        indexes: 0,
        schemaVersions: 0,
        definitions: 0,
        schemaBindings: 0,
        buildStates: 0,
      });

      const committed = await publishPrepared(persistence, prepared);
      expect(committed.creationTimeIndexDefinitions[0]?.indexDefinitionId).toBe(1);
      expect(committed.developerIndexDefinitions[0]?.indexDefinitionId).toBe(2);
    });
  }, 30_000);
});

function publicationInput(deploymentId: string, schemaVersionId: string) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [appIndex("users", "byEmail", ["email"])],
  };
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
          email: {
            fieldType: { type: "string" },
            optional: false,
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

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function publishPrepared(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedAppSchemaCatalogPublicationV2,
) {
  return persistence.drizzle.transaction((tx) =>
    publishPreparedAppSchemaCatalogV2InTransaction(tx, prepared)
  );
}

async function catalogCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<{
  readonly tables: number;
  readonly indexes: number;
  readonly schemaVersions: number;
  readonly definitions: number;
  readonly schemaBindings: number;
  readonly buildStates: number;
}> {
  const result = await persistence.query<{
    tables: number;
    indexes: number;
    schema_versions: number;
    definitions: number;
    schema_bindings: number;
    build_states: number;
  }>(
    `
      select
        (select count(*)::int from fx_control_table where deployment_id = $1) as tables,
        (select count(*)::int from fx_control_index where deployment_id = $1) as indexes,
        (select count(*)::int from fx_control_schema_version where deployment_id = $1) as schema_versions,
        (select count(*)::int from fx_control_index_definition where deployment_id = $1) as definitions,
        (select count(*)::int from fx_control_schema_version_index_binding where deployment_id = $1) as schema_bindings,
        (select count(*)::int from fx_system_index_build_state) as build_states
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected catalog count row.");
  return {
    tables: row.tables,
    indexes: row.indexes,
    schemaVersions: row.schema_versions,
    definitions: row.definitions,
    schemaBindings: row.schema_bindings,
    buildStates: row.build_states,
  };
}
