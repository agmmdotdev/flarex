import type { RelationalColumnIdentity, RelationalTableDefinition } from "./model";

/** A native FK needs a bounded reverse lookup even when its DML declaration
 * supplies no child-side index. This is one derived access path per text field. */
export function relationalForeignKeyReverseColumns(table: RelationalTableDefinition): readonly RelationalColumnIdentity[] {
  const covered = new Set([
    ...table.keys.map(key => key.columns[0]?.columnId),
    ...table.indexes.filter(index => index.predicate === null).map(index => index.columns[0]?.columnId),
  ]);
  const derived: RelationalColumnIdentity[] = [];
  for (const constraint of table.constraints) {
    if (constraint.kind !== "foreignKey" || constraint.sourceColumns.length !== 1) continue;
    const source = constraint.sourceColumns[0];
    if (source === undefined || covered.has(source.columnId) ||
      table.columns.find(column => column.identity.columnId === source.columnId)?.type !== "text") continue;
    covered.add(source.columnId);
    derived.push(source);
  }
  return Object.freeze(derived);
}

export function relationalHasIndexedTextPrefix(table: RelationalTableDefinition, columnId: string): boolean {
  return table.keys.some(key => key.columns[0]?.columnId === columnId) ||
    table.indexes.some(index => index.predicate === null && index.columns[0]?.columnId === columnId) ||
    relationalForeignKeyReverseColumns(table).some(column => column.columnId === columnId);
}
