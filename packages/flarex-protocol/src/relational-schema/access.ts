import type { RelationalColumnIdentity, RelationalTableDefinition } from "./model";

interface RelationalReverseIndex {
  readonly column: RelationalColumnIdentity;
  readonly descriptor: string;
}

/** Shared unconditional scalar access missing from native declarations. FK
 * paths retain their durable descriptors; composite key suffixes grant indexed
 * membership only, with no endpoint-existence or foreign-key semantics. */
export function relationalReverseIndexes(table: RelationalTableDefinition): readonly RelationalReverseIndex[] {
  const covered = new Set([
    ...table.keys.map(key => key.columns[0]?.columnId),
    ...table.indexes.filter(index => index.predicate === null && index.kind !== "jsonContainment")
      .map(index => index.columns[0]?.columnId),
  ]);
  const derived: RelationalReverseIndex[] = [];
  const add = (column: RelationalColumnIdentity, descriptor: string) => {
    if (covered.has(column.columnId) || table.columns.find(field => field.identity.columnId === column.columnId)?.type !== "text") return;
    covered.add(column.columnId);
    derived.push(Object.freeze({ column, descriptor }));
  };
  // Existing FK names and ordering are durable catalog obligations. Retain them
  // first even when the same field also belongs to a composite key suffix.
  for (const constraint of table.constraints) {
    if (constraint.kind !== "foreignKey" || constraint.sourceColumns.length !== 1) continue;
    const column = constraint.sourceColumns[0];
    if (column !== undefined) add(column, `fk-reverse/${column.columnId}`);
  }
  for (const key of table.keys) for (const column of key.columns.slice(1))
    add(column, `key-reverse/${column.columnId}`);
  return Object.freeze(derived);
}

/** An admitted scalar equality can use the first column of a declared key or
 * unconditional index, or its authenticated derived text reverse path. */
export function relationalHasIndexedScalarPrefix(table: RelationalTableDefinition, columnId: string): boolean {
  return table.keys.some(key => key.columns[0]?.columnId === columnId) ||
    table.indexes.some(index => index.predicate === null && index.kind !== "jsonContainment" &&
      index.columns[0]?.columnId === columnId) ||
    relationalReverseIndexes(table).some(index => index.column.columnId === columnId);
}
