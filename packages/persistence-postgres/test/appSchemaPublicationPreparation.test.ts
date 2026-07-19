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
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// @ts-expect-error D2a's prepared token must remain absent from the package root.
import type { PreparedAppSchemaPublicationV1 as RootPreparedAppSchemaPublicationV1 } from "../src";
// @ts-expect-error D2d's authenticated source must remain absent from the package root.
import type { AppSchemaPublicationV1Source as RootAppSchemaPublicationV1Source } from "../src";
// @ts-expect-error D2d's repository port must remain absent from the package root.
import type { AppSchemaPublicationV1Repository as RootAppSchemaPublicationV1Repository } from "../src";
import type {
  AppSchemaPublicationV1Result,
  PublishAppSchemaV1Input,
  PublishAppSchemaV1Result,
  FlarexPersistence,
} from "../src";
import {
  getPreparedAppSchemaPublicationV1State,
  InvalidAppSchemaPublicationV1InputError,
  InvalidPreparedAppSchemaPublicationV1Error,
  prepareAppSchemaPublicationV1,
  type PrepareAppSchemaPublicationV1Input,
  type PreparedAppSchemaPublicationV1,
} from "../src/appSchemaPublicationPreparation";
import {
  AppSchemaPublicationV1ProjectionError,
  publishPreparedAppSchemaV1InTransaction,
} from "../src/appSchemaPublicationTransaction";
import type { PreparedAppTableDefinitionsArtifactV1 } from "../src/appTableDefinitionsArtifacts";
import {
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  prepareAppDeveloperIndexDefinitionBindingV1,
} from "../src/appIndexDefinitions";
import { createPGlitePersistence } from "../src/pglite";
import {
  ensureSchemaVersionArtifactInTransaction,
  SchemaVersionArtifactConflictError,
  SchemaVersionArtifactCorruptionError,
} from "../src/schemaVersionArtifacts";
import { StableTableCatalogDeploymentNotFoundError } from "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";

type PublicInternalPublicationExport = Extract<
  keyof typeof import("../src"),
  | "prepareAppSchemaPublicationV1"
  | "getPreparedAppSchemaPublicationV1State"
  | "snapshotAppSchemaPublicationV1Input"
  | "prepareAppSchemaPublicationV1FromSource"
  | "publishPreparedAppSchemaV1InTransaction"
  | "publishAppSchemaV1WithRepository"
  | "runAppSchemaPublicationV1Attempts"
  | "enforceAppSchemaPublicationV1DeclarationQuotas"
  | "enforceAppSchemaPublicationV1CanonicalByteLowerBound"
  | "enforceAppSchemaPublicationV1CanonicalByteQuota"
  | "InvalidAppSchemaPublicationV1SourceError"
>;

type PublicFullPublicationMethod = Extract<
  keyof FlarexPersistence,
  "publishAppSchemaV1"
>;

type PublicInternalPersistenceMethod = Extract<
  keyof FlarexPersistence,
  | "prepareAppSchemaPublicationV1"
  | "publishPreparedAppSchemaV1InTransaction"
>;

type AmbiguousLegacyOperationMethod = Extract<
  keyof FlarexPersistence,
  | "ensureAppSchemaVersionArtifactV1"
  | "ensureAppSchemaVersionArtifactV2"
>;

type PublicPublicationTerminalErrorExport = Extract<
  keyof typeof import("../src"),
  | "AppCreationTimeIndexDefinitionChecksumCollisionError"
  | "AppCreationTimeIndexDefinitionParentError"
  | "AppCreationTimeIndexDefinitionRequirementError"
  | "AppDeveloperIndexDefinitionRequirementError"
  | "AppIndexDefinitionChecksumCollisionError"
  | "AppIndexDefinitionIdExhaustedError"
  | "AppIndexDefinitionParentError"
  | "AppIndexDefinitionPreparationError"
  | "AppSchemaVersionIndexBindingConflictError"
  | "InvalidSchemaManifestAppSchemaBindingInputError"
  | "SchemaManifestTableBindingCorruptionError"
  | "StableLogicalIndexCatalogIdExhaustedError"
>;

type PreparedTokenStringKey = Extract<
  keyof PreparedAppSchemaPublicationV1,
  string
