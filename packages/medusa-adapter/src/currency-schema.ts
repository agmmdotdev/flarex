import { Effect, Result, Schema } from "effect";
import { lowerDmlSchema } from "./schema/lower";
import type { SchemaColumn, SchemaOrigins, SchemaTable } from "./schema/model";
import { normalizeRelationalSchema, captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";

/** Foreign parser surface; every returned member is checked before lowering. */
export interface CurrencyDmlSource {
  parse(): {
    readonly name: string;
    readonly tableName: string;
    readonly schema: Readonly<Record<string, { parse(name: string): unknown }>>;
    readonly indexes: readonly unknown[];
    readonly checks: readonly unknown[];
    readonly cascades: unknown;
  };
}

export class CurrencySchemaError extends Schema.TaggedError<CurrencySchemaError>()(
  "CurrencySchemaError", { cause: Schema.Unknown },
) {}

const empty = Schema.Tuple([]);
const emptyRecord = Schema.Record(Schema.String, Schema.Never);
const base = { computed: Schema.Literal(false), indexes: empty, relationships: empty };
const text = <const Name extends string>(fieldName: Name, searchable: boolean) => Schema.Struct({
  ...base, fieldName: Schema.Literal(fieldName), nullable: Schema.Literal(false),
  dataType: Schema.Struct({ name: Schema.Literal("text"), options: Schema.Struct({ searchable: Schema.Literal(searchable) }) }),
  defaultValue: Schema.Undefined,
});
const timestamp = <const Name extends string>(fieldName: Name, nullable: boolean) => Schema.Struct({
  ...base, fieldName: Schema.Literal(fieldName), nullable: Schema.Literal(nullable),
  dataType: Schema.Struct({ name: Schema.Literal("dateTime") }), defaultValue: Schema.Undefined,
});
const CurrencyMetadata = Schema.Struct({
  name: Schema.Literal("Currency"), tableName: Schema.Literal("currency"),
  indexes: empty, checks: empty, cascades: emptyRecord,
  schema: Schema.Struct({
    code: Schema.Struct({ ...text("code", true).fields, primaryKey: Schema.Literal(true) }),
    symbol: text("symbol", false), symbol_native: text("symbol_native", false), name: text("name", true),
    decimal_digits: Schema.Struct({ ...base, fieldName: Schema.Literal("decimal_digits"), nullable: Schema.Literal(false),
      dataType: Schema.Struct({ name: Schema.Literal("number"), options: emptyRecord }), defaultValue: Schema.Literal(0) }),
    rounding: Schema.Struct({ ...base, fieldName: Schema.Literal("rounding"), nullable: Schema.Literal(false),
      dataType: Schema.Struct({ name: Schema.Literal("bigNumber") }), defaultValue: Schema.Literal(0) }),
    raw_rounding: Schema.Struct({ ...base, fieldName: Schema.Literal("raw_rounding"), nullable: Schema.Literal(false),
      dataType: Schema.Struct({ name: Schema.Literal("json") }), defaultValue: Schema.Struct({ value: Schema.Literal("0"), precision: Schema.Literal(20) }) }),
    created_at: timestamp("created_at", false), updated_at: timestamp("updated_at", false), deleted_at: timestamp("deleted_at", true),
  }),
});
const decodeMetadata = Schema.decodeUnknownResult(CurrencyMetadata, { onExcessProperty: "error" });

/** One checked Medusa metadata boundary for persistence and value profiles. */
export const readCurrencyMetadata = (model: CurrencyDmlSource) => Result.try({
  try: () => {
    const parsed = model.parse();
    return { ...parsed, schema: Object.fromEntries(Object.entries(parsed.schema).map(
      ([name, property]) => [name, property.parse(name)],
    )) };
  },
  catch: cause => cause,
}).pipe(Result.flatMap(decodeMetadata), Result.mapError(cause => new CurrencySchemaError({ cause })));
const modelSource = "packages/modules/currency/src/models/currency.ts#currency";
const implicitSource = "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts";
const currencySchemaOrigins: SchemaOrigins = {
  table: () => ({ kind: "authored", sourceId: modelSource }),
  column: (_table, column) => ["created_at", "updated_at", "deleted_at"].includes(column.name)
    ? { kind: "implicit", sourceId: implicitSource + "#" + column.name }
    : column.name === "raw_rounding"
      ? { kind: "derived", sourceId: "dml.big-number.raw_rounding" }
      : { kind: "authored", sourceId: modelSource + "." + column.name },
  primaryKey: () => ({ kind: "authored", sourceId: modelSource + ".code.primaryKey" }),
  searchable: () => ({ kind: "authored", sourceId: modelSource + ".searchable" }),
};

/** Adapt the closed foreign property representation to the shared checked DML
 * input. Field names, defaults and options come from the decoded model. */
function currencySchemaTable(metadata: typeof CurrencyMetadata.Type): SchemaTable {
  const columns = Object.values(metadata.schema).map((field): SchemaColumn => {
    const base = { name: field.fieldName, nullable: field.nullable, primaryKey: "primaryKey" in field && field.primaryKey };
    if (field.fieldName === "raw_rounding") return { ...base, type: field.dataType.name, defaultValue: field.defaultValue };
    return { ...base, type: field.dataType.name,
      ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
      ...("options" in field.dataType ? { options: field.dataType.options } : {}),
    };
  });
  return { name: metadata.tableName, columns, indexes: [], foreignKeys: [],
    exactNumbers: [{ capabilityId: "currency.exact-number", numericColumn: metadata.schema.rounding.fieldName, rawColumn: metadata.schema.raw_rounding.fieldName }],
  };
}

/** Closed Currency admission precedes the shared persistence lowering. */
const currencySchemaInput = Effect.fn("MedusaAdapter.currencySchemaInput")(
  (model: CurrencyDmlSource) => Effect.fromResult(readCurrencyMetadata(model)).pipe(
    Effect.map(metadata => lowerDmlSchema([currencySchemaTable(metadata)], "commerce.currency", currencySchemaOrigins)),
  ),
);

export const translateCurrencySchema = Effect.fn("MedusaAdapter.translateCurrencySchema")(
  function* (model: CurrencyDmlSource) {
    return yield* Effect.fromResult(normalizeRelationalSchema(yield* currencySchemaInput(model)));
  },
);

export const currencySourceProvenance = {
  kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: ["packages/modules/currency/src/models/currency.ts",
    "packages/core/utils/src/dml/helpers/entity-builder/define-property.ts",
    "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts",
    "packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts"],
} as const;

export const captureCurrencySchema = Effect.fn("MedusaAdapter.captureCurrencySchema")(
  function* (deploymentId: string, model: CurrencyDmlSource) {
    const schema = yield* currencySchemaInput(model);
    return yield* captureRelationalSchemaArtifact({ deploymentId, provenance: currencySourceProvenance, schema });
  },
);
