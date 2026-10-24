import { Result, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import type { LogicalCallReceiptValidation } from "./call-receipt";
import { orderNativeIdRows, projectNativeRow } from "./result";
import { commerceRelationReadQuery } from "../query/relations";
import { commerceDecoder } from "../value/decoder";
import type { PhysicalReferenceDetachment } from "./reference-detachment";

/** Correlate an already executed bounded physical cascade with its complete
 * indexed reads and delete preimages. This issues no reads or mutations;
 * medusaLifecycle remains the sole traversal/execution owner. */
export function correlatePhysicalGraphReceipt(input: {
  readonly tables: readonly SchemaTable[];
  readonly entities: readonly { readonly table: SchemaTable; readonly maximum: number;
    readonly decodeRow: (value: unknown) => Result.Result<JsonObject, CommerceTransactionError> }[];
  readonly root: SchemaTable;
  readonly rootOrder?: "storageInsertion";
  readonly rootMutationOrder?: "dependencies";
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
    // This trusted presentation policy is admitted only for a checked scalar
    // cascading self-FK root and its authenticated storage-insertion selection.
    if (input.rootMutationOrder !== undefined && (input.rootMutationOrder !== "dependencies" ||
      input.rootOrder !== "storageInsertion" || !tables.some(table => table === root) ||
      byTable.get(root.name)?.table !== root || !edges.some(edge => edge.child === root.name && edge.parent === root.name)))
      return yield* Result.fail(mismatch());
    // Same-table descendants are part of the complete graph, but only rows
    // selected by the original root query are requested roots.
    let roots = orderNativeIdRows([...observed.get(root.name)?.values() ?? []].filter(row => requestedIds.includes(row.id)), {});
    const expectedReads: JsonObject[] = [], selected = new Set<string>(), visiting = new Set<string>(), readSelections = new Set<string>();
    const expectRead = (table: string, column: string, values: readonly string[], total: number) => {
      const selection = JSON.stringify([table, column, values]);
      if (readSelections.has(selection)) return;
      readSelections.add(selection);
      expectedReads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column, values }), total, returned: total });
    };
    if (requestedIds.length) {
      if (input.rootOrder === "storageInsertion") {
        const identities = yield* commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String.check(Schema.isLengthBetween(1, 256)) }))
          .check(Schema.isMaxLength(entities.find(entity => entity.table.name === root.name)?.maximum ?? 0)), "receiptMismatch")
          (activity.relationalReads[0]?.orderedIdentities);
        const byId = new Map(roots.map(row => [row.id, row])), ordered: typeof roots = [];
        for (const identity of identities) {
          const row = byId.get(identity.id);
          if (row === undefined) return yield* Result.fail(mismatch());
          byId.delete(identity.id); ordered.push(row);
        }
        if (byId.size) return yield* Result.fail(mismatch());
        roots = ordered;
        expectedReads.push({ table: root.name, query: commerceRelationReadQuery(defaultCommerceResources,
          { kind: "in", column: "id", values: requestedIds }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
          total: roots.length, returned: roots.length, orderedIdentities: identities });
      } else expectRead(root.name, "id", requestedIds, roots.length);
    }
    // Checked metadata supplies the same finite scalar-FK edge order as the
    // lifecycle owner. Correlate every required query, including empty children.
    const correlateChildren = (table: string, row: JsonObject & { readonly id: string }): Result.Result<void, CommerceTransactionError> => Result.gen(function* () {
      const identity = table + ":" + row.id;
      if (visiting.has(identity)) return yield* Result.fail(mismatch());
      // Overlapping explicit roots and repeated FK reachability share the
      // lifecycle owner's completed node and indexed-selection caches.
      if (selected.has(identity)) return;
      selected.add(identity); visiting.add(identity);
      for (const edge of edges.filter(edge => edge.parent === table)) {
        const column = edge.columns[0];
        if (column === undefined) return yield* Result.fail(mismatch());
        const members = orderNativeIdRows([...observed.get(edge.child)?.values() ?? []].filter(member => member[column] === row.id), {});
        expectRead(edge.child, column, [row.id], members.length);
        for (const member of members) yield* correlateChildren(edge.child, member);
      }
      visiting.delete(identity);
    });
    for (const row of roots) yield* correlateChildren(root.name, row);
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
      if (mutation.table === root.name && requestedIds.includes(row.id)) rootIds.push(row.id);
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
    if (input.rootOrder === "storageInsertion" && input.rootMutationOrder === "dependencies") {
      const selectedRootIds = roots.map(row => row.id), removedRootIds = new Set(rootIds);
      // Existing pending/dependency guards authenticate physical mutation order.
      // This selected policy presents the same complete explicit cohort in its
      // independently authenticated selection order.
      if (removedRootIds.size !== rootIds.length || removedRootIds.size !== selectedRootIds.length ||
        selectedRootIds.some(id => !removedRootIds.has(id))) return yield* Result.fail(mismatch());
      return selectedRootIds;
    }
    if (input.rootOrder === "storageInsertion" && !jsonEqual(rootIds, roots.map(row => row.id))) return yield* Result.fail(mismatch());
    return rootIds;
  });
}
