import type { RelationalPhysicalLayoutFrame } from "../../../persistence-postgres/src/relationalSchema/physical/model";

/** Test-owned whole-fixture cleanup, across every scope. Only admitted application
 * tables participate; scope clocks, installation and command history stay intact. */
export function productFixtureResetSql(layout: RelationalPhysicalLayoutFrame): string {
  const remaining = new Map(layout.tables.map(table => [table.identity.tableId, table]));
  const references = layout.foreignKeys.filter(key => key.kind === "foreignKey");
  const statements: string[] = [];
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  for (const key of references) {
    if (!remaining.has(key.sourceTable.tableId) || !remaining.has(key.targetTable.tableId)) {
      throw new Error("Product fixture foreign key leaves the admitted table set");
    }
  }
  while (remaining.size > 0) {
    // Delete children before parents, including CASCADE edges. A whole-table
    // DELETE removes both ends of a self-reference in the same statement.
    const next = [...remaining.values()].find(table => !references.some(key =>
      key.targetTable.tableId === table.identity.tableId &&
      key.sourceTable.tableId !== table.identity.tableId && remaining.has(key.sourceTable.tableId)));
    if (next === undefined) throw new Error("Product fixture has a cross-table foreign-key cycle");
    statements.push("delete from " + quote(layout.targetNamespace.schemaName) + "." + quote(next.name));
    remaining.delete(next.identity.tableId);
  }
  if (statements.length === 0) throw new Error("Product fixture has no admitted tables");
  // One simple-query batch is atomic on both fixture drivers; no explicit BEGIN
  // can leave a failed transaction attached to a pooled connection.
  return statements.join("; ");
}
