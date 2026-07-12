import {
  type CatalogIndexId,
  type CatalogTableId,
} from "../src/catalog";
import {
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppIndexDeclarationsV1,
  decodeSchemaManifestAppSchemaV1,
  decodeSchemaManifestIndexBindingsV1,
  MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
  type SchemaManifestAppIndexBindingV1,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppIndexFieldPath,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestIndexBindingsV1,
} from "../src/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("FlarexDB semantic app index bindings", () => {
  it("separates stable logical index identity from tables and caller input", () => {
    type BoundDeclaration = SchemaManifestAppIndexDeclarationV1 & {
      readonly logicalIndexId: CatalogIndexId;
      readonly tableId: CatalogTableId;
      readonly namespace: "app";
    };
    type BoundDeclarationAccepted = BoundDeclaration extends
      SchemaManifestAppIndexDeclarationInputV1
      ? true
      : false;

    expectTypeOf<SchemaManifestAppIndexBindingV1["logicalIndexId"]>()
      .toEqualTypeOf<CatalogIndexId>();
    expectTypeOf<SchemaManifestAppIndexBindingV1["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
    expectTypeOf<CatalogIndexId>().not.toMatchTypeOf<CatalogTableId>();
    expectTypeOf<CatalogTableId>().not.toMatchTypeOf<CatalogIndexId>();
    expectTypeOf<number>().not.toMatchTypeOf<CatalogIndexId>();
    expectTypeOf<SchemaManifestAppIndexDescriptor>().toMatchTypeOf<string>();
    expectTypeOf<string>()
      .not.toMatchTypeOf<SchemaManifestAppIndexDescriptor>();
    expectTypeOf<SchemaManifestAppIndexFieldPath>().toMatchTypeOf<string>();
    expectTypeOf<string>()
      .not.toMatchTypeOf<SchemaManifestAppIndexFieldPath>();
    expectTypeOf<BoundDeclarationAccepted>().toEqualTypeOf<false>();
  });

  it("decodes only unbound developer declarations", () => {
    const declarations = decodeSchemaManifestAppIndexDeclarationsV1([
      appIndexDeclaration("users", "by_email", ["email"]),
      appIndexDeclaration("users", "by_name_city", [
        "profile.name",
        "profile.city",
      ]),
    ]);

    expectTypeOf(declarations)
      .toEqualTypeOf<ReadonlyArray<SchemaManifestAppIndexDeclarationV1>>();
    expect(declarations).toEqual([
      appIndexDeclaration("users", "by_email", ["email"]),
      appIndexDeclaration("users", "by_name_city", [
        "profile.name",
        "profile.city",
      ]),
    ]);

    for (const extra of [
      { logicalIndexId: 1 },
      { indexId: 1 },
      { indexDefinitionId: 1 },
      { tableId: 1 },
      { namespace: "app" },
      { spec: { kind: "developerOrdered", specVersion: 1, fields: ["email"] } },
      { keyCodecVersion: 1 },
      { lifecycle: "enabled" },
    ]) {
      expect(() =>
        decodeSchemaManifestAppIndexDeclarationsV1([
          { ...appIndexDeclaration("users", "by_email", ["email"]), ...extra },
        ]),
      ).toThrow();
    }
  });

  it("ports Convex descriptor, field-path, and reserved-system rules", () => {
    for (const descriptor of [
      "",
      "123index",
      "bad-name",
      "__",
      "_private",
      "by_id",
      "by_creation_time",
      "a".repeat(65),
    ]) {
      expect(() =>
        decodeSchemaManifestAppIndexDeclarationsV1([
          appIndexDeclaration("users", descriptor, ["email"]),
        ]),
      ).toThrow();
    }

    for (const fields of [
      [],
      ["email", "email"],
      ["_id"],
      ["_creationTime"],
      ["profile._secret"],
      [".profile"],
      ["profile."],
      ["profile..name"],
      ["profile.bad-name"],
      ["profile.123name"],
      ["profile." + "a".repeat(65)],
      [Array.from({ length: 129 }, () => "nested").join(".")],
      Array.from(
        { length: MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS + 1 },
        (_, index) => `field_${index}`,
      ),
    ]) {
      expect(() =>
        decodeSchemaManifestAppIndexDeclarationsV1([
          appIndexDeclaration("users", "by_fields", fields),
        ]),
      ).toThrow();
    }

    expect(
      decodeSchemaManifestAppIndexDeclarationsV1([
        appIndexDeclaration("users", "by_profile", [
          "profile.name",
          "profile.address.city",
        ]),
      ]),
    ).toHaveLength(1);
    expect(
      decodeSchemaManifestAppIndexDeclarationsV1([
        appIndexDeclaration(
          "users",
          "by_maximum_fields",
          Array.from(
            { length: MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS },
            (_, index) => `field_${index}`,
          ),
        ),
      ]),
    ).toHaveLength(1);
  });

  it("rejects duplicate logical access paths and redundant ordered specs", () => {
    expect(() =>
      decodeSchemaManifestAppIndexDeclarationsV1([
        appIndexDeclaration("users", "by_email", ["email"]),
        appIndexDeclaration("users", "by_email", ["name"]),
      ]),
    ).toThrow(/unique app index table and descriptor declarations/);

    expect(() =>
      decodeSchemaManifestAppIndexDeclarationsV1([
        appIndexDeclaration("users", "by_email", ["email"]),
        appIndexDeclaration("users", "email_lookup", ["email"]),
      ]),
    ).toThrow(/unique ordered app index field lists per table/);

    expect(
      decodeSchemaManifestAppIndexDeclarationsV1([
        appIndexDeclaration("users", "by_email", ["email"]),
        appIndexDeclaration("organizations", "by_email", ["email"]),
      ]),
    ).toHaveLength(2);
  });

  it("enforces per-table and total declaration bounds before publication", () => {
    const perTable = Array.from(
      { length: MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE + 1 },
      (_, index) =>
        appIndexDeclaration(
          "users",
          `by_field_${index}`,
          [`field_${index}`],
        ),
    );
    expect(() =>
      decodeSchemaManifestAppIndexDeclarationsV1(perTable),
    ).toThrow(/at most 64 developer indexes/);

    const total: unknown[] = Array.from(
      { length: MAX_SCHEMA_MANIFEST_APP_INDEXES + 1 },
      (_, index) =>
        appIndexDeclaration(
          `table_${String(index).padStart(5, "0")}`,
          "by_value",
          ["value"],
        ),
    );
    total[0] = null;
    expect(() =>
      decodeSchemaManifestAppIndexDeclarationsV1(total),
    ).toThrow(/10000/);

    const oversizedFields: unknown[] = Array.from(
      { length: MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS + 1 },
      (_, index) => `field_${index}`,
    );
    oversizedFields[0] = null;
    expect(() =>
      decodeSchemaManifestAppIndexDeclarationsV1([
        {
          tableLogicalName: "users",
          descriptor: "by_oversized",
          fields: oversizedFields,
        },
      ]),
    ).toThrow(/15/);
  });

  it("decodes stable ID-ordered logical bindings without physical state", () => {
    const section = decodeSchemaManifestIndexBindingsV1({
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: [
        appIndexBinding(2, 1, "by_email", ["email"]),
        appIndexBinding(9, 4, "by_city", ["profile.city"]),
      ],
    });

    expectTypeOf(section).toEqualTypeOf<SchemaManifestIndexBindingsV1>();
    expect(section.indexes).toHaveLength(2);

    for (const indexes of [
      [
        appIndexBinding(2, 1, "by_email", ["email"]),
        appIndexBinding(2, 4, "by_city", ["profile.city"]),
      ],
      [
        appIndexBinding(9, 4, "by_city", ["profile.city"]),
        appIndexBinding(2, 1, "by_email", ["email"]),
      ],
    ]) {
      expect(() =>
        decodeSchemaManifestIndexBindingsV1({
          kind: "indexBindings",
          sectionVersion: 1,
          indexes,
        }),
      ).toThrow(/strictly increasing numeric order/);
    }

    for (const logicalIndexId of [0, -1, 1.5, 2_147_483_648]) {
      expect(() =>
        decodeSchemaManifestIndexBindingsV1({
          kind: "indexBindings",
          sectionVersion: 1,
          indexes: [
            appIndexBinding(logicalIndexId, 1, "by_email", ["email"]),
          ],
        }),
      ).toThrow();
    }
    for (const invalidBinding of [
      appIndexBinding(2, 0, "by_email", ["email"]),
      appIndexBinding(2, 1, "by_id", ["email"]),
      { ...appIndexBinding(2, 1, "by_email", ["email"]), namespace: "system" },
    ]) {
      expect(() =>
        decodeSchemaManifestIndexBindingsV1({
          kind: "indexBindings",
          sectionVersion: 1,
          indexes: [invalidBinding],
        }),
      ).toThrow();
    }

    for (const extra of [
      { keyCodecVersion: 1 },
      { lifecycle: "declared" },
      { indexDefinitionId: 1 },
      { buildState: { lifecycle: "enabled" } },
    ]) {
      expect(() =>
        decodeSchemaManifestIndexBindingsV1({
          kind: "indexBindings",
          sectionVersion: 1,
          indexes: [
            { ...appIndexBinding(2, 1, "by_email", ["email"]), ...extra },
          ],
        }),
      ).toThrow();
    }
  });

  it("requires one closed composite envelope with valid table references", () => {
    const manifest = decodeSchemaManifestAppSchemaV1(
      appSchemaManifest([
        appIndexBinding(2, 1, "by_email", ["email"]),
      ]),
    );

    expectTypeOf(manifest).toEqualTypeOf<SchemaManifestAppSchemaV1>();
    expect(manifest).toEqual(
      appSchemaManifest([
        appIndexBinding(2, 1, "by_email", ["email"]),
      ]),
    );

    expect(() =>
      decodeSchemaManifestAppSchemaV1(
        appSchemaManifest([
          appIndexBinding(2, 99, "by_email", ["email"]),
        ]),
      ),
    ).toThrow(/reference an app table in this manifest/);

    expect(() =>
      decodeSchemaManifestAppSchemaV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [appTable(1, "users")],
      }),
    ).toThrow();

    for (const extra of [
      { active: true },
      { lifecycle: "declared" },
      { keyCodecVersion: 1 },
      { indexDefinitions: [] },
    ]) {
      expect(() =>
        decodeSchemaManifestAppSchemaV1({
          ...appSchemaManifest([]),
          ...extra,
        }),
      ).toThrow();
    }
  });

  it("canonicalizes the composite value only after semantic validation", async () => {
    const decoded = decodeSchemaManifestAppSchemaV1(
      appSchemaManifest([
        appIndexBinding(2, 1, "by_email", ["email"]),
        appIndexBinding(9, 1, "by_name", ["profile.name"]),
      ]),
    );
    const reorderedObjectKeys = decodeSchemaManifestAppSchemaV1({
      indexBindings: decoded.indexBindings,
      tableDefinitions: decoded.tableDefinitions,
      manifestVersion: 1,
      kind: "appSchema",
    });
    const [first, second] = await Promise.all([
      canonicalizeSchemaManifestV1(decoded),
      canonicalizeSchemaManifestV1(reorderedObjectKeys),
    ]);

    expect(first.canonicalText).toBe(second.canonicalText);
    expect(Array.from(first.sha256)).toEqual(Array.from(second.sha256));
    expect(first.manifestJson).toEqual(decoded);

    expect(() =>
      decodeSchemaManifestAppSchemaV1({
        ...decoded,
        indexBindings: {
          ...decoded.indexBindings,
          indexes: [...decoded.indexBindings.indexes].reverse(),
        },
      }),
    ).toThrow(/strictly increasing numeric order/);
  });
});

function appIndexDeclaration(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

function appIndexBinding(
  logicalIndexId: number,
  tableId: number,
  descriptor: string,
  fields: ReadonlyArray<string>,
): Readonly<Record<string, unknown>> {
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

function appSchemaManifest(
  indexes: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Readonly<Record<string, unknown>> {
  return {
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [appTable(1, "users"), appTable(4, "organizations")],
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
): Readonly<Record<string, unknown>> {
  return {
    tableId,
    namespace: "app",
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
          profile: {
            fieldType: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                city: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
            optional: false,
          },
        },
      },
    },
  };
}
