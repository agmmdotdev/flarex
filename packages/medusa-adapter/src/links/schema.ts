import { Data, Effect, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { generateEntityDefinition } from "@medusajs/link-modules";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import type { SchemaOrigins } from "../schema/model";

/** One provenance mapping for the pinned generated Link entity shape. */
export const linkSchemaOrigins = {
  table: table => ({ kind: "authored", sourceId: "link." + table.name }),
  column: (table, column) => ({ kind: ["created_at", "updated_at", "deleted_at"].includes(column.name) ? "implicit" : "authored",
    sourceId: "link." + table.name + "." + column.name }),
  primaryKey: table => ({ kind: "authored", sourceId: "link." + table.name + ".endpoints" }),
  searchable: table => ({ kind: "authored", sourceId: "link." + table.name + ".searchable" }),
} satisfies SchemaOrigins;

export class LinkSchemaError extends Data.TaggedError("LinkSchemaError")<{ readonly cause: unknown }> {}
const Name = Schema.String.check(Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/));
// Native simpleHash returns signed hexadecimal text. These quoted generated
// index identities are distinct from authored table/column identifiers.
const GeneratedIndexName = Schema.String.check(Schema.isPattern(/^IDX_[a-zA-Z_][a-zA-Z0-9_]*_-?[0-9a-f]+$/));
const Relationship = Schema.Struct({ serviceName: Name, foreignKey: Name, primaryKey: Name, alias: Name,
  hasMany: Schema.optionalKey(Schema.Boolean), deleteCascade: Schema.optionalKey(Schema.Boolean) });
const decodeDefinition = Schema.decodeUnknownEffect(Schema.Struct({
  serviceName: Name, relationships: Schema.Tuple([Relationship, Relationship]),
  databaseConfig: Schema.Struct({ tableName: Name, idPrefix: Name,
    extraFields: Schema.optionalKey(Schema.Record(Name, Schema.Struct({ type: Schema.Literal("integer"),
      defaultValue: Schema.optionalKey(Schema.String) }))) }),
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
    || joiner.isReadOnlyLink || definition.databaseConfig.extraFields !== undefined && Object.keys(definition.databaseConfig.extraFields).length === 0) {
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported stored Link definition" }));
  }
  const extraColumns: SchemaTable["columns"][number][] = [];
  const integerProperty = (defaultValue: string | undefined) => Schema.Struct({ type: Schema.Literal("integer"), nullable: Schema.Literal(false),
    defaultRaw: defaultValue === undefined ? Schema.Undefined : Schema.Literal(defaultValue) });
  const extraProperties: Record<string, ReturnType<typeof integerProperty>> = {};
  for (const [name, field] of Object.entries(definition.databaseConfig.extraFields ?? {})) {
    if (["id", ...endpointNames, "created_at", "updated_at", "deleted_at"].includes(name))
      return yield* Effect.fail(new LinkSchemaError({ cause: "Link extra field shadows an owned column" }));
    const defaultValue = field.defaultValue === undefined ? undefined : yield* Schema.decodeUnknownEffect(
      Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 })),
    )(field.defaultValue).pipe(Effect.mapError(cause => new LinkSchemaError({ cause })));
    extraColumns.push({ name, type: "number", nullable: false, primaryKey: false,
      ...(defaultValue === undefined ? {} : { defaultValue }) });
    extraProperties[name] = integerProperty(field.defaultValue);
  }
  const generatedInput = generateEntityDefinition(joiner, primary, foreign);
  const decodeGenerated = Schema.decodeUnknownEffect(Schema.Struct({
    tableName: Schema.Literal(definition.databaseConfig.tableName),
    properties: Schema.Struct({ id: Text, [primary.foreignKey]: Key, [foreign.foreignKey]: Key,
      created_at: Timestamp, updated_at: Timestamp, deleted_at: Deleted, ...extraProperties }),
    indexes: Schema.Array(Schema.Struct({
      properties: Schema.Union([Schema.String, Schema.Array(Schema.String)]), name: GeneratedIndexName,
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
    columns: [
      { name: "id", type: "text", nullable: false, primaryKey: false },
      ...endpointNames.map(name => ({ name, type: "text" as const, nullable: false, primaryKey: true })),
      { name: "created_at", type: "dateTime", nullable: false, primaryKey: false },
      { name: "updated_at", type: "dateTime", nullable: false, primaryKey: false },
      { name: "deleted_at", type: "dateTime", nullable: true, primaryKey: false },
      ...extraColumns,
    ], indexes, foreignKeys: [],
  };
  const captured = yield* capturePrivateCanonicalValue(table, 1_048_576, {
    invalidInput: () => new LinkSchemaError({ cause: "Invalid Link metadata" }), hashFailure: cause => new LinkSchemaError({ cause }),
  });
  return { ...captured, joiner };
});
