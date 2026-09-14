import { Schema } from "effect";

/** Shared checked compiler grammar. Module owners still admit their exact model set. */
const strings = Schema.Array(Schema.String);
const columnFields = {
  name: Schema.String,
  nullable: Schema.Boolean,
  primaryKey: Schema.Boolean,
  generated: Schema.optionalKey(Schema.Boolean),
  options: Schema.optionalKey(
    Schema.Struct({
      prefix: Schema.optionalKey(Schema.String),
      searchable: Schema.optionalKey(Schema.Boolean),
      translatable: Schema.optionalKey(Schema.Boolean),
      choices: Schema.optionalKey(strings),
    }),
  ),
};
const RawDefault = Schema.Struct({
  value: Schema.String,
  precision: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
});
const Column = Schema.Union([
  Schema.Struct({ ...columnFields,
    type: Schema.Literals(["id", "text", "number", "boolean", "dateTime", "enum"]),
    defaultValue: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  }),
  Schema.Struct({ ...columnFields, type: Schema.Literal("json"),
    defaultValue: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null, RawDefault])),
  }),
  Schema.Struct({ ...columnFields, type: Schema.Literal("bigNumber"),
    defaultValue: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
  }),
]);
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
    }).check(Schema.makeFilter(table => table.columns.every(column => {
      if (column.defaultValue === null && !column.nullable) return false;
      if (column.type === "bigNumber") {
        const raw = table.columns.filter(candidate => candidate.name === "raw_" + column.name);
        return column.generated !== true && !column.primaryKey && raw.length === 1 &&
          raw[0]?.type === "json" && !raw[0].primaryKey &&
          (raw[0].generated === true || (raw[0].generated === undefined && raw[0].nullable === column.nullable));
      }
      if (typeof column.defaultValue === "object" && column.defaultValue !== null) {
        return table.columns.some(candidate =>
          candidate.type === "bigNumber" && column.name === "raw_" + candidate.name);
      }
      return true;
    }))),
  ),
});
export const decodeCompiledDml = Schema.decodeUnknownEffect(CompiledSchema, {
  onExcessProperty: "error",
});
