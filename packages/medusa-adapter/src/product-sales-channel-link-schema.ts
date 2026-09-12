import { Data, Effect, Schema } from "effect";
import { ProductSalesChannel, generateEntityDefinition } from "@medusajs/link-modules";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-profile";
import type { SchemaTable } from "./schema/model";

export class LinkSchemaError extends Data.TaggedError("LinkSchemaError")<{ readonly cause: unknown }> {}
const Text = Schema.Struct({ type: Schema.Literal("string"), nullable: Schema.Literal(false) });
const Key = Schema.Struct({ ...Text.fields, primary: Schema.Literal(true) });
const Timestamp = Schema.Struct({ columnType: Schema.Literal("timestamptz"), type: Schema.Literal("date"),
  nullable: Schema.Literal(false), defaultRaw: Schema.Literal("CURRENT_TIMESTAMP") });
const decode = Schema.decodeUnknownEffect(Schema.Struct({
  tableName: Schema.Literal("product_sales_channel"),
  properties: Schema.Struct({
    id: Text, product_id: Key, sales_channel_id: Key, created_at: Timestamp, updated_at: Timestamp,
    deleted_at: Schema.Struct({ columnType: Schema.Literal("timestamptz"), type: Schema.Literal("date"), nullable: Schema.Literal(true) }),
  }),
  indexes: Schema.Array(Schema.Struct({
    properties: Schema.Union([Schema.String, Schema.Array(Schema.String)]), name: Schema.String,
    expression: Schema.optionalKey(Schema.String),
  })).check(Schema.isLengthBetween(4, 4)),
}), { onExcessProperty: "error" });

/** The native generator, not DML or an adapter-authored entity, owns Link shape. */
export const captureProductSalesChannelLinkMetadata = Effect.fn("Link.captureMetadata")(function* () {
  const source = yield* Effect.try({
    try: () => {
      const joiner = structuredClone(ProductSalesChannel);
      const [primary, foreign] = joiner.relationships ?? [];
      if (primary?.serviceName !== "product" || primary.foreignKey !== "product_id"
        || foreign?.serviceName !== "sales_channel" || foreign.foreignKey !== "sales_channel_id"
        || joiner.relationships?.length !== 2 || primary.deleteCascade || foreign.deleteCascade
        || !primary.hasMany || !foreign.hasMany || joiner.databaseConfig?.extraFields !== undefined
        || joiner.databaseConfig?.idPrefix !== "prodsc") {
        throw new Error("Unsupported stored Link definition");
      }
      return generateEntityDefinition(joiner, primary, foreign);
    }, catch: cause => new LinkSchemaError({ cause }),
  });
  const generated = yield* decode(source).pipe(Effect.mapError(cause => new LinkSchemaError({ cause })));
  const indexes: SchemaTable["indexes"][number][] = [];
  for (const index of generated.indexes) {
    const columns = typeof index.properties === "string" ? [index.properties] : index.properties;
    const expression = 'CREATE INDEX IF NOT EXISTS "' + index.name + '" ON "' + generated.tableName
      + '" ("' + columns.join(",") + '") WHERE deleted_at IS NULL';
    if (columns.length !== 1 || !["id", "product_id", "sales_channel_id", "deleted_at"].includes(columns[0] ?? "")
      || (index.expression !== undefined && index.expression !== expression)
      || (["product_id", "sales_channel_id"].includes(columns[0] ?? "") !== (index.expression !== undefined))) {
      return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Link index" }));
    }
    indexes.push({ name: index.name, columns, unique: false, ...(index.expression === undefined ? {} : { where: "deleted_at IS NULL" }) });
  }
  if (new Set(indexes.map(index => index.columns[0])).size !== 4) {
    return yield* Effect.fail(new LinkSchemaError({ cause: "Incomplete native Link indexes" }));
  }
  const table: SchemaTable = {
    name: generated.tableName,
    columns: Object.entries(generated.properties).map(([name, column]) => ({
      name, type: column.type === "string" ? "text" : "dateTime", nullable: column.nullable,
      primaryKey: "primary" in column && column.primary,
    })),
    indexes, foreignKeys: [],
  };
  return yield* capturePrivateCanonicalValue(table, 1_048_576, {
    invalidInput: () => new LinkSchemaError({ cause: "Invalid Link metadata" }), hashFailure: cause => new LinkSchemaError({ cause }),
  });
});
