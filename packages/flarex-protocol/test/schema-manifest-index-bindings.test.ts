import {
  type CatalogIndexId,
  type CatalogTableId,
} from "../src/catalog";
import {
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppIndexDeclarationsV1,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  decodeSchemaManifestAppSchemaV1,
  decodeSchemaManifestAppSchemaV1Result,
  decodeSchemaManifestIndexBindingsV1,
  decodeSchemaManifestIndexBindingsV1Result,
  MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  type SchemaManifestAppIndexBindingV1,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppIndexFieldPath,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestIndexBindingsV1,
} from "../src/schema-manifest";
import { Result, Schema } from "effect";
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

  it("keeps index composite decoders Result-first without absorbing defects", () => {
    const declarations = decodeSchemaManifestAppIndexDeclarationsV1Result([
      appIndexDeclaration("users", "by_email", ["email"]),
    ]);
    expect(Result.isSuccess(declarations)).toBe(true);

    const section = decodeSchemaManifestIndexBindingsV1Result({
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: [appIndexBinding(2, 1, "by_email", ["email"])],
    });
    expect(Result.isSuccess(section)).toBe(true);

    const malformedDeclarations =
      decodeSchemaManifestAppIndexDeclarationsV1Result([null]);
    expect(Result.isFailure(malformedDeclarations)).toBe(true);
    if (Result.isFailure(malformedDeclarations)) {
      expect(Schema.isSchemaError(malformedDeclarations.failure)).toBe(true);
    }
    const malformedSection = decodeSchemaManifestIndexBindingsV1Result({});
    expect(Result.isFailure(malformedSection)).toBe(true);
    if (Result.isFailure(malformedSection)) {
      expect(Schema.isSchemaError(malformedSection.failure)).toBe(true);
    }

    const defect = new Error("index decoder property defect");
    const throwingDeclarations = new Proxy([null], {
      get(target, property, receiver): unknown {
        if (property === "length") throw defect;
        return Reflect.get(target, property, receiver);
      },
    });
    const throwingSection = new Proxy({}, {
      getOwnPropertyDescriptor(): never {
        throw defect;
      },
    });
    expect(() => decodeSchemaManifestAppIndexDeclarationsV1Result(
      throwingDeclarations,
    )).toThrow(defect);
    expect(() => decodeSchemaManifestIndexBindingsV1Result(throwingSection))
      .toThrow(defect);
  });

  it("preserves preflight first-failure order before later property defects", () => {
    const laterDefect = new Error("later index field property defect");
    const declaration = new Proxy({
      fields: Array.from(
        { length: MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS + 1 },
        (_, index) => `field_${index}`,
      ),
    }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "spec") throw laterDefect;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const declarationResult =
      decodeSchemaManifestAppIndexDeclarationsV1Result([declaration]);
    expect(Result.isFailure(declarationResult)).toBe(true);

    const appSchema = new Proxy({
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: new Array(MAX_SCHEMA_MANIFEST_APP_TABLES + 1),
      },
    }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "indexBindings") throw laterDefect;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const appSchemaResult = decodeSchemaManifestAppSchemaV1Result(appSchema);
    expect(Result.isFailure(appSchemaResult)).toBe(true);
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

  it("keeps app-schema validation Result-first without absorbing defects", () => {
    const valid = decodeSchemaManifestAppSchemaV1Result(
      appSchemaManifest([
        appIndexBinding(2, 1, "by_email", ["email"]),
      ]),
    );
    expect(Result.isSuccess(valid)).toBe(true);
    if (Result.isSuccess(valid)) {
      expect(valid.success).toEqual(
        appSchemaManifest([
          appIndexBinding(2, 1, "by_email", ["email"]),
        ]),
      );
    }

    const malformed = decodeSchemaManifestAppSchemaV1Result({});
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(Schema.isSchemaError(malformed.failure)).toBe(true);
    }

    const defect = new Error("app-schema decoder property defect");
    const throwingManifest = new Proxy({}, {
      getOwnPropertyDescriptor(): never {
        throw defect;
      },
    });
    expect(() => decodeSchemaManifestAppSchemaV1Result(throwingManifest))
      .toThrow(defect);
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
