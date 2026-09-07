import { Effect, Schema } from "effect";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import {
  Product,
  ProductVariant,
  ProductOption,
  ProductOptionValue,
  ProductType,
  ProductTag,
  ProductCollection,
  ProductCategory,
  ProductImage,
  ProductVariantProductImage,
} from "@medusajs/product/models";
export const productModels = Object.freeze([
  Product,
  ProductVariant,
  ProductOption,
  ProductOptionValue,
  ProductType,
  ProductTag,
  ProductCollection,
  ProductCategory,
  ProductImage,
  ProductVariantProductImage,
]);
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import {
  capturePrivateCanonicalValue,
  captureRelationalPhysicalLayout,
  registerCommerceSchemaProfile,
} from "@flarex/persistence-postgres/internal/commerce-profile";

export class ProductSchemaError extends Schema.TaggedError<ProductSchemaError>()(
  "ProductSchemaError",
  { cause: Schema.Unknown },
) {}

const strings = Schema.Array(Schema.String);
const Column = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals([
    "id",
    "text",
    "number",
    "boolean",
    "dateTime",
    "json",
    "enum",
  ]),
  nullable: Schema.Boolean,
  primaryKey: Schema.Boolean,
  defaultValue: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
  ),
  generated: Schema.optionalKey(Schema.Boolean),
  options: Schema.optionalKey(
    Schema.Struct({
      prefix: Schema.optionalKey(Schema.String),
      searchable: Schema.optionalKey(Schema.Boolean),
      translatable: Schema.optionalKey(Schema.Boolean),
      choices: Schema.optionalKey(strings),
    }),
  ),
});
const Index = Schema.Struct({
  name: Schema.String,
  columns: strings,
  unique: Schema.Boolean,
  where: Schema.optionalKey(Schema.Literal("deleted_at IS NULL")),
});
const ForeignKey = Schema.Struct({
  name: Schema.String,
  columns: strings,
  referencedTable: Schema.String,
  referencedColumns: strings,
  onDelete: Schema.optionalKey(Schema.Literal("cascade")),
});
const Relationship = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["belongsTo", "hasMany", "manyToMany"]),
  targetModel: Schema.String,
  targetTable: Schema.String,
  mappedBy: Schema.optionalKey(Schema.String),
  nullable: Schema.Boolean,
  cascadeDelete: Schema.Boolean,
  cascadeDetach: Schema.Boolean,
  foreignKeyName: Schema.optionalKey(Schema.String),
  foreignKeyNames: Schema.optionalKey(strings),
  pivotModel: Schema.optionalKey(Schema.String),
  pivotTable: Schema.optionalKey(Schema.String),
  joinColumns: Schema.optionalKey(strings),
  inverseJoinColumns: Schema.optionalKey(strings),
});
const CompiledSchema = Schema.Struct({
  tables: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      columns: Schema.Array(Column),
      indexes: Schema.Array(Index),
      checks: Schema.Tuple([]),
      foreignKeys: Schema.Array(ForeignKey),
      relationships: Schema.Array(Relationship),
      cascades: Schema.Struct({ delete: strings, detach: strings }),
    }),
  ),
});
const decodeCompiled = Schema.decodeUnknownEffect(CompiledSchema, {
  onExcessProperty: "error",
});
const authored = (sourceId: string) => ({ kind: "authored", sourceId });
const implicit = (sourceId: string) => ({ kind: "implicit", sourceId });
const derived = (sourceId: string) => ({ kind: "derived", sourceId });
const expectedTables = [
  "image",
  "product",
  "product_category",
  "product_category_product",
  "product_collection",
  "product_option",
  "product_option_value",
  "product_tag",
  "product_tags",
  "product_type",
  "product_variant",
  "product_variant_option",
  "product_variant_product_image",
];

