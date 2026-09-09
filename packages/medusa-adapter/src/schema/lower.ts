import type { ColumnDefault, LoweredColumn, SchemaColumn, SchemaOrigins, SchemaTable } from "./model";

const authored = (sourceId: string) => ({ kind: "authored" as const, sourceId });
const implicit = (sourceId: string) => ({ kind: "implicit" as const, sourceId });
const derived = (sourceId: string) => ({ kind: "derived" as const, sourceId });

/** The pinned DML compiler owns generated columns and implicit pivots. */
export const dmlSchemaOrigins: SchemaOrigins = {
  table: table => (table.columns.some(column => column.primaryKey) ? authored : implicit)(table.name),
  column: (table, column) => ["created_at", "updated_at", "deleted_at"].includes(column.name)
    ? implicit("dml." + column.name)
    : column.generated ? derived(table.name + "." + column.name)
      : (table.columns.some(column => column.primaryKey) ? authored : implicit)(table.name + "." + column.name),
  primaryKey: table => authored(table.name + ".primary"),
  searchable: table => authored(table.name + ".searchable"),
};

function columnType(column: SchemaColumn): LoweredColumn["type"] {
  switch (column.type) {
    case "id": case "enum": return "text";
    case "number": return "integer";
    case "dateTime": return "timestamptz";
    case "json": return "jsonb";
    case "bigNumber": return "numeric";
    default: return column.type;
  }
}

function columnDefault(column: SchemaColumn): ColumnDefault {
  const value = column.defaultValue;
  if (value === undefined) return { kind: ["created_at", "updated_at"].includes(column.name) ? "currentTimestamp" : "none" };
  if (column.type === "bigNumber") return { kind: "exactNumericLiteral", value: String(value) };
  if (typeof value === "object") return { kind: "exactNumericRawLiteral", ...value };
  if (typeof value === "boolean") return { kind: "booleanLiteral", value };
  if (typeof value === "number") return { kind: "integerLiteral", value };
  return { kind: "textLiteral", value };
}

/** Pure lowering of already-checked DML. The module still owns source admission;
 * Flarex normalization owns relational validity and artifact authority. No
 * metadata is retained, mutated, or used to acquire a persistence capability. */
export function lowerDmlSchema(input: readonly SchemaTable[], origins: SchemaOrigins = dmlSchemaOrigins) {
  const tables = input.map((table) => {
    const primary = table.columns.filter((column) => column.primaryKey);
    const origin = primary.length === 0 ? implicit : authored;
    const reference = (columnId: string) => ({
      tableId: table.name,
      columnId,
    });
    const columns = table.columns.map((column): LoweredColumn => ({
      columnId: column.name,
      type: columnType(column),
      nullable: column.nullable,
      default: columnDefault(column),
      origin: origins.column(table, column),
    }));
    const keys = [
      ...(primary.length === 0
        ? []
        : [
            {
              keyId: table.name + ".primary",
              kind: "primary",
              columns: primary.map((column) => column.name),
              origin: origins.primaryKey(table),
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
                    origin: origins.searchable(table),
                  },
                ]),
          ];
    return {
      table: {
        tableId: table.name,
        origin: origins.table(table),
        columns,
        keys,
        indexes,
        constraints,
        relationships,
      },
      capabilities: [...capabilities, ...(table.exactNumbers ?? []).map(companion => ({
        capabilityId: companion.capabilityId, kind: "exactNumericCompanion",
        numericColumn: reference(companion.numericColumn), rawColumn: reference(companion.rawColumn),
        origin: derived("dml.big-number.companion"),
      }))],
    };
  });
  return {
    owner: "medusa",
    lineageId: "commerce",
    tables: tables.map((value) => value.table),
    capabilities: tables.flatMap((value) => value.capabilities),
  };
}
