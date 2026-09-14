import { Data, Effect, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { generateEntityDefinition } from "@medusajs/link-modules";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-profile";
import type { SchemaTable } from "./schema/model";

export class LinkSchemaError extends Data.TaggedError("LinkSchemaError")<{ readonly cause: unknown }> {}
const Name = Schema.String.check(Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
const Relationship = Schema.Struct({ serviceName: Name, foreignKey: Name, primaryKey: Name, alias: Name,
  hasMany: Schema.optionalKey(Schema.Boolean), deleteCascade: Schema.optionalKey(Schema.Boolean) });
const decodeDefinition = Schema.decodeUnknownEffect(Schema.Struct({
  serviceName: Name, relationships: Schema.Tuple([Relationship, Relationship]),
  databaseConfig: Schema.Struct({ tableName: Name, idPrefix: Name }),
}));
const Text = Schema.Struct({ type: Schema.Literal("string"), nullable: Schema.Literal(false) });
const Key = Schema.Struct({ ...Text.fields, primary: Schema.Literal(true) });
const Timestamp = Schema.Struct({ columnType: Schema.Literal("timestamptz"), type: Schema.Literal("date"),
  nullable: Schema.Literal(false), defaultRaw: Schema.Literal("CURRENT_TIMESTAMP") });
const Deleted = Schema.Struct({ columnType: Schema.Literal("timestamptz"), type: Schema.Literal("date"), nullable: Schema.Literal(true) });

/** Two scalar endpoints only. Native metadata owns indexes; this captures its
 * supported structural subset, not module activation or transaction authority. */
export const captureLinkMetadata = Effect.fn("Link.captureMetadata")(function* (input: ModuleJoinerConfig) {
  const joiner = yield* Effect.try({ try: () => structuredClone(input), catch: cause => new LinkSchemaError({ cause }) });
  const definition = yield* decodeDefinition(joiner).pipe(Effect.mapError(cause => new LinkSchemaError({ cause })));
  const [primary, foreign] = definition.relationships;
  const endpointNames = [primary.foreignKey, foreign.foreignKey];
  if (new Set(endpointNames).size !== 2 || primary.serviceName === foreign.serviceName
    || endpointNames.some(name => ["id", "created_at", "updated_at", "deleted_at"].includes(name))
    || joiner.databaseConfig?.extraFields !== undefined || joiner.isReadOnlyLink) {
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported stored Link definition" }));
  }
  const generatedInput = generateEntityDefinition(joiner, primary, foreign);
  const decodeGenerated = Schema.decodeUnknownEffect(Schema.Struct({
    tableName: Schema.Literal(definition.databaseConfig.tableName),
    properties: Schema.Struct({ id: Text, [primary.foreignKey]: Key, [foreign.foreignKey]: Key,
      created_at: Timestamp, updated_at: Timestamp, deleted_at: Deleted }),
    indexes: Schema.Array(Schema.Struct({
      properties: Schema.Union([Schema.String, Schema.Array(Schema.String)]), name: Name,
      unique: Schema.optionalKey(Schema.Literal(true)), expression: Schema.optionalKey(Schema.String),
    })).check(Schema.isLengthBetween(4, 4)),
  }), { onExcessProperty: "error" });
  const generated = yield* decodeGenerated(generatedInput).pipe(Effect.mapError(cause => new LinkSchemaError({ cause })));
  const indexes: SchemaTable["indexes"][number][] = [];
  const fields = ["id", ...endpointNames, "deleted_at"];
  for (const index of generated.indexes) {
    const columns = typeof index.properties === "string" ? [index.properties] : index.properties;
    const column = columns[0];
    const unique = index.unique === true;
    const expression = 'CREATE ' + (unique ? 'UNIQUE ' : '') + 'INDEX IF NOT EXISTS "' + index.name + '" ON "' + generated.tableName
      + '" ("' + columns.join(",") + '") WHERE deleted_at IS NULL';
    if (columns.length !== 1 || column === undefined || !fields.includes(column)
      || (index.expression !== undefined && index.expression !== expression)
      || (endpointNames.includes(column) !== (index.expression !== undefined))
      || (unique && !endpointNames.includes(column))) {
      return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported native Link index" }));
    }
    indexes.push({ name: index.name, columns, unique, ...(index.expression === undefined ? {} : { where: "deleted_at IS NULL" }) });
  }
  if (new Set(indexes.map(index => index.columns[0])).size !== 4 || new Set(indexes.map(index => index.name)).size !== 4) {
    return yield* Effect.fail(new LinkSchemaError({ cause: "Incomplete native Link indexes" }));
  }
  const table: SchemaTable = {
    name: generated.tableName,
    columns: Object.entries(generated.properties).map(([name, column]) => ({
      name, type: column.type === "string" ? "text" : "dateTime", nullable: column.nullable,
      primaryKey: "primary" in column && column.primary === true,
    })), indexes, foreignKeys: [],
  };
  const captured = yield* capturePrivateCanonicalValue(table, 1_048_576, {
    invalidInput: () => new LinkSchemaError({ cause: "Invalid Link metadata" }), hashFailure: cause => new LinkSchemaError({ cause }),
  });
  return { ...captured, joiner };
});