/** Capture only the pinned Product grammar; arbitrary modules remain unadmitted. */
export const productSchemaInput = Effect.fn("MedusaProduct.schemaInput")(
  function* (input: unknown) {
    const compiled = yield* decodeCompiled(input).pipe(
      Effect.mapError((cause) => new ProductSchemaError({ cause })),
    );
    return yield* productSchemaFromCompiled(compiled);
  },
);

const productSchemaFromCompiled = Effect.fn("MedusaProduct.normalizeCompiled")(
  function* (compiled: typeof CompiledSchema.Type) {
    if (
      compiled.tables.length !== expectedTables.length ||
      compiled.tables
        .map((table) => table.name)
        .sort()
        .some((name, index) => name !== expectedTables[index])
    ) {
      return yield* Effect.fail(
        new ProductSchemaError({ cause: "Incomplete Product model/pivot set" }),
      );
    }
    const tables = compiled.tables.map((table) => {
      const primary = table.columns.filter((column) => column.primaryKey);
      const origin = primary.length === 0 ? implicit : authored;
      const reference = (columnId: string) => ({
        tableId: table.name,
        columnId,
      });
      const columns = table.columns.map((column) => ({
        columnId: column.name,
        type:
          column.type === "id" || column.type === "enum"
            ? "text"
            : column.type === "number"
              ? "integer"
              : column.type === "dateTime"
                ? "timestamptz"
                : column.type === "json"
                  ? "jsonb"
                  : column.type,
        nullable: column.nullable,
        default:
          column.defaultValue !== undefined
            ? {
                kind:
                  typeof column.defaultValue === "boolean"
                    ? "booleanLiteral"
                    : typeof column.defaultValue === "number"
                      ? "integerLiteral"
                      : "textLiteral",
                value: column.defaultValue,
              }
            : {
                kind: ["created_at", "updated_at"].includes(column.name)
                  ? "currentTimestamp"
                  : "none",
              },
        origin: ["created_at", "updated_at", "deleted_at"].includes(column.name)
          ? implicit("dml." + column.name)
          : column.generated
            ? derived(table.name + "." + column.name)
            : origin(table.name + "." + column.name),
      }));
      const keys = [
        ...(primary.length === 0
          ? []
          : [
              {
                keyId: table.name + ".primary",
                kind: "primary",
                columns: primary.map((column) => column.name),
                origin: authored(table.name + ".primary"),
              },
            ]),
        ...table.indexes
          .filter((index) => index.unique && index.where === undefined)
          .map((index) => ({
            keyId: index.name,
            kind: "unique",
            columns: index.columns,
            origin: origin(index.name),
          })),
      ];
      const indexes = table.indexes
        .filter((index) => !index.unique || index.where !== undefined)
        .map((index) => ({
          indexId: index.name,
          kind: index.unique ? "uniqueBtree" : "btree",
          columns: index.columns,
          predicate:
            index.where === undefined
              ? null
              : { kind: "isNull", columnId: "deleted_at" },
          origin: origin(index.name),
        }));
      if (primary.length !== 0)
        indexes.push({
          indexId: table.name + ".active",
          kind: "btree",
          columns: ["deleted_at"],
          predicate: { kind: "isNull", columnId: "deleted_at" },
          origin: implicit("dml.deleted_at.active-index"),
        });
      const constraints = [
        ...table.foreignKeys.map((fk) => ({
          constraintId: fk.name,
          kind: "foreignKey",
          sourceColumns: fk.columns,
          targetColumns: fk.referencedColumns.map((columnId) => ({
            tableId: fk.referencedTable,
            columnId,
          })),
          onDelete: fk.onDelete ?? "noAction",
          onUpdate: "noAction",
          origin: derived(fk.name),
        })),
        ...table.columns
          .filter((column) => column.type === "enum")
          .map((column) => ({
            constraintId: table.name + "." + column.name + ".choices",
            kind: "textSet",
            columnId: column.name,
            values: column.options?.choices ?? [],
            origin: authored(table.name + "." + column.name + ".choices"),
          })),
      ];
      const relationships = table.foreignKeys.map((fk) => ({
        relationshipId: fk.name,
        kind: "manyToOne",
        foreignKeyConstraintId: fk.name,
        origin: derived(fk.name),
      }));
      const searchable = table.columns.filter(
        (column) =>
          column.type === "text" && column.options?.searchable === true,
      );
      const capabilities =
        primary.length === 0
          ? []
          : [
              {
                capabilityId: table.name + ".timestamps",
                kind: "managedTimestamps",
                createdAtColumn: reference("created_at"),
                updatedAtColumn: reference("updated_at"),
                updateBehavior: "currentTimestampOnUpdate",
                origin: implicit("dml.managed-timestamps"),
              },
              {
                capabilityId: table.name + ".soft-delete",
                kind: "softDelete",
                deletedAtColumn: reference("deleted_at"),
                activeRowsIndex: {
                  tableId: table.name,
                  indexId: table.name + ".active",
                },
                origin: implicit("dml.soft-delete"),
              },
              ...(searchable.length === 0
                ? []
                : [
                    {
                      capabilityId: table.name + ".searchable",
                      kind: "searchableText",
                      columns: searchable.map((column) =>
                        reference(column.name),
                      ),
                      origin: authored(table.name + ".searchable"),
                    },
                  ]),
            ];
      return {
        table: {
          tableId: table.name,
          origin: origin(table.name),
          columns,
          keys,
          indexes,
          constraints,
          relationships,
        },
        capabilities,
      };
    });
    return {
      owner: "medusa",
      lineageId: "commerce",
      tables: tables.map((value) => value.table),
      capabilities: tables.flatMap((value) => value.capabilities),
    };
  },
);

