import { describe, expect, expectTypeOf, it } from "vitest";
import { Result, Schema } from "effect";

import type { CatalogTableId } from "../src/catalog";
import {
  canonicalizeSchemaManifestV1,
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestTableDefinitionsV1,
  decodeSchemaManifestTableDefinitionsV1Result,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
  type SchemaManifestAppTableDefinitionV1,
  type SchemaManifestAppTableName,
  type SchemaManifestTableDefinitionsV1,
} from "../src/schema-manifest";
import type { ObjectValidatorJsonV1 } from "../src/validator-json";

describe("FlarexDB semantic table-definition manifest section", () => {
  it("keeps stable table IDs and logical names nominal", () => {
    type BoundDeclaration = SchemaManifestAppTableDeclarationV1 & {
      readonly tableId: CatalogTableId;
      readonly namespace: "app";
    };
    type BoundDeclarationAccepted = BoundDeclaration extends
      SchemaManifestAppTableDeclarationInputV1
      ? true
      : false;

    expectTypeOf<SchemaManifestAppTableDefinitionV1["tableId"]>()
      .toEqualTypeOf<CatalogTableId>();
    expectTypeOf<
      SchemaManifestAppTableDefinitionV1["definition"]["documentType"]
    >().toEqualTypeOf<ObjectValidatorJsonV1>();
    expectTypeOf<number>().not.toMatchTypeOf<CatalogTableId>();
    expectTypeOf<SchemaManifestAppTableName>().toMatchTypeOf<string>();
    expectTypeOf<string>()
      .not.toMatchTypeOf<SchemaManifestAppTableName>();
    expectTypeOf<BoundDeclarationAccepted>().toEqualTypeOf<false>();
  });

  it("decodes strict unbound app declarations before catalog planning", () => {
    const declarations = decodeSchemaManifestAppTableDeclarationsV1([
      appDeclaration("users"),
      appDeclaration("products"),
    ]);

    expectTypeOf(declarations)
      .toEqualTypeOf<ReadonlyArray<SchemaManifestAppTableDeclarationV1>>();
    expect(declarations).toEqual([
      appDeclaration("users"),
      appDeclaration("products"),
    ]);

    for (const declaration of [
      { ...appDeclaration("users"), tableId: 1 },
      { ...appDeclaration("users"), namespace: "app" },
      { ...appDeclaration("users"), placement: { kind: "global" } },
    ]) {
      expect(() =>
        decodeSchemaManifestAppTableDeclarationsV1([declaration]),
      ).toThrow();
    }
    expect(() =>
      decodeSchemaManifestAppTableDeclarationsV1([
        appDeclaration("users"),
        appDeclaration("users"),
      ]),
    ).toThrow(/unique app table logical-name declarations/);
  });

  it("keeps table composite decoders Result-first without absorbing defects", () => {
    const declarations = decodeSchemaManifestAppTableDeclarationsV1Result([
      appDeclaration("users"),
    ]);
    expect(Result.isSuccess(declarations)).toBe(true);

    const section = decodeSchemaManifestTableDefinitionsV1Result({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [appTable(1, "users")],
    });
    expect(Result.isSuccess(section)).toBe(true);

    const malformedDeclarations =
      decodeSchemaManifestAppTableDeclarationsV1Result([null]);
    expect(Result.isFailure(malformedDeclarations)).toBe(true);
    if (Result.isFailure(malformedDeclarations)) {
      expect(Schema.isSchemaError(malformedDeclarations.failure)).toBe(true);
    }
    const malformedSection = decodeSchemaManifestTableDefinitionsV1Result({});
    expect(Result.isFailure(malformedSection)).toBe(true);
    if (Result.isFailure(malformedSection)) {
      expect(Schema.isSchemaError(malformedSection.failure)).toBe(true);
    }

    const defect = new Error("table decoder property defect");
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
    expect(() => decodeSchemaManifestAppTableDeclarationsV1Result(
      throwingDeclarations,
    )).toThrow(defect);
    expect(() => decodeSchemaManifestTableDefinitionsV1Result(throwingSection))
      .toThrow(defect);
  });

  it("caps app tables before recursively decoding their elements", () => {
    const declarations: unknown[] = Array.from(
      { length: MAX_SCHEMA_MANIFEST_APP_TABLES + 1 },
      (_, index) => appDeclaration(`table_${String(index).padStart(5, "0")}`),
    );
    declarations[0] = null;

    expect(() =>
      decodeSchemaManifestAppTableDeclarationsV1(declarations),
    ).toThrow(/10000/);
    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: declarations,
      }),
    ).toThrow(/10000/);
  });

  it("decodes an app-document section with stable ordered table bindings", () => {
    const section = decodeSchemaManifestTableDefinitionsV1({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [
        appTable(1, "users"),
        appTable(7, "products"),
      ],
    });

    expectTypeOf(section).toEqualTypeOf<SchemaManifestTableDefinitionsV1>();
    expect(section).toEqual({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [
        appTable(1, "users"),
        appTable(7, "products"),
      ],
    });
    expect(
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [],
      }).tables,
    ).toEqual([]);
  });

  it("rejects duplicate and out-of-order stable table IDs", () => {
    for (const tables of [
      [appTable(1, "users"), appTable(1, "products")],
      [appTable(2, "products"), appTable(1, "users")],
    ]) {
      expect(() =>
        decodeSchemaManifestTableDefinitionsV1({
          kind: "tableDefinitions",
          sectionVersion: 1,
          tables,
        }),
      ).toThrow(/strictly increasing numeric order/);
    }
  });

  it("rejects duplicate logical identity bindings", () => {
    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [appTable(1, "users"), appTable(2, "users")],
      }),
    ).toThrow(/unique table namespace and logical-name bindings/);
  });

  it("requires the proven app object-validator definition variant", () => {
    const invalidDefinitions: ReadonlyArray<unknown> = [
      undefined,
      null,
      { kind: "appDocument", definitionVersion: 1 },
      {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: { type: "string" },
      },
      {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: null,
      },
      {
        kind: "medusaTable",
        definitionVersion: 1,
        documentType: objectDocumentType(),
      },
    ];

    for (const definition of invalidDefinitions) {
      expect(() =>
        decodeSchemaManifestTableDefinitionsV1({
          kind: "tableDefinitions",
          sectionVersion: 1,
          tables: [
            {
              tableId: 1,
              namespace: "app",
              logicalName: "users",
              definition,
            },
          ],
        }),
      ).toThrow();
    }

    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [
          {
            ...appTable(1, "products"),
            namespace: "medusa",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects legacy, physical, and not-yet-designed fields", () => {
    const extraFields: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      { placement: { kind: "global" } },
      { state: "active" },
      { physicalName: "fx_app_users" },
      { definitionJson: {} },
      { indexes: [] },
    ];

    for (const extra of extraFields) {
      expect(() =>
        decodeSchemaManifestTableDefinitionsV1({
          kind: "tableDefinitions",
          sectionVersion: 1,
          tables: [{ ...appTable(1, "users"), ...extra }],
        }),
      ).toThrow();
    }

    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [
          {
            ...appTable(1, "users"),
            definition: {
              ...appTable(1, "users").definition,
              physicalName: "fx_app_users",
            },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [appTable(1, "users")],
        relations: [],
      }),
    ).toThrow();

    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [
          {
            ...appTable(1, "users"),
            definition: {
              ...appTable(1, "users").definition,
              documentType: {
                type: "object",
                value: {
                  name: {
                    fieldType: { type: "string", legacy: true },
                    optional: false,
                  },
                },
              },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects invalid identity fields and unsafe logical names", () => {
    for (const tableId of [0, -1, 1.5, 2_147_483_648]) {
      expect(() => decodeSectionWithTable({ ...appTable(1, "users"), tableId }))
        .toThrow();
    }
    for (const logicalName of [
      "",
      " \t\n",
      "123users",
      "bad-name",
      "_system",
      "__",
      "a".repeat(65),
      "nul\u0000name",
      "bad\ud800name",
    ]) {
      expect(() =>
        decodeSectionWithTable({ ...appTable(1, "users"), logicalName }),
      ).toThrow();
    }
  });

  it("applies Convex identifier rules recursively to app document validators", () => {
    for (const tableName of ["", "123users", "bad-name", "a".repeat(65)]) {
      expect(() =>
        decodeSectionWithTable(
          appTableWithDocumentType(1, "users", {
            type: "object",
            value: {
              ownerId: {
                fieldType: { type: "id", tableName },
                optional: false,
              },
            },
          }),
        ),
      ).toThrow(/tableName must be a Convex-compatible table identifier/);
    }

    for (const fieldName of ["123field", "bad-field", "__", "a".repeat(65)]) {
      expect(() =>
        decodeSectionWithTable(
          appTableWithDocumentType(1, "users", {
            type: "object",
            value: {
              [fieldName]: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          }),
        ),
      ).toThrow(/must be a Convex-compatible identifier/);
    }

    expect(
      decodeSchemaManifestTableDefinitionsV1({
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [
          appTableWithDocumentType(1, "users", {
            type: "object",
            value: {
              _id: {
                fieldType: { type: "id", tableName: "_storage" },
                optional: true,
              },
            },
          }),
        ],
      }).tables,
    ).toHaveLength(1);
  });

  it("validates semantic ordering before B1 canonical hashing", async () => {
    const decoded = decodeSchemaManifestTableDefinitionsV1({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables: [appTable(2, "users"), appTable(9, "products")],
    });
    const artifact = await canonicalizeSchemaManifestV1(decoded);

    expect(artifact.manifestJson).toEqual(decoded);
    expect(() =>
      decodeSchemaManifestTableDefinitionsV1({
        ...decoded,
        tables: [...decoded.tables].reverse(),
      }),
    ).toThrow(/strictly increasing numeric order/);
  });
});

interface AppTableInput {
  readonly tableId: number;
  readonly namespace: "app";
  readonly logicalName: string;
  readonly definition: {
    readonly kind: "appDocument";
    readonly definitionVersion: 1;
    readonly documentType: AppDocumentTypeInput;
  };
}

interface AppDocumentTypeInput {
  readonly type: "object";
  readonly value: Readonly<Record<string, AppDocumentFieldInput>>;
}

interface AppDocumentFieldInput {
  readonly fieldType:
    | { readonly type: "string" }
    | { readonly type: "id"; readonly tableName: string };
  readonly optional: boolean;
}

function appTable(tableId: number, logicalName: string): AppTableInput {
  return {
    tableId,
    namespace: "app",
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: objectDocumentType(),
    },
  };
}

function appDeclaration(logicalName: string) {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: objectDocumentType(),
    },
  } satisfies SchemaManifestAppTableDeclarationInputV1;
}

function objectDocumentType(): AppDocumentTypeInput {
  return {
    type: "object",
    value: {
      name: {
        fieldType: { type: "string" },
        optional: false,
      },
    },
  };
}

function appTableWithDocumentType(
  tableId: number,
  logicalName: string,
  documentType: AppDocumentTypeInput,
): AppTableInput {
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

function decodeSectionWithTable(table: unknown): void {
  decodeSchemaManifestTableDefinitionsV1({
    kind: "tableDefinitions",
    sectionVersion: 1,
    tables: [table],
  });
}