>;

type CallerCompiledInput = Omit<
  PrepareAppSchemaPublicationV1Input,
  "compiledRequirements"
> & {
  readonly compiledRequirements: CompiledAppSchemaCatalogRequirementsV1;
};

type CallerCompiledInputAccepted = CallerCompiledInput extends
  PrepareAppSchemaPublicationV1Input
  ? true
  : false;

type PublicPublicationInput = Parameters<
  FlarexPersistence["publishAppSchemaV1"]
>[0];

type PublicPublicationResult = Awaited<
  ReturnType<FlarexPersistence["publishAppSchemaV1"]>
>;

describe("app-schema V1 publication preparation", () => {
  it("keeps the no-write preparation seam package-internal and opaque", () => {
    expectTypeOf<PublicInternalPublicationExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicFullPublicationMethod>()
      .toEqualTypeOf<"publishAppSchemaV1">();
    expectTypeOf<PublicInternalPersistenceMethod>().toEqualTypeOf<never>();
    expectTypeOf<AmbiguousLegacyOperationMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicPublicationTerminalErrorExport>().toEqualTypeOf<
      | "AppCreationTimeIndexDefinitionChecksumCollisionError"
      | "AppCreationTimeIndexDefinitionParentError"
      | "AppCreationTimeIndexDefinitionRequirementError"
      | "AppDeveloperIndexDefinitionRequirementError"
      | "AppIndexDefinitionChecksumCollisionError"
      | "AppIndexDefinitionIdExhaustedError"
      | "AppIndexDefinitionParentError"
      | "AppIndexDefinitionPreparationError"
      | "AppSchemaVersionIndexBindingConflictError"
      | "InvalidSchemaManifestAppSchemaBindingInputError"
      | "SchemaManifestTableBindingCorruptionError"
      | "StableLogicalIndexCatalogIdExhaustedError"
    >();
    expectTypeOf<PreparedTokenStringKey>().toEqualTypeOf<
      "deploymentId" | "schemaVersionId" | "version"
    >();
    expectTypeOf<CallerCompiledInputAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicPublicationInput>()
      .toEqualTypeOf<PublishAppSchemaV1Input>();
    expectTypeOf<PublicPublicationResult>()
      .toEqualTypeOf<PublishAppSchemaV1Result>();
    expectTypeOf<PublicPublicationResult>()
      .toEqualTypeOf<AppSchemaPublicationV1Result>();
    expectTypeOf<PreparedAppSchemaPublicationV1>()
      .not.toEqualTypeOf<PreparedAppTableDefinitionsArtifactV1>();
  });

  it("couples one bound plan, D1 result, and full artifact without writes", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_prepare";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(deploymentId, "schema_publication_v1_prepare");
    const before = await catalogCounts(persistence, deploymentId);

    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      input,
    );
    const state = getPreparedAppSchemaPublicationV1State(prepared);

    expect(Object.keys(prepared).sort()).toEqual([
      "deploymentId",
      "schemaVersionId",
      "version",
    ]);
    expect(prepared).toMatchObject({
      deploymentId,
      schemaVersionId: "schema_publication_v1_prepare",
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
      schemaVersionId: "schema_publication_v1_prepare",
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
    const deploymentId = "deployment_schema_publication_v1_forgery";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_publication_v1_forgery"),
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
          getPreparedAppSchemaPublicationV1State,
          undefined,
          [forgery],
        )
      ).toThrow(InvalidPreparedAppSchemaPublicationV1Error);
    }
  });

  it("snapshots every declaration before the first database await", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_snapshot";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(deploymentId, "schema_publication_v1_snapshot");
    const preparation = prepareAppSchemaPublicationV1(
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
    const state = getPreparedAppSchemaPublicationV1State(prepared);
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
    const deploymentId = "deployment_schema_publication_v1_shape";
    await insertDeployment(persistence, deploymentId);
    const valid = publicationInput(deploymentId, "schema_publication_v1_shape");
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
        Reflect.apply(prepareAppSchemaPublicationV1, undefined, [
          persistence.drizzle,
          invalid,
        ]),
      ).rejects.toBeInstanceOf(
        InvalidAppSchemaPublicationV1InputError,
      );
    }
    expect(getterInvoked).toBe(false);
  });

  it("propagates D1 semantic failures without writing a partial plan", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_semantic";
    await insertDeployment(persistence, deploymentId);
    const before = await catalogCounts(persistence, deploymentId);
    const impossibleField = publicationInput(
      deploymentId,
      "schema_publication_v1_impossible",
    );
    const firstIndex = impossibleField.indexes[0];
    if (firstIndex === undefined) throw new Error("Expected an index fixture.");
    replaceOwnDataProperty(firstIndex.fields, 0, "missing.path");

    await expect(
      prepareAppSchemaPublicationV1(
        persistence.drizzle,
        impossibleField,
      ),
    ).rejects.toMatchObject({
      name: "AppSchemaCatalogCompilationErrorV1",
      issue: { reason: "impossibleIndexField", fieldPath: "missing.path" },
    });

    const unknownTarget = publicationInput(
      deploymentId,
      "schema_publication_v1_unknown_target",
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
      prepareAppSchemaPublicationV1(
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
      prepareAppSchemaPublicationV1(
        persistence.drizzle,
        publicationInput("missing_deployment", "schema_publication_v1_missing"),
      ),
    ).rejects.toBeInstanceOf(StableTableCatalogDeploymentNotFoundError);
  });
});