export const productSourceProvenance = Object.freeze({
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze([
    "packages/modules/product/src/models",
    "packages/modules/product/src/static-manifest.ts",
    "packages/database/drizzle/src/schema.ts",
    "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
  ]),
} as const);

export const captureProductSchema = Effect.fn("MedusaProduct.captureSchema")(
  function* (deploymentId: string) {
    // The pinned compiler is a foreign synchronous parser. Its optional undefined
    // members are omitted by its JSON representation before the closed decoder.
    const input = yield* Effect.try({
      try: (): unknown =>
        JSON.parse(JSON.stringify(compileDmlSchema([...productModels]))),
      catch: (cause) => new ProductSchemaError({ cause }),
    });
    const metadata = yield* decodeCompiled(input).pipe(
      Effect.mapError((cause) => new ProductSchemaError({ cause })),
    );
    const source = yield* productSchemaFromCompiled(metadata);
    const captured = yield* captureRelationalSchemaArtifact({
      deploymentId,
      provenance: productSourceProvenance,
      schema: source,
    });
    freezeOwnedProductMetadata(metadata);
    const retained = yield* capturePrivateCanonicalValue(metadata, 1_048_576, {
      invalidInput: () =>
        new ProductSchemaError({ cause: "Invalid Product metadata" }),
      hashFailure: (cause) => new ProductSchemaError({ cause }),
    });
    return { ...captured, metadata: retained };
  },
);

/** The closed decoder above owns this plain-data tree; no caller model is frozen. */
function freezeOwnedProductMetadata(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeOwnedProductMetadata(child);
  Object.freeze(value);
}

export const prepareProductSchemaProfile = Effect.fn(
  "MedusaProduct.prepareSchemaProfile",
)(function* (
  deploymentId: string,
  target: Omit<
    Parameters<typeof captureRelationalPhysicalLayout>[0],
    "artifact"
  >,
) {
  const captured = yield* captureProductSchema(deploymentId);
  const layout = yield* captureRelationalPhysicalLayout({
    ...target,
    artifact: captured.artifact,
  });
  const profile = yield* registerCommerceSchemaProfile(
    captured.artifact,
    layout,
  );
  return { ...captured, layout, profile };
});
