import { Effect, Schema } from "effect";
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
const text = (fieldName: string, searchable: boolean) => Schema.Struct({
  ...base, fieldName: Schema.Literal(fieldName), nullable: Schema.Literal(false),
  dataType: Schema.Struct({ name: Schema.Literal("text"), options: Schema.Struct({ searchable: Schema.Literal(searchable) }) }),
  defaultValue: Schema.Undefined,
});
const timestamp = (fieldName: string, nullable: boolean) => Schema.Struct({
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
const decodeMetadata = Schema.decodeUnknownEffect(CurrencyMetadata, { onExcessProperty: "error" });
const modelSource = "packages/modules/currency/src/models/currency.ts#currency";
const implicitSource = "packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts";
const authored = (sourceId: string) => ({ kind: "authored", sourceId });
const implicit = (sourceId: string) => ({ kind: "implicit", sourceId });
const derived = (sourceId: string) => ({ kind: "derived", sourceId });
const column = (columnId: string) => ({ tableId: "currency", columnId });

/** Closed Currency profile. Physical defaults/indexes follow the pinned DML lowering. */
const currencySchemaInput = Effect.fn("MedusaAdapter.currencySchemaInput")(
  function* (model: CurrencyDmlSource) {
    const metadata = yield* Effect.try({
      try: () => {
        const parsed = model.parse();
        return { ...parsed, schema: Object.fromEntries(Object.entries(parsed.schema).map(
          ([name, property]) => [name, property.parse(name)],
        )) };
      },
      catch: (cause) => cause,
    }).pipe(Effect.flatMap(decodeMetadata), Effect.mapError((cause) => new CurrencySchemaError({ cause })));
    const fields = metadata.schema;
    const scalar = (field: typeof fields.symbol) => ({
      columnId: field.fieldName, type: field.dataType.name, nullable: field.nullable,
      default: { kind: "none" }, origin: authored(`${modelSource}.${field.fieldName}`),
    });
    const time = (field: typeof fields.deleted_at) => ({
      columnId: field.fieldName, type: "timestamptz", nullable: field.nullable,
      default: { kind: field.nullable ? "none" : "currentTimestamp" },
      origin: implicit(`${implicitSource}#${field.fieldName}`),
    });
    return {
      owner: "medusa", lineageId: "commerce",
      tables: [{ tableId: metadata.tableName, origin: authored(modelSource),
        columns: [scalar(fields.code), scalar(fields.symbol), scalar(fields.symbol_native), scalar(fields.name),
          { columnId: fields.decimal_digits.fieldName, type: "integer", nullable: fields.decimal_digits.nullable,
            default: { kind: "integerLiteral", value: fields.decimal_digits.defaultValue }, origin: authored(`${modelSource}.decimal_digits`) },
          { columnId: fields.rounding.fieldName, type: "numeric", nullable: fields.rounding.nullable,
            default: { kind: "exactNumericLiteral", value: String(fields.rounding.defaultValue) }, origin: authored(`${modelSource}.rounding`) },
          { columnId: fields.raw_rounding.fieldName, type: "jsonb", nullable: fields.raw_rounding.nullable,
            default: { kind: "exactNumericRawLiteral", ...fields.raw_rounding.defaultValue }, origin: derived("dml.big-number.raw_rounding") },
          time(fields.created_at), time(fields.updated_at), time(fields.deleted_at)],
        keys: [{ keyId: "currency.primary", kind: "primary", columns: [fields.code.fieldName], origin: authored(`${modelSource}.code.primaryKey`) }],
        indexes: [{ indexId: "currency.active", kind: "btree", columns: [fields.deleted_at.fieldName],
          predicate: { kind: "isNull", columnId: fields.deleted_at.fieldName }, origin: implicit("dml.deleted_at.active-index") }],
        constraints: [], relationships: [],
      }],
      capabilities: [
        { capabilityId: "currency.searchable", kind: "searchableText", columns: [column(fields.code.fieldName), column(fields.name.fieldName)], origin: authored(`${modelSource}.searchable`) },
        { capabilityId: "currency.exact-number", kind: "exactNumericCompanion", numericColumn: column(fields.rounding.fieldName), rawColumn: column(fields.raw_rounding.fieldName), origin: derived("dml.big-number.companion") },
        { capabilityId: "currency.timestamps", kind: "managedTimestamps", createdAtColumn: column(fields.created_at.fieldName), updatedAtColumn: column(fields.updated_at.fieldName), updateBehavior: "currentTimestampOnUpdate", origin: implicit("dml.managed-timestamps") },
        { capabilityId: "currency.soft-delete", kind: "softDelete", deletedAtColumn: column(fields.deleted_at.fieldName), activeRowsIndex: { tableId: metadata.tableName, indexId: "currency.active" }, origin: implicit("dml.soft-delete") },
      ],
    };
  },
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