describe("app-schema V1 publication transaction", () => {
  it("publishes and exactly replays the complete normalized projection", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_publish";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(deploymentId, "schema_publication_v1_publish");
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      input,
    );

    const created = await publishPrepared(persistence, prepared);
    expect(created.manifest).toEqual(created.artifact.manifestJson);
    expect(created.creationTimeIndexDefinitions.map((definition) => ({
      indexDefinitionId: definition.indexDefinitionId,
      access: definition.access,
    }))).toEqual([
      { indexDefinitionId: 1, access: { kind: "by_creation_time", tableId: 1 } },
      { indexDefinitionId: 2, access: { kind: "by_creation_time", tableId: 2 } },
    ]);
    expect(created.developerIndexDefinitions.map((definition) => ({
      indexDefinitionId: definition.indexDefinitionId,
      access: definition.access,
    }))).toEqual([
      {
        indexDefinitionId: 3,
        access: { kind: "developer", tableId: 1, logicalIndexId: 1 },
      },
      {
        indexDefinitionId: 4,
        access: { kind: "developer", tableId: 2, logicalIndexId: 2 },
      },
    ]);
    expect(created.schemaVersionIndexBindings.map((binding) => ({
      logicalIndexId: binding.logicalIndexId,
      indexDefinitionId: binding.indexDefinitionId,
      requiredForActivation: binding.requiredForActivation,
    }))).toEqual([
      { logicalIndexId: 1, indexDefinitionId: 3, requiredForActivation: true },
      { logicalIndexId: 2, indexDefinitionId: 4, requiredForActivation: true },
    ]);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 2,
      indexes: 2,
      schemaVersions: 1,
      definitions: 4,
      schemaBindings: 2,
      buildStates: 0,
    });
    await expect(
      physicalProjection(persistence, deploymentId),
    ).resolves.toEqual({
      definitions: [
        {
          index_definition_id: 1,
          access_kind: "by_creation_time",
          table_id: 1,
          logical_index_id: null,
        },
        {
          index_definition_id: 2,
          access_kind: "by_creation_time",
          table_id: 2,
          logical_index_id: null,
        },
        {
          index_definition_id: 3,
          access_kind: "developer",
          table_id: 1,
          logical_index_id: 1,
        },
        {
          index_definition_id: 4,
          access_kind: "developer",
          table_id: 2,
          logical_index_id: 2,
        },
      ],
      bindings: [
        { logical_index_id: 1, index_definition_id: 3 },
        { logical_index_id: 2, index_definition_id: 4 },
      ],
    });

    const sameTokenReplay = await publishPrepared(persistence, prepared);
    const freshTokenReplay = await publishPrepared(
      persistence,
      await prepareAppSchemaPublicationV1(persistence.drizzle, input),
    );
    expect(sameTokenReplay.creationTimeIndexDefinitions.map(
      (definition) => definition.indexDefinitionId,
    )).toEqual([1, 2]);
    expect(freshTokenReplay.developerIndexDefinitions.map(
      (definition) => definition.indexDefinitionId,
    )).toEqual([3, 4]);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 2,
      indexes: 2,
      schemaVersions: 1,
      definitions: 4,
      schemaBindings: 2,
      buildStates: 0,
    });
  });

  it("publishes intrinsic definitions without fabricating schema bindings", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_intrinsic_only";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_publication_v1_intrinsic_only",
        ),
        version: CatalogSchemaVersionSchema.make(1),
        tables: [
          appTable("users", { email: appField({ type: "string" }) }),
        ],
        indexes: [],
      },
    );

    const projection = await publishPrepared(persistence, prepared);
    expect(projection.creationTimeIndexDefinitions).toHaveLength(1);
    expect(projection.developerIndexDefinitions).toEqual([]);
    expect(projection.schemaVersionIndexBindings).toEqual([]);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 1,
      indexes: 0,
      schemaVersions: 1,
      definitions: 1,
      schemaBindings: 0,
      buildStates: 0,
    });
  });

  it("rolls every projected row back and reuses rolled-back definition IDs", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_rollback";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_publication_v1_rollback"),
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await publishPreparedAppSchemaV1InTransaction(tx, prepared);
        throw new Error("injected D2c rollback");
      }),
    ).rejects.toThrow("injected D2c rollback");
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
    expect(committed.developerIndexDefinitions[0]?.indexDefinitionId).toBe(3);
  });

  it("rolls stable bindings back when a later artifact conflict fails", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_late_conflict";
    await insertDeployment(persistence, deploymentId);
    const target = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_publication_v1_late_conflict"),
    );
    const conflicting = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      userPublicationInput(
        deploymentId,
        "schema_publication_v1_late_conflict",
        1,
        [{ descriptor: "byEmail", field: "email" }],
      ),
    );
    const conflictingState =
      getPreparedAppSchemaPublicationV1State(conflicting);
    await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, conflictingState.artifact)
    );

    await expect(publishPrepared(persistence, target)).rejects.toBeInstanceOf(
      SchemaVersionArtifactConflictError,
    );
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 0,
      indexes: 0,
      schemaVersions: 1,
      definitions: 0,
      schemaBindings: 0,
      buildStates: 0,
    });
  });

  it("rejects an unexpected schema-version binding as a typed projection mismatch", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_extra_binding";
    await insertDeployment(persistence, deploymentId);
    const baselinePublication = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      userPublicationInput(
        deploymentId,
        "schema_publication_v1_extra_binding_baseline",
        1,
        [
          { descriptor: "byEmail", field: "email" },
          { descriptor: "byPhone", field: "phone" },
        ],
      ),
    );
    const baselineProjection = await publishPrepared(
      persistence,
      baselinePublication,
    );
    const targetPublication = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      userPublicationInput(
        deploymentId,
        "schema_publication_v1_extra_binding_target",
        2,
        [{ descriptor: "byEmail", field: "email" }],
      ),
    );
    const targetState = getPreparedAppSchemaPublicationV1State(
      targetPublication,
    );
    await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, targetState.artifact)
    );
    const extraLogicalIndex =
      baselineProjection.manifest.indexBindings.indexes.find(
        (index) => index.descriptor === "byPhone",
      );
    if (extraLogicalIndex === undefined) {
      throw new Error("Expected the baseline byPhone logical index.");
    }
    const extraBinding = await prepareAppDeveloperIndexDefinitionBindingV1({
      deploymentId,
      schemaVersionId: targetPublication.schemaVersionId,
      tableId: extraLogicalIndex.tableId,
      logicalIndexId: extraLogicalIndex.logicalIndexId,
      logicalSpec: extraLogicalIndex.spec,
    });
    await persistence.drizzle.transaction((tx) =>
      runEffect(
        ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
          tx,
          extraBinding,
        ),
      )
    );

    await expect(
      publishPrepared(persistence, targetPublication),
    ).rejects.toMatchObject({
      name: "AppSchemaPublicationV1ProjectionError",
      issue: {
        reason: "schemaBindingCountMismatch",
        expectedCount: 1,
        actualCount: 2,
      },
    });
    await expect(
      publishPrepared(persistence, targetPublication),
    ).rejects.toBeInstanceOf(AppSchemaPublicationV1ProjectionError);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 1,
      indexes: 2,
      schemaVersions: 2,
      definitions: 3,
      schemaBindings: 3,
      buildStates: 0,
    });
  });

  it("rejects artifact JSON drift even when canonical bytes remain unchanged", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_artifact_json_drift";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_publication_v1_artifact_json_drift"),
    );
    await publishPrepared(persistence, prepared);
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_json = '{"tampered": true}'::jsonb
        where deployment_id = $1 and schema_version_id = $2
      `,
      [deploymentId, prepared.schemaVersionId],
    );

    await expect(publishPrepared(persistence, prepared)).rejects.toBeInstanceOf(
      SchemaVersionArtifactCorruptionError,
    );
  });

  it("authenticates the full publication token before writing", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_transaction_forgery";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(
        deploymentId,
        "schema_publication_v1_transaction_forgery",
      ),
    );
    const forgery = { ...prepared };

    await expect(
      persistence.drizzle.transaction((tx) =>
        Reflect.apply(
          publishPreparedAppSchemaV1InTransaction,
          undefined,
          [tx, forgery],
        )
      ),
    ).rejects.toBeInstanceOf(
      InvalidPreparedAppSchemaPublicationV1Error,
    );
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 0,
      indexes: 0,
      schemaVersions: 0,
      definitions: 0,
      schemaBindings: 0,
      buildStates: 0,
    });
  });

  it("performs no Web Crypto during the transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_schema_publication_v1_no_locked_crypto";
    await insertDeployment(persistence, deploymentId);
    const prepared = await prepareAppSchemaPublicationV1(
      persistence.drizzle,
      publicationInput(deploymentId, "schema_publication_v1_no_locked_crypto"),
    );
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      new Error("Web Crypto must stay outside the D2c transaction"),
    );
    try {
      await expect(publishPrepared(persistence, prepared)).resolves.toMatchObject({
        artifact: { schemaVersionId: prepared.schemaVersionId },
      });
      await expect(publishPrepared(persistence, prepared)).resolves.toMatchObject({
        artifact: { schemaVersionId: prepared.schemaVersionId },
      });
    } finally {
      digest.mockRestore();
    }
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

function publicationInput(
  deploymentId: string,
  schemaVersionId: string,
  version = 1,
) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(version),
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

function userPublicationInput(
  deploymentId: string,
  schemaVersionId: string,
  version: number,
  indexes: ReadonlyArray<{
    readonly descriptor: string;
    readonly field: "email" | "phone";
  }>,
) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(version),
    tables: [
      appTable("users", {
        email: appField({ type: "string" }),
        phone: appField({ type: "string" }),
      }),
    ],
    indexes: indexes.map((index) =>
      appIndex("users", index.descriptor, [index.field])
    ),
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

async function publishPrepared(
  persistence: PGlitePersistence,
  prepared: PreparedAppSchemaPublicationV1,
) {
  return persistence.drizzle.transaction((tx) =>
    publishPreparedAppSchemaV1InTransaction(tx, prepared)
  );
}

async function physicalProjection(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{
  readonly definitions: ReadonlyArray<{
    readonly index_definition_id: number;
    readonly access_kind: string;
    readonly table_id: number;
    readonly logical_index_id: number | null;
  }>;
  readonly bindings: ReadonlyArray<{
    readonly logical_index_id: number;
    readonly index_definition_id: number;
  }>;
}> {
  const definitions = await persistence.query<{
    index_definition_id: number;
    access_kind: string;
    table_id: number;
    logical_index_id: number | null;
  }>(
    `
      select index_definition_id, access_kind, table_id, logical_index_id
      from fx_control_index_definition
      where deployment_id = $1
      order by index_definition_id
    `,
    [deploymentId],
  );
  const bindings = await persistence.query<{
    logical_index_id: number;
    index_definition_id: number;
  }>(
    `
      select logical_index_id, index_definition_id
      from fx_control_schema_version_index_binding
      where deployment_id = $1
      order by logical_index_id
    `,
    [deploymentId],
  );
  return {
    definitions: definitions.rows,
    bindings: bindings.rows,
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
