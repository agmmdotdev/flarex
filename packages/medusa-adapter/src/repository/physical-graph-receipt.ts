import { Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { orderNativeIdRows, projectNativeRow } from "./result";
import { commerceRelationReadQuery } from "../query/relations";

/** Correlate an already executed bounded physical cascade with its complete
 * indexed reads and delete preimages. This issues no reads or mutations;
 * medusaLifecycle remains the sole traversal/execution owner. */
export function correlatePhysicalGraphReceipt(input: {
  readonly tables: readonly SchemaTable[];
  readonly entities: readonly { readonly table: SchemaTable; readonly maximum: number;
    readonly decodeRow: (value: unknown) => Result.Result<JsonObject, CommerceTransactionError> }[];
  readonly root: SchemaTable;
  readonly requestedIds: readonly string[];
  readonly activity: Parameters<LogicalCallReceiptValidation>[1];
}) {
  return Result.gen(function* () {
    const { tables, entities, root, requestedIds, activity } = input, mismatch = () => commerceError("receiptMismatch");
    const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
    const observed = new Map<string, Map<string, JsonObject & { readonly id: string }>>();
    const record = (table: string, value: JsonObject) => Result.gen(function* () {
      const entity = byTable.get(table);
      if (entity === undefined) return yield* Result.fail(mismatch());
      const decoded = yield* entity.decodeRow(projectNativeRow(value)).pipe(Result.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof decoded.id !== "string") return yield* Result.fail(mismatch());
      const row: JsonObject & { readonly id: string } = { ...decoded, id: decoded.id };
      const group = observed.get(table) ?? new Map<string, JsonObject & { readonly id: string }>(), prior = group.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Result.fail(mismatch());
      group.set(row.id, row); observed.set(table, group);
      if (group.size > entity.maximum) return yield* Result.fail(mismatch());
    });
    for (const observation of activity.observedRows) yield* record(observation.table, observation.row);
    for (const mutation of activity.mutations) {
      if (mutation.before === null) return yield* Result.fail(mismatch());
      yield* record(mutation.table, mutation.before);
    }
    const edges = tables.flatMap(child => child.foreignKeys.filter(key => key.onDelete === "cascade" && byTable.has(key.referencedTable))
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
    if (!jsonEqual(expectedReads, activity.relationalReads)) return yield* Result.fail(mismatch());
    const pending = new Set([...observed].flatMap(([table, rows]) => [...rows.keys()].map(id => table + ":" + id)));
    if (pending.size !== selected.size || [...pending].some(identity => !selected.has(identity))) return yield* Result.fail(mismatch());
    const rootIds: string[] = [];
    for (const [ordinal, mutation] of activity.mutations.entries()) {
      const row = mutation.before;
      if (row === null || typeof row.id !== "string" || mutation.ordinal !== ordinal || mutation.operation !== "delete" || mutation.after !== null ||
        !pending.delete(mutation.table + ":" + row.id)) return yield* Result.fail(mismatch());
      for (const edge of edges.filter(edge => edge.parent === mutation.table)) {
        const column = edge.columns[0];
        if (column === undefined) return yield* Result.fail(mismatch());
        for (const member of observed.get(edge.child)?.values() ?? []) if (member[column] === row.id && pending.has(edge.child + ":" + member.id))
          return yield* Result.fail(mismatch());
      }
      if (mutation.table === root.name) rootIds.push(row.id);
    }
    if (pending.size) return yield* Result.fail(mismatch());
    return rootIds;
  });
}
