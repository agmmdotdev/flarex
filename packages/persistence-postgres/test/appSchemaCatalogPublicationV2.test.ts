import {
  AppSchemaCatalogCompilationErrorV1,
  compileAppSchemaCatalogRequirementsV1,
  type CompiledAppSchemaCatalogRequirementsV1,
} from "flarex-protocol/app-schema-catalog";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

// @ts-expect-error D2a's prepared token must remain absent from the package root.
import type { PreparedAppSchemaCatalogPublicationV2 as RootPreparedAppSchemaCatalogPublicationV2 } from "../src";
import type { FlarexPersistence } from "../src";
import {
  getPreparedAppSchemaCatalogPublicationV2State,
  InvalidAppSchemaCatalogPublicationV2InputError,
  InvalidPreparedAppSchemaCatalogPublicationV2Error,
  prepareAppSchemaCatalogPublicationV2,
  type PrepareAppSchemaCatalogPublicationV2Input,
  type PreparedAppSchemaCatalogPublicationV2,
} from "../src/appSchemaCatalogPublicationV2";
import type { PreparedAppSchemaVersionArtifactV1 } from "../src/appSchemaVersionArtifacts";
import { createPGlitePersistence } from "../src/pglite";
import { ensureSchemaVersionArtifactInTransaction } from "../src/schemaVersionArtifacts";
import { StableTableCatalogDeploymentNotFoundError } from "../src/stableTableCatalog";

type PublicD2aExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppSchemaCatalogPublicationV2"
  | "getPreparedAppSchemaCatalogPublicationV2State"
>;

type PublicD2Method = Extract<
  keyof FlarexPersistence,
  | "prepareAppSchemaCatalogPublicationV2"
  | "ensureAppSchemaVersionArtifactV2"
>;

type PreparedTokenStringKey = Extract<
  keyof PreparedAppSchemaCatalogPublicationV2,
  string
>;

type CallerCompiledInput = Omit<
  PrepareAppSchemaCatalogPublicationV2Input,
  "compiledRequirements"
> & {
  readonly compiledRequirements: CompiledAppSchemaCatalogRequirementsV1;
};

type CallerCompiledInputAccepted = CallerCompiledInput extends
  PrepareAppSchemaCatalogPublicationV2Input
  ? true
  : false;

