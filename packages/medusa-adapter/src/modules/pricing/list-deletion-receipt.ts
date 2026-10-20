import { Effect, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { decodePriceListDeletionIds } from "./list-input";
import type { PriceListDeletionContracts } from "./list-deletion-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING),
    object: Schema.Literals(["price_list", "price", "price_list_rule", "price_rule"]),
    action: Schema.Literals(["deleted", "updated"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, defaultCommerceResources.eventIds))]) }),
}), defaultCommerceResources);

/** The approved portable lifecycle authenticates its complete planned graph,
 * grouped traversal order, actual DML return rows and native classified events.
 * Raw retained selectors can restore history; native restore emits no events. */
export function pricingListDeletionPolicy(contracts: PriceListDeletionContracts) {
  const byTable = new Map(contracts.families.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("PricingListDeletion.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingListDeletion.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const operation = call.commandName === "pricingListSoftDeleteForWorkflow" ? "softDelete"
      : call.commandName === "pricingListRestoreForWorkflow" ? "restore" : undefined;
    if (!operation || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const ids = yield* Effect.fromResult(decodePriceListDeletionIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>(), observed = new Map<string, JsonObject>();
    const key = (table: string, id: string) => JSON.stringify([table, id]);
    const record = Effect.fn("PricingListDeletion.observeRow")(function* (table: string, value: JsonObject, overwrite = false) {
      const family = byTable.get(table);
      if (!family) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(family.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || table === contracts.tables.list.name && !ids.includes(row.id))
        return yield* Effect.fail(mismatch());
      const group = evidence.get(table) ?? new Map<string, JsonObject>(), prior = group.get(row.id);
      if (!overwrite && prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      group.set(row.id, row); evidence.set(table, group);
      if (group.size > family.maximum) return yield* Effect.fail(mismatch());
      return row;
    });
    for (const observation of activity.observedRows) {
      const row = yield* record(observation.table, observation.row);
      observed.set(key(observation.table, String(row.id)), row);
    }
    const preimages = new Set<string>(), finalMutations = new Map<string, typeof activity.mutations[number]>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || typeof mutation.before.id !== "string") return yield* Effect.fail(mismatch());
      const identity = key(mutation.table, mutation.before.id);
      if (!preimages.has(identity)) { preimages.add(identity); yield* record(mutation.table, mutation.before, true); }
      finalMutations.set(identity, mutation);
    }
    for (const [identity, mutation] of finalMutations) {
      const family = byTable.get(mutation.table), actual = observed.get(identity);
      if (!family || !actual || mutation.after === null) return yield* Effect.fail(mismatch());
      const after = yield* Effect.fromResult(family.decodeRow(projectNativeRow(mutation.after)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(actual, after)) return yield* Effect.fail(mismatch());
    }
    const allRoots: Array<JsonObject & Readonly<{ id: string }>> =
      [...evidence.get(contracts.tables.list.name)?.entries() ?? []].map(([id, row]) => ({ ...row, id }));
    const roots = orderNativeIdRows(allRoots.filter(row => operation === "restore" || row.deleted_at === null), {});
    const selected = new Map<string, Set<string>>([[contracts.tables.list.name, new Set(roots.map(row => row.id))]]);
    const ordered = new Map<string, string[]>([[contracts.tables.list.name, roots.map(row => row.id)]]);
    const reads: JsonObject[] = [];
    if (ids.length) reads.push({ table: contracts.tables.list.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids }), total: allRoots.length, returned: allRoots.length });
    const children = (table: string, column: string, parent: string) => {
      const rows: Array<JsonObject & Readonly<{ id: string }>> = orderNativeIdRows([...evidence.get(table)?.entries() ?? []]
        .filter(([, row]) => row[column] === parent).map(([id, row]) => ({ ...row, id })), {});
      reads.push({ table, query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column, values: [parent] }),
        total: rows.length, returned: rows.length });
      const group = selected.get(table) ?? new Set<string>(), sequence = ordered.get(table) ?? [];
      for (const row of rows) { if (!group.has(row.id)) sequence.push(row.id); group.add(row.id); }
      selected.set(table, group); ordered.set(table, sequence); return rows;
    };
    for (const root of roots) {
      for (const price of children(contracts.tables.price.name, "price_list_id", root.id))
        children(contracts.tables.rule.name, "price_id", price.id);
      children(contracts.tables.listRule.name, "price_list_id", root.id);
    }
    for (const family of contracts.families.slice(1)) {
      const matched = selected.get(family.table.name) ?? new Set<string>();
      if ([...evidence.get(family.table.name)?.keys() ?? []].some(id => !matched.has(id))) return yield* Effect.fail(mismatch());
    }
    if (!jsonEqual(activity.relationalReads, reads)) return yield* Effect.fail(mismatch());
    const expectedLifecycle = contracts.families.flatMap(family => (ordered.get(family.table.name) ?? []).map(id => ({ table: family.table.name, id })));
    const actualLifecycle: Array<Readonly<{ table: string; id: string }>> = [];
    for (const transition of activity.lifecycle) {
      const id = transition.key.id;
      if (typeof id !== "string") return yield* Effect.fail(mismatch());
      actualLifecycle.push({ table: transition.table, id });
    }
    if (!jsonEqual(actualLifecycle, expectedLifecycle))
      return yield* Effect.fail(mismatch());
    // Preserve the actual unmapped complete ListRule objects. Only this private
    // graph-proof projection uses their IDs for the reusable lifecycle matcher.
    for (const row of result.PriceListRule ?? []) {
      const actual = observed.get(key(contracts.tables.listRule.name, row.id));
      if (!actual || !jsonEqual(actual, row)) return yield* Effect.fail(mismatch());
    }
    const projected: Record<string, readonly string[] | undefined> = {
      ...(result.price_list_id === undefined ? {} : { price_list_id: result.price_list_id }),
      ...(result.price_id === undefined ? {} : { price_id: result.price_id }),
      ...(result.PriceListRule === undefined ? {} : { PriceListRule: result.PriceListRule.map(row => row.id) }),
      ...(result.price_rule_id === undefined ? {} : { price_rule_id: result.price_rule_id }),
    };
    yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.families, rootTable: contracts.tables.list.name,
      operation, activity, evidence, selected, result: projected }));
    if (operation === "restore") {
      if (call.events.length) return yield* Effect.fail(mismatch());
      return;
    }
    // Each afterUpdate dispatch occupies its planned row position. The native
    // classifier marks new tombstones deleted and restamped history updated.
    const expected = expectedLifecycle.map(item => ({ ...item,
      action: evidence.get(item.table)?.get(item.id)?.deleted_at === null ? "deleted" : "updated" }));
    if (call.events.length !== expected.length) return yield* Effect.fail(mismatch());
    for (const [index, event] of call.events.entries()) {
      const message = yield* capture(event), item = expected[index];
      if (typeof message.data.id !== "string" || !item || item.table !== message.metadata.object ||
        item.id !== message.data.id || item.action !== message.metadata.action)
        return yield* Effect.fail(mismatch());
    }
  });
  return { capture, validateLogicalCall };
}
