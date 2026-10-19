import { Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { orderNativeIdRows, projectNativeRow } from "./result";
import { commerceRelationReadQuery } from "../query/relations";
import type { PhysicalReferenceDetachment } from "./reference-detachment";

/** Correlate an already executed bounded physical cascade with its complete
 * indexed reads and delete preimages. This issues no reads or mutations;
 * medusaLifecycle remains the sole traversal/execution owner. */
export function correlatePhysicalGraphReceipt(input: {
  readonly tables: readonly SchemaTable[];
  readonly entities: readonly { readonly table: SchemaTable; readonly maximum: number;
    readonly decodeRow: (value: unknown) => Result.Result<JsonObject, CommerceTransactionError> }[];
  readonly root: SchemaTable;
  readonly referenceDetachments?: readonly PhysicalReferenceDetachment[];
  readonly requestedIds: readonly string[];
  readonly activity: Parameters<LogicalCallReceiptValidation>[1];
}) {
  return Result.gen(function* () {
    const { tables, entities, root, requestedIds, activity } = input, mismatch = () => commerceError("receiptMismatch");
    const detachments = input.referenceDetachments ?? [], sources = new Set(detachments.map(edge => edge.sourceTable));
    const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
    const observed = new Map<string, Map<string, JsonObject & { readonly id: string }>>(),
      finalObserved = new Map<string, Map<string, JsonObject & { readonly id: string }>>(),
      detachedFinal = new Map<string, Map<string, JsonObject & { readonly id: string }>>();
    const record = (table: string, value: JsonObject, target = observed) => Result.gen(function* () {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch());
      const decoded = yield* entity.decodeRow(projectNativeRow(value)).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof decoded.id !== "string") return yield* Result.fail(mismatch());
      const row: JsonObject & { readonly id: string } = { ...decoded, id: decoded.id };
      const group = target.get(table) ?? new Map<string, JsonObject & { readonly id: string }>(), prior = group.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Result.fail(mismatch());
      group.set(row.id, row); target.set(table, group);
      if (group.size > entity.maximum) return yield* Result.fail(mismatch());
    });
    // Core observations project current rows after the whole call. Deleted
    // roots retain their complete preimages in mutations; surviving detached
    // sources have a distinct, causally authenticated final observation.
    for (const observation of activity.observedRows) yield* record(observation.table, observation.row, finalObserved);
    for (const mutation of activity.mutations) {
      if (mutation.before === null) return yield* Result.fail(mismatch());
      yield* record(mutation.table, mutation.before);
    }
    for (const [table, rows] of finalObserved) if (!sources.has(table)) for (const row of rows.values()) yield* record(table, row);
    if (detachments.some(edge => !byTable.has(edge.sourceTable) || !byTable.has(edge.targetTable) || sources.has(edge.targetTable) ||
      edge.sourceKey !== "id" || edge.targetColumn !== "id" || !tables.some(table => table.name === edge.sourceTable &&
        table.columns.some(column => column.name === edge.sourceColumn && column.nullable) && table.foreignKeys.some(key =>
          key.columns.length === 1 && key.columns[0] === edge.sourceColumn && key.referencedTable === edge.targetTable &&
          key.referencedColumns.length === 1 && key.referencedColumns[0] === edge.targetColumn && key.onDelete === undefined))))
      return yield* Result.fail(mismatch());
    const edges = tables.flatMap(child => child.foreignKeys.filter(key => key.onDelete === "cascade" && byTable.has(key.referencedTable) && !sources.has(key.referencedTable))
      .map(key => ({ child: child.name, parent: key.referencedTable, columns: key.columns, referenced: key.referencedColumns })));
    if (edges.some(edge => !byTable.has(edge.child) || edge.columns.length !== 1 || edge.referenced.length !== 1 || edge.referenced[0] !== "id"))
      return yield* Result.fail(mismatch());
    const roots = orderNativeIdRows([...observed.get(root.name)?.values() ?? []], {});
    if (roots.some(row => !requestedIds.includes(row.id))) return yield* Result.fail(mismatch());
    const expectedReads: JsonObject[] = [], selected = new Set<string>();
    if (requestedIds.length) expectedReads.push({ table: root.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: requestedIds }), total: roots.length, returned: roots.length });
    // Checked metadata supplies the same finite scalar-FK edge order as the
    // lifecycle owner. Correlate every required query, including empty children.
    const correlateChildren = (table: string, row: JsonObject & { readonly id: string }, depth: number): Result.Result<void, CommerceTransactionError> => Result.gen(function* () {
      if (depth > entities.length || selected.has(table + ":" + row.id)) return yield* Result.fail(mismatch());
      selected.add(table + ":" + row.id);
      for (const edge of edges.filter(edge => edge.parent === table)) {
        const column = edge.columns[0];
        if (column === undefined) return yield* Result.fail(mismatch());
        const members = orderNativeIdRows([...observed.get(edge.child)?.values() ?? []].filter(member => member[column] === row.id), {});
        expectedReads.push({ table: edge.child, query: commerceRelationReadQuery(defaultCommerceResources,
          { kind: "in", column, values: [row.id] }), total: members.length, returned: members.length });
        for (const member of members) yield* correlateChildren(edge.child, member, depth + 1);
      }
    });
    for (const row of roots) yield* correlateChildren(root.name, row, 0);
    const pending = new Set([...observed].flatMap(([table, rows]) => [...rows.keys()].map(id => table + ":" + id)));
    if ([...pending].some(identity => !selected.has(identity) && ![...sources].some(table => identity.startsWith(table + ":"))))
      return yield* Result.fail(mismatch());
    const expectedDetached = new Map<string, { readonly edge: PhysicalReferenceDetachment; readonly targetKey: string; readonly ordinal: number }>();
    const rootIds: string[] = [];
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      const row = mutation.before;
      if (row === null || typeof row.id !== "string" || mutation.ordinal !== ordinal) return yield* Result.fail(mismatch());
      const identity = mutation.table + ":" + row.id;
      if (mutation.deletedReference !== undefined) {
        const expected = expectedDetached.get(identity), after = mutation.after, marker = mutation.deletedReference;
        if (expected === undefined || after === null || mutation.operation !== "patch" || !pending.delete(identity) ||
          !jsonEqual(marker, { sourceColumn: expected.edge.sourceColumn, targetTable: expected.edge.targetTable,
            targetColumn: expected.edge.targetColumn, targetKey: expected.targetKey, targetDeleteOrdinal: expected.ordinal }) ||
          !jsonEqual(projectNativeRow(after), { ...projectNativeRow(row), [expected.edge.sourceColumn]: null }))
          return yield* Result.fail(mismatch());
        yield* record(mutation.table, after, detachedFinal);
        expectedDetached.delete(identity); continue;
      }
      if (mutation.operation !== "delete" || mutation.after !== null || sources.has(mutation.table) || !pending.delete(identity))
        return yield* Result.fail(mismatch());
      for (const edge of edges.filter(edge => edge.parent === mutation.table)) {
        const column = edge.columns[0];
        if (column === undefined) return yield* Result.fail(mismatch());
        for (const member of observed.get(edge.child)?.values() ?? []) if (member[column] === row.id && pending.has(edge.child + ":" + member.id))
          return yield* Result.fail(mismatch());
      }
      for (const edge of detachments.filter(edge => edge.targetTable === mutation.table)) {
        const members = [...observed.get(edge.sourceTable)?.values() ?? []].filter(member => member[edge.sourceColumn] === row.id);
        expectedReads.push({ table: edge.sourceTable, query: { predicate: { kind: "in", column: edge.sourceColumn, values: [row.id] },
          order: { column: edge.sourceKey, direction: "asc" } }, total: members.length, returned: members.length });
        for (const member of members) {
          const key = edge.sourceTable + ":" + member.id;
          if (expectedDetached.has(key) || !pending.has(key)) return yield* Result.fail(mismatch());
          expectedDetached.set(key, { edge, targetKey: row.id, ordinal });
        }
      }
      if (mutation.table === root.name) rootIds.push(row.id);
    }
    if (pending.size || expectedDetached.size || !jsonEqual(expectedReads, activity.relationalReads)) return yield* Result.fail(mismatch());
    for (const source of sources) {
      const expected = detachedFinal.get(source), actual = finalObserved.get(source);
      if ((expected?.size ?? 0) !== (actual?.size ?? 0) || [...expected?.entries() ?? []].some(([id, row]) => {
        const observed = actual?.get(id);
        return observed === undefined || !jsonEqual(row, observed);
      }))
        return yield* Result.fail(mismatch());
    }
    return rootIds;
  });
}
