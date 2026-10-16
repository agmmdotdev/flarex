import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { jsonEqual } from "flarex-protocol/json";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "../runtime-metadata";

import { matchesPublicRow } from "../../../repository/result";

export function productResultGraphMatcher(catalog: ProductRuntimeMetadata, rootTable: string,
  activity: Parameters<LogicalCallReceiptValidation>[1]): (stored: JsonObject, returned: Json) => boolean {
  const rows = new Map<string, JsonObject[]>();
  for (const { table, row } of activity.observedRows) rows.set(table, [...rows.get(table) ?? [], row]);
  for (const mutation of activity.mutations) {
    const after = mutation.after;
    if (after === null || typeof after.id !== "string") continue;
    const previous = rows.get(mutation.table) ?? [];
    rows.set(mutation.table, [...previous.filter(row => row.id !== after.id), after]);
  }
  const tuple = (row: JsonObject, columns: readonly string[]) => JSON.stringify(columns.map(column => row[column]));
  const matches = (table: string, current: JsonObject, value: Json, depth: number): boolean => {
    if (depth > 4 || !isJsonObject(value)) return false;
    const fields = Object.keys(current).filter(key => key !== "_id" && key !== "_creationTime");
    const relations = catalog.queryRelations.get(table);
    if (!fields.every(key => value[key] !== undefined && current[key] !== undefined && jsonEqual(value[key], current[key])) ||
      Object.keys(value).some(key => !fields.includes(key) && relations?.has(key) !== true)) return false;
    for (const [name, relation] of relations ?? []) {
      const selected = value[name];
      if (selected === undefined) continue;
      const targetRows = rows.get(relation.targetTable) ?? [];
      if (relation.join.type === "belongsTo") {
        const key = tuple(current, relation.join.foreignKeys);
        const targets = targetRows.filter(row => tuple(row, relation.targetPrimaryKeys) === key);
        if (relation.join.foreignKeys.every(column => current[column] === null)) {
          if (selected !== null) return false;
        } else if (targets.length !== 1 || !matches(relation.targetTable, targets[0]!, selected, depth + 1)) return false;
        continue;
      }
      if (!Array.isArray(selected)) return false;
      const join = relation.join;
      const matching = join.type === "hasMany"
        ? targetRows.filter(row => tuple(row, join.foreignKeys) === tuple(current, relation.sourcePrimaryKeys))
        : targetRows.filter(row => (rows.get(join.pivotTable) ?? []).some(pivot =>
          tuple(pivot, join.sourceColumns) === tuple(current, relation.sourcePrimaryKeys) &&
          tuple(pivot, join.targetColumns) === tuple(row, relation.targetPrimaryKeys)));
      const expected = new Map(matching.map(row => [tuple(row, relation.targetPrimaryKeys), row]));
      if (expected.size !== matching.length || expected.size !== selected.length) return false;
      for (const item of selected) {
        if (!isJsonObject(item)) return false;
        const key = tuple(item, relation.targetPrimaryKeys);
        const target = expected.get(key);
        if (target === undefined || !matches(relation.targetTable, target, item, depth + 1)) return false;
        expected.delete(key);
      }
      if (expected.size !== 0) return false;
    }
    return true;
  };
  return (stored, returned) => matches(rootTable, stored, returned, 0);
}
