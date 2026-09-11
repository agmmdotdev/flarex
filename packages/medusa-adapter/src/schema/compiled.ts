import { Schema } from "effect";

/** Shared checked compiler grammar. Module owners still admit their exact model set. */
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
export const decodeCompiledDml = Schema.decodeUnknownEffect(CompiledSchema, {
  onExcessProperty: "error",
});
