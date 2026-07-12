import { describe, expect, expectTypeOf, it } from "vitest";

import {
  APP_SCHEMA_CATALOG_COMPILER_VERSION_V1,
  APP_SCHEMA_INTRINSIC_ID_TARGETS_V1,
  AppSchemaCatalogCompilationErrorV1,
  compileAppSchemaCatalogRequirementsV1,
  type AppSchemaCreationTimeIndexRequirementV1,
  type AppSchemaDeveloperIndexRequirementV1,
  type CompiledAppSchemaCatalogRequirementsV1,
} from "../src/app-schema-catalog";
import type { CatalogIndexId, CatalogTableId } from "../src/catalog";
import type { ValidatorJsonV1 } from "../src/validator-json";

type ForbiddenCompiledAuthority = Extract<
  keyof CompiledAppSchemaCatalogRequirementsV1,
  | "manifest"
  | "indexDefinitionId"
  | "lifecycle"
  | "readiness"
  | "scopeId"
>;

describe("app-schema catalog requirement compilation", () => {
  it("derives canonical intrinsic and developer requirements without by_id", async () => {
    const compiled = await compileAppSchemaCatalogRequirementsV1(
      representativeManifest(),
    );

    expect(compiled.kind).toBe("appSchemaCatalogRequirements");
    expect(compiled.compilerVersion).toBe(
      APP_SCHEMA_CATALOG_COMPILER_VERSION_V1,
    );
    expect(compiled.creationTimeIndexes.map((index) => index.tableId))
      .toEqual([2, 9]);
    expect(compiled.developerIndexes.map((index) => ({
      tableId: index.tableId,
      logicalIndexId: index.logicalIndexId,
      descriptor: index.descriptor,
    }))).toEqual([
      { tableId: 9, logicalIndexId: 1, descriptor: "byTitle" },
      { tableId: 2, logicalIndexId: 4, descriptor: "byEmail" },
    ]);

    for (const requirement of compiled.creationTimeIndexes) {
      expect(requirement).toMatchObject({
        kind: "by_creation_time",
        requiredForActivation: true,
        canonical: {
          codecVersion: 1,
          physicalSpec: {
            accessPath: "by_creation_time",
            orderedFields: [{ kind: "systemCreationTime" }],
            tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
          },
        },
      });
      expect(requirement.canonical.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(compiled.developerIndexes[0]?.canonical.physicalSpec)
      .toMatchObject({
        accessPath: "developer",
        orderedFields: [
          { kind: "documentPath", path: "title" },
          { kind: "systemCreationTime" },
        ],
        tieBreaker: { kind: "separateRowIdentity", byteLength: 16 },
      });
    expect(compiled.developerIndexes[1]?.canonical.physicalSpec)
      .toMatchObject({
        accessPath: "developer",
        orderedFields: [
          { kind: "documentPath", path: "profile.email" },
          { kind: "systemCreationTime" },
        ],
      });
    expect(JSON.stringify(compiled)).not.toContain("by_id");

    expectTypeOf<ForbiddenCompiledAuthority>().toEqualTypeOf<never>();
    expectTypeOf<AppSchemaCreationTimeIndexRequirementV1["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
    expectTypeOf<AppSchemaDeveloperIndexRequirementV1["logicalIndexId"]>()
      .toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<
      AppSchemaCreationTimeIndexRequirementV1[
        "canonical"
      ]["physicalSpec"]["accessPath"]
    >().toEqualTypeOf<"by_creation_time">();
    expectTypeOf<
      AppSchemaDeveloperIndexRequirementV1[
        "canonical"
      ]["physicalSpec"]["accessPath"]
    >().toEqualTypeOf<"developer">();
    expectTypeOf<
      AppSchemaDeveloperIndexRequirementV1["requiredForActivation"]
    >().toEqualTypeOf<true>();
  });

  it("ports Convex field-can-sometimes-exist semantics", async () => {
    const documentType: ValidatorJsonV1 = {
      type: "object",
      value: {
        scalar: field({ type: "string" }),
        nested: field({
          type: "object",
          value: { email: field({ type: "string" }) },
        }),
        loose: field({ type: "any" }),
        choice: field({
          type: "union",
          value: [
            { type: "string" },
            {
              type: "object",
              value: { code: field({ type: "number" }) },
            },
          ],
        }),
        tags: field({ type: "array", value: { type: "string" } }),
        lookup: field({
          type: "record",
          keys: { type: "string" },
          values: { type: "string" },
        }),
      },
    };

    for (const validPath of [
      "scalar",
      "nested.email",
      "loose.any.depth",
      "choice.code",
      "tags",
      "lookup",
    ]) {
      await expect(
        compileAppSchemaCatalogRequirementsV1(
          oneIndexManifest(documentType, validPath),
        ),
      ).resolves.toMatchObject({ developerIndexes: [{ descriptor: "byField" }] });
    }

    for (const invalidPath of [
      "missing",
      "scalar.child",
      "nested.missing",
      "choice.missing",
      "tags.child",
      "lookup.child",
      "constructor",
      "toString",
      "constructor.child",
    ]) {
      await expect(
        compileAppSchemaCatalogRequirementsV1(
          oneIndexManifest(documentType, invalidPath),
        ),
      ).rejects.toMatchObject({
        name: "AppSchemaCatalogCompilationErrorV1",
        issue: { reason: "impossibleIndexField", fieldPath: invalidPath },
      });
    }

    await expect(
      compileAppSchemaCatalogRequirementsV1(
        oneIndexManifest(
          {
            type: "object",
            value: { constructor: field({ type: "string" }) },
          },
          "constructor",
        ),
      ),
    ).resolves.toMatchObject({
      developerIndexes: [{ descriptor: "byField" }],
    });
  });

  it("checks every nested ID target and permits only declared app tables or _storage", async () => {
    const refs = appTable(1, "refs", {
      type: "object",
      value: {
        direct: field({ type: "id", tableName: "users" }),
        list: field({
          type: "array",
          value: { type: "id", tableName: "users" },
        }),
        dictionary: field({
          type: "record",
          keys: { type: "string" },
          values: { type: "id", tableName: "users" },
        }),
        choice: field({
          type: "union",
          value: [
            { type: "null" },
            { type: "id", tableName: "users" },
          ],
        }),
        nested: field({
          type: "object",
          value: {
            owner: field({ type: "id", tableName: "users" }),
          },
        }),
        storage: field({ type: "id", tableName: "_storage" }),
      },
    });
    await expect(
      compileAppSchemaCatalogRequirementsV1(
        appManifest([refs, appTable(2, "users", emptyDocument())], []),
      ),
    ).resolves.toMatchObject({ creationTimeIndexes: [{ tableId: 1 }, { tableId: 2 }] });
    expect(APP_SCHEMA_INTRINSIC_ID_TARGETS_V1).toEqual(["_storage"]);

    for (const targetTableName of ["missing", "_unknown"]) {
      await expect(
        compileAppSchemaCatalogRequirementsV1(
          appManifest([
            appTable(1, "refs", {
              type: "object",
              value: {
                nested: field({
                  type: "union",
                  value: [{ type: "id", tableName: targetTableName }],
                }),
              },
            }),
          ], []),
        ),
      ).rejects.toMatchObject({
        name: "AppSchemaCatalogCompilationErrorV1",
        issue: {
          reason: "unknownIdTarget",
          sourceTableId: 1,
          targetTableName,
          validatorPath:
            "documentType.value.nested.fieldType.value[0].tableName",
        },
      });
    }
  });

  it("strictly rejects caller-authored physical or lifecycle authority", async () => {
    const manifest = representativeManifest();
    Object.assign(manifest.indexBindings.indexes[0] ?? {}, {
      indexDefinitionId: 99,
      physicalSpec: { caller: "chosen" },
      requiredForActivation: false,
    });
    Object.assign(manifest, { lifecycle: "enabled" });

    await expect(
      compileAppSchemaCatalogRequirementsV1(manifest),
    ).rejects.toBeInstanceOf(AppSchemaCatalogCompilationErrorV1);
    await expect(
      compileAppSchemaCatalogRequirementsV1(manifest),
    ).rejects.toMatchObject({ issue: { reason: "invalidManifest" } });
  });

  it("snapshots before hashing and returns deeply frozen derived evidence", async () => {
    const manifest = representativeManifest();
    const compilation = compileAppSchemaCatalogRequirementsV1(manifest);
    const firstIndex = manifest.indexBindings.indexes[0];
    if (firstIndex === undefined) throw new Error("Expected an index fixture.");
    const firstTable = manifest.tableDefinitions.tables[0];
    if (firstTable === undefined) throw new Error("Expected a table fixture.");
    firstIndex.spec.fields[0] = "changedAfterCall";
    firstTable.logicalName = "changedAfterCall";

    const compiled = await compilation;
    expect(compiled.developerIndexes[0]?.canonical.physicalSpec.orderedFields)
      .toEqual([
        { kind: "documentPath", path: "title" },
        { kind: "systemCreationTime" },
      ]);
    expect(Object.isFrozen(manifest)).toBe(false);
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.creationTimeIndexes)).toBe(true);
    expect(Object.isFrozen(compiled.developerIndexes)).toBe(true);
    expect(Object.isFrozen(compiled.creationTimeIndexes[0])).toBe(true);
    expect(Object.isFrozen(compiled.developerIndexes[0])).toBe(true);
    expect(Object.isFrozen(compiled.developerIndexes[0]?.canonical)).toBe(true);
    expect(
      Object.isFrozen(
        compiled.developerIndexes[0]?.canonical.physicalSpec.orderedFields,
      ),
    ).toBe(true);
  });

  it("is deterministic and supports an empty app schema", async () => {
    const left = await compileAppSchemaCatalogRequirementsV1(
      representativeManifest(),
    );
    const right = await compileAppSchemaCatalogRequirementsV1(
      structuredClone(representativeManifest()),
    );
    expect(left).toEqual(right);

    await expect(
      compileAppSchemaCatalogRequirementsV1(appManifest([], [])),
    ).resolves.toEqual({
      kind: "appSchemaCatalogRequirements",
      compilerVersion: 1,
      creationTimeIndexes: [],
      developerIndexes: [],
    });
  });
});

function representativeManifest() {
  return appManifest(
    [
      appTable(2, "users", {
        type: "object",
        value: {
          profile: field({
            type: "object",
            value: { email: field({ type: "string" }) },
          }),
        },
      }),
      appTable(9, "posts", {
        type: "object",
        value: {
          title: field({ type: "string" }),
          authorId: field({ type: "id", tableName: "users" }),
          storageId: field({ type: "id", tableName: "_storage" }),
        },
      }),
    ],
    [
      appIndex(1, 9, "byTitle", ["title"]),
      appIndex(4, 2, "byEmail", ["profile.email"]),
    ],
  );
}

function oneIndexManifest(
  documentType: ValidatorJsonV1,
  fieldPath: string,
) {
  return appManifest(
    [appTable(1, "records", documentType)],
    [appIndex(1, 1, "byField", [fieldPath])],
  );
}

function appManifest(
  tables: ReturnType<typeof appTable>[],
  indexes: ReturnType<typeof appIndex>[],
) {
  return {
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables,
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes,
    },
  };
}

function appTable(
  tableId: number,
  logicalName: string,
  documentType: ValidatorJsonV1,
) {
  return {
    tableId,
    namespace: "app",
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType,
    },
  };
}

function appIndex(
  logicalIndexId: number,
  tableId: number,
  descriptor: string,
  fields: string[],
) {
  return {
    logicalIndexId,
    tableId,
    namespace: "app",
    descriptor,
    spec: {
      kind: "developerOrdered",
      specVersion: 1,
      fields,
    },
  };
}

function field(fieldType: ValidatorJsonV1) {
  return { fieldType, optional: false };
}

function emptyDocument(): ValidatorJsonV1 {
  return { type: "object", value: {} };
}