describe("app-schema catalog publication v2 preparation", () => {
  it("keeps the no-write preparation seam package-internal and opaque", () => {
    expectTypeOf<PublicD2aExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicD2Method>().toEqualTypeOf<never>();
    expectTypeOf<PreparedTokenStringKey>().toEqualTypeOf<
      "deploymentId" | "schemaVersionId" | "version"
    >();
    expectTypeOf<CallerCompiledInputAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PreparedAppSchemaCatalogPublicationV2>()
      .not.toEqualTypeOf<PreparedAppSchemaVersionArtifactV1>();
  });

  it("couples one bound plan, D1 result, and full artifact without writes", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_prepare";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(deploymentId, "schema_catalog_v2_prepare");
    const before = await catalogCounts(persistence, deploymentId);

    const prepared = await prepareAppSchemaCatalogPublicationV2(
      persistence.drizzle,
      input,
    );
    const state = getPreparedAppSchemaCatalogPublicationV2State(prepared);

    expect(Object.keys(prepared).sort()).toEqual([
      "deploymentId",
      "schemaVersionId",
      "version",
    ]);
    expect(prepared).toMatchObject({
      deploymentId,
      schemaVersionId: "schema_catalog_v2_prepare",
      version: 1,
    });
    expect(state.logicalBindings.manifest.tableDefinitions.tables.map(
      (table) => ({ tableId: table.tableId, logicalName: table.logicalName }),
    )).toEqual([
      { tableId: 1, logicalName: "posts" },
      { tableId: 2, logicalName: "users" },
    ]);
    expect(state.logicalBindings.manifest.indexBindings.indexes.map(
      (index) => ({
        logicalIndexId: index.logicalIndexId,
        tableId: index.tableId,
        descriptor: index.descriptor,
      }),
    )).toEqual([
      { logicalIndexId: 1, tableId: 1, descriptor: "byAuthor" },
      { logicalIndexId: 2, tableId: 2, descriptor: "byEmail" },
    ]);
    expect(state.requirements.creationTimeIndexes).toHaveLength(2);
    expect(state.requirements.developerIndexes.map((index) => ({
      logicalIndexId: index.logicalIndexId,
      accessPath: index.canonical.physicalSpec.accessPath,
    }))).toEqual([
      { logicalIndexId: 1, accessPath: "developer" },
      { logicalIndexId: 2, accessPath: "developer" },
    ]);
    expect(state.requirements).toEqual(
      await compileAppSchemaCatalogRequirementsV1(
        state.logicalBindings.manifest,
      ),
    );
    expect(state.artifact).toMatchObject({
      deploymentId,
      schemaVersionId: "schema_catalog_v2_prepare",
      version: 1,
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.logicalBindings)).toBe(true);
    expect(Object.isFrozen(state.requirements)).toBe(true);
    expect(Object.isFrozen(state.artifact)).toBe(true);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual(
      before,
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const result = await ensureSchemaVersionArtifactInTransaction(
          tx,
          state.artifact,
        );
        expect(result.artifact.manifestJson).toEqual(
          state.logicalBindings.manifest,
        );
        throw new Error("injected D2a artifact-coupling rollback");
      }),
    ).rejects.toThrow("injected D2a artifact-coupling rollback");
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual(
      before,
    );
  });

  it("rejects copied, spread, serialized, and structural token forgeries", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_forgery";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaCatalogPublicationV2(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_catalog_v2_forgery"),
    );
    const forgeries: ReadonlyArray<unknown> = [
      { ...prepared },
      JSON.parse(JSON.stringify(prepared)),
      {
        deploymentId: prepared.deploymentId,
        schemaVersionId: prepared.schemaVersionId,
        version: prepared.version,
      },
    ];

    for (const forgery of forgeries) {
      expect(() =>
        Reflect.apply(
          getPreparedAppSchemaCatalogPublicationV2State,
          undefined,
          [forgery],
        )
      ).toThrow(InvalidPreparedAppSchemaCatalogPublicationV2Error);
    }
  });

  it("snapshots every declaration before the first database await", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_snapshot";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(deploymentId, "schema_catalog_v2_snapshot");
    const preparation = prepareAppSchemaCatalogPublicationV2(
      persistence.drizzle,
      input,
    );
    const firstTable = input.tables[0];
    const firstIndex = input.indexes[0];
    if (firstTable === undefined || firstIndex === undefined) {
      throw new Error("Expected mutable publication fixtures.");
    }
    replaceOwnDataProperty(firstTable, "logicalName", "changedAfterCall");
    replaceOwnDataProperty(firstIndex.fields, 0, "changedAfterCall");

    const prepared = await preparation;
    const state = getPreparedAppSchemaCatalogPublicationV2State(prepared);
    expect(state.logicalBindings.manifest.tableDefinitions.tables.map(
      (table) => table.logicalName,
    )).toEqual(["posts", "users"]);
    expect(state.logicalBindings.manifest.indexBindings.indexes.map(
      (index) => [...index.spec.fields],
    )).toEqual([["authorId"], ["email"]]);
    expect(Object.isFrozen(input)).toBe(false);
  });

  it("rejects every non-exact or caller-authored preparation shape", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_shape";
    await insertDeployment(persistence, deploymentId);
    const valid = publicationInput(deploymentId, "schema_catalog_v2_shape");
    const { indexes: _indexes, ...missingIndexes } = valid;
    const inherited = Object.create(valid);
    const symbolExtra = { ...valid, [Symbol("extra")]: true };
    const callerAuthored = {
      ...valid,
      manifest: { caller: true },
      compiledRequirements: { caller: true },
      indexDefinitionIds: [1],
      lifecycle: "enabled",
      readiness: "ready",
    };
    let getterInvoked = false;
    const accessor = { ...valid };
    Object.defineProperty(accessor, "deploymentId", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return deploymentId;
      },
    });

    for (const invalid of [
      null,
      missingIndexes,
      inherited,
      symbolExtra,
      callerAuthored,
      accessor,
    ]) {
      await expect(
        Reflect.apply(prepareAppSchemaCatalogPublicationV2, undefined, [
          persistence.drizzle,
          invalid,
        ]),
      ).rejects.toBeInstanceOf(
        InvalidAppSchemaCatalogPublicationV2InputError,
      );
    }
    expect(getterInvoked).toBe(false);
  });

  it("propagates D1 semantic failures without writing a partial plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_semantic";
    await insertDeployment(persistence, deploymentId);
    const before = await catalogCounts(persistence, deploymentId);
    const impossibleField = publicationInput(
      deploymentId,
      "schema_catalog_v2_impossible",
    );
    const firstIndex = impossibleField.indexes[0];
    if (firstIndex === undefined) throw new Error("Expected an index fixture.");
    replaceOwnDataProperty(firstIndex.fields, 0, "missing.path");

    await expect(
      prepareAppSchemaCatalogPublicationV2(
        persistence.drizzle,
        impossibleField,
      ),
    ).rejects.toMatchObject({
      name: "AppSchemaCatalogCompilationErrorV1",
      issue: { reason: "impossibleIndexField", fieldPath: "missing.path" },
    });

    const unknownTarget = publicationInput(
      deploymentId,
      "schema_catalog_v2_unknown_target",
    );
    const firstTable = unknownTarget.tables[0];
    if (firstTable === undefined) throw new Error("Expected a table fixture.");
    replaceOwnDataProperty(
      firstTable.definition.documentType.value,
      "unknown",
      {
        fieldType: { type: "id", tableName: "missing" },
        optional: false,
      },
    );
    await expect(
      prepareAppSchemaCatalogPublicationV2(
        persistence.drizzle,
        unknownTarget,
      ),
    ).rejects.toBeInstanceOf(AppSchemaCatalogCompilationErrorV1);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual(
      before,
    );
  });

  it("propagates a missing deployment before producing a token", async () => {
    const persistence = await migratedPersistence();
    await expect(
      prepareAppSchemaCatalogPublicationV2(
        persistence.drizzle,
        publicationInput("missing_deployment", "schema_catalog_v2_missing"),
      ),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);
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

function publicationInput(deploymentId: string, schemaVersionId: string) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: [
      appTable("users", {
        email: appField({ type: "string" }),
      }),
      appTable("posts", {
        authorId: appField({ type: "id", tableName: "users" }),
      }),
    ],
    indexes: [
      appIndex("users", "byEmail", ["email"]),
      appIndex("posts", "byAuthor", ["authorId"]),
    ],
  };
}

function appTable(
  logicalName: string,
  value: Record<string, ReturnType<typeof appField>>,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: { type: "object", value },
    },
  };
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: string[],
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

function appField(
  fieldType:
    | { readonly type: "string" }
    | { readonly type: "id"; readonly tableName: string },
) {
  return { fieldType, optional: false };
}

async function catalogCounts(
  persistence: PGlitePersistence,
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

function replaceOwnDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
