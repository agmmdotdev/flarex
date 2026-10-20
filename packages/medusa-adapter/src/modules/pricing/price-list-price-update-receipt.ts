import { Effect } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { buildPreNormalizationPriceConstraintsFromData } from "@medusajs/pricing/services";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { commerceRelationReadQuery } from "../../query/relations";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { validatePriceListReadReceipt } from "./list-update-receipt";
import { decodePriceListPriceRead } from "./price-list-price-input";
import { initialPriceListPriceReceiptRows, pricingListPriceCreationPolicy, validatePriceListPriceWriteReceipt } from "./price-list-price-receipt";
import { decodeUpdatePriceListPrices, type PriceListPriceUpdateContracts } from "./price-list-price-update-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Row = JsonObject & Readonly<{ id: string }>;

const validateSnapshot = Effect.fn("PricingLists.validatePriceSnapshot")(function* (
  contracts: PriceListPriceUpdateContracts, call: Call, activity: Activity,
) {
  const input = yield* Effect.fromResult(decodeUpdatePriceListPrices(call.input));
  const output = yield* Effect.fromResult(contracts.decodeSnapshot(call.result));
  const mismatch = () => commerceError("receiptMismatch");
  if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
    return yield* Effect.fail(mismatch());
  const prices = input.flatMap(row => row.prices);
  if (!prices.length) {
    if (output.prices.length || activity.relationalReads.length || activity.observedRows.length) return yield* Effect.fail(mismatch());
    return;
  }
  const observed = yield* initialPriceListPriceReceiptRows(contracts, activity);
  const nativeWhere: unknown = yield* Effect.try({ try: () => Reflect.apply(buildPreNormalizationPriceConstraintsFromData, undefined,
    [prices, input.map(row => row.price_list_id)]), catch: cause => commerceError("receiptMismatch", cause) });
  const suppliedIds = prices.flatMap(price => price.id ? [price.id] : []);
  const where = suppliedIds.length ? { $or: [nativeWhere, { id: suppliedIds }] } : nativeWhere;
  const query: unknown = yield* Effect.try({ try: () => Reflect.apply(buildQuery, undefined,
    [where, { withDeleted: true, order: { id: "ASC" } }]), catch: cause => commerceError("receiptMismatch", cause) });
  const plan = yield* Effect.fromResult(contracts.compilePriceReadPlan(query));
  const consumeRead = (position: number, table: string, query: JsonObject) => Effect.gen(function* () {
    const read = activity.relationalReads[position];
    if (!read || read.table !== table || !jsonEqual(read.query, query) || read.total !== read.returned ||
      read.orderedIdentities === undefined || read.orderedIdentities.length !== read.returned)
      return yield* Effect.fail(mismatch());
    const rows: Row[] = [], seen = new Set<string>();
    for (const identity of read.orderedIdentities) {
      const id = identity.id;
      if (typeof id !== "string" || Object.keys(identity).length !== 1 || seen.has(id)) return yield* Effect.fail(mismatch());
      const row = observed.get(table + ":" + id);
      if (!row) return yield* Effect.fail(mismatch());
      seen.add(id); rows.push(row);
    }
    return rows;
  });
  const roots = yield* consumeRead(0, contracts.tables.price.name, plan.rootQuery);
  let children: Row[] = [];
  if (roots.length) {
    const nativeRuleQuery: unknown = yield* Effect.try({ try: () => Reflect.apply(buildQuery, undefined,
      [{ price_id: roots.map(row => row.id) }, { withDeleted: true, order: { id: "ASC" } }]), catch: cause => commerceError("receiptMismatch", cause) });
    const ruleQuery = yield* Effect.fromResult(contracts.compileRuleReadPlan(nativeRuleQuery));
    children = yield* consumeRead(1, contracts.tables.rule.name, ruleQuery);
  }
  if (activity.relationalReads.length !== (roots.length ? 2 : 1)) return yield* Effect.fail(mismatch());
  const ids = new Set(roots.map(row => row.id));
  if (children.some(row => typeof row.price_id !== "string" || !ids.has(row.price_id))) return yield* Effect.fail(mismatch());
  const complete = roots.map(row => ({ ...row, price_rules: children.filter(child => child.price_id === row.id) }));
  const projected = yield* projectExactNumericColumns(complete, contracts.tables.price.columns.filter(column => column.type === "bigNumber"));
  if (!jsonEqual(output.prices, projected)) return yield* Effect.fail(mismatch());
});

const validateRestore = Effect.fn("PricingLists.validatePriceRestore")(function* (
  contracts: PriceListPriceUpdateContracts, call: Call, activity: Activity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  const input = yield* Effect.fromResult(contracts.decodeCompensation(call.input));
  if (call.mode !== "write" || call.result !== null || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
    return yield* Effect.fail(mismatch());
  const initial = yield* initialPriceListPriceReceiptRows(contracts, activity), desired = new Map<string, Row>();
  const roots: Row[] = [], rules: Row[] = [];
  for (const inputPrice of input.before) {
    const { price_rules, ...source } = inputPrice, scalar: Record<string, Json> = { ...source };
    for (const column of contracts.tables.price.columns.filter(column => column.type === "bigNumber")) {
      const raw = scalar["raw_" + column.name];
      if (raw === null) scalar[column.name] = null;
      else if (raw !== undefined && isJsonObject(raw) && typeof raw.value === "string") scalar[column.name] = raw.value;
      else return yield* Effect.fail(mismatch());
    }
    const row = yield* Effect.fromResult(contracts.decodePriceRow(scalar)); roots.push(row); desired.set("price:" + row.id, row);
    for (const rule of price_rules) { rules.push(rule); desired.set("price_rule:" + rule.id, rule); }
  }
  const newIds = new Set(input.createdPriceIds), rootIds = new Set(roots.map(row => row.id));
  const initialNewRoots = [...initial].filter(([key, row]) => key.startsWith("price:") && newIds.has(row.id)).map(([, row]) => row);
  const newChildren = orderNativeIdRows([...initial].filter(([key, row]) => key.startsWith("price_rule:") &&
    typeof row.price_id === "string" && newIds.has(row.price_id)).map(([, row]) => row), {});
  const replacements = [...initial].filter(([key, row]) => key.startsWith("price_rule:") &&
    typeof row.price_id === "string" && rootIds.has(row.price_id) && !desired.has(key)).map(([, row]) => row);
  const consumed = new Set<number>();
  const consume = Effect.fn(function* (table: string, query: JsonObject, expected: readonly Row[], ordered = true) {
    const match = activity.relationalReads.findIndex((read, index) => !consumed.has(index) && read.table === table && jsonEqual(read.query, query));
    const read = activity.relationalReads[match];
    if (match < 0 || !read || read.total !== expected.length || read.returned !== expected.length) return yield* Effect.fail(mismatch());
    consumed.add(match);
    if (read.orderedIdentities !== undefined) {
      const actual = read.orderedIdentities.map(identity => {
        if (typeof identity.id !== "string" || Object.keys(identity).length !== 1) return undefined;
        return expected.find(row => row.id === identity.id);
      });
      if (actual.some(row => row === undefined) || new Set(actual.map(row => row?.id)).size !== expected.length ||
        ordered && !jsonEqual(read.orderedIdentities, expected.map(row => ({ id: row.id })))) return yield* Effect.fail(mismatch());
      return actual.flatMap(row => row === undefined ? [] : [row]);
    }
    if (!ordered) return yield* Effect.fail(mismatch());
    return [...expected];
  });
  const graphQuery = (column: string, ids: readonly string[], intrinsic = false) => commerceRelationReadQuery(defaultCommerceResources,
    { kind: "in", column, values: [...ids] }, intrinsic ? { kind: "storageInsertion", direction: "asc" } : "id");
  let deletedRoots: Row[] = [];
  if (input.createdPriceIds.length) {
    yield* consume("price_rule", graphQuery("price_id", input.createdPriceIds), newChildren);
    deletedRoots = yield* consume("price", graphQuery("id", input.createdPriceIds, true), initialNewRoots, false);
  }
  const references = new Set<string>(), replacementOrder: Row[] = [];
  for (const root of roots) {
    const prior = initial.get("price:" + root.id);
    yield* consume("price", graphQuery("id", [root.id]), prior ? [prior] : []);
    for (const [table, column] of [["price_set", "price_set_id"], ["price_list", "price_list_id"]] as const) {
      const id = root[column]; if (id === null) continue;
      if (typeof id !== "string") return yield* Effect.fail(mismatch());
      const token = table + ":" + id; if (references.has(token)) continue;
      const row = initial.get(token); if (!row) return yield* Effect.fail(mismatch());
      yield* consume(table, graphQuery("id", [id]), [row]); references.add(token);
    }
    const previousRows = [...initial].filter(([key, row]) => key.startsWith("price_rule:") && row.price_id === root.id).map(([, row]) => row);
    const previous = yield* consume("price_rule", graphQuery("price_id", [root.id], true), previousRows, false);
    for (const row of previous) if (!desired.has("price_rule:" + row.id)) replacementOrder.push(row);
    for (const child of rules.filter(row => row.price_id === root.id)) {
      if (previous.some(row => row.id === child.id)) continue;
      const selected = initial.get("price_rule:" + child.id);
      yield* consume("price_rule", graphQuery("id", [child.id], true), selected ? [selected] : [], false);
    }
  }
  let deletedRules: Row[] = [];
  if (replacementOrder.length) deletedRules = yield* consume("price_rule", graphQuery("id", replacementOrder.map(row => row.id), true), replacements, false);
  const createdRoots = roots.filter(row => !initial.has("price:" + row.id)), updatedRoots = roots.filter(row => initial.has("price:" + row.id));
  const createdRules = rules.filter(row => !initial.has("price_rule:" + row.id)), updatedRules = rules.filter(row => initial.has("price_rule:" + row.id));
  const expectedMutations = [
    ...newChildren.map(row => ({ table: "price_rule", operation: "delete", row })), ...deletedRoots.map(row => ({ table: "price", operation: "delete", row })),
    ...deletedRules.map(row => ({ table: "price_rule", operation: "delete", row })),
    ...createdRoots.map(row => ({ table: "price", operation: "insert", row })), ...createdRules.map(row => ({ table: "price_rule", operation: "insert", row })),
    ...updatedRoots.map(row => ({ table: "price", operation: "replace", row })), ...updatedRules.map(row => ({ table: "price_rule", operation: "replace", row })),
  ];
  if (expectedMutations.length !== activity.mutations.length) return yield* Effect.fail(mismatch());
  for (const [index, expected] of expectedMutations.entries()) {
    const actual = activity.mutations[index];
    if (!actual || actual.ordinal !== index || actual.table !== expected.table || actual.operation !== expected.operation ||
      !jsonEqual(projectNativeRow(expected.operation === "delete" ? actual.before ?? {} : actual.after ?? {}), expected.row) ||
      (expected.operation === "delete" ? actual.after !== null : expected.operation === "insert" ? actual.before !== null :
        !jsonEqual(projectNativeRow(actual.before ?? {}), initial.get(expected.table + ":" + expected.row.id) ?? null)))
      return yield* Effect.fail(mismatch());
  }
  if (roots.length) yield* consume("price_rule", graphQuery("price_id", [...createdRoots, ...updatedRoots].map(row => row.id), true), rules, false);
  if (consumed.size !== activity.relationalReads.length) return yield* Effect.fail(mismatch());
  const events = [...deletedRoots.map(row => "price:deleted:" + row.id),
    ...createdRoots.map(row => "price:created:" + row.id), ...createdRules.map(row => "price_rule:created:" + row.id),
    ...updatedRoots.map(row => "price:updated:" + row.id), ...updatedRules.map(row => "price_rule:updated:" + row.id),
    ...deletedRules.map(row => "price_rule:deleted:" + row.id)];
  if (events.length !== call.events.length) return yield* Effect.fail(mismatch());
  const { capture } = pricingListPriceCreationPolicy(contracts);
  for (const [index, inputEvent] of call.events.entries()) {
    const event = yield* capture(inputEvent);
    if (event.metadata.object + ":" + event.metadata.action + ":" + event.data.id !== events[index]) return yield* Effect.fail(mismatch());
  }
});

/** The closed native callback owns the before/new-ID partition. Complete DML
 * validation proves shape; recorded-preimage replay separately proves clocks. */
export function pricingListPriceUpdatePolicy(contracts: PriceListPriceUpdateContracts) {
  const { capture } = pricingListPriceCreationPolicy(contracts);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingLists.validatePriceUpdateCall")(function* (call, activity) {
    if (call.commandName === "pricingListPriceUpdateRead") {
      yield* Effect.fromResult(decodePriceListPriceRead(call.input));
      return yield* validatePriceListReadReceipt(contracts.listReadContracts, call, activity, "pricingListPriceUpdateRead");
    }
    if (call.commandName === "pricingListPriceSnapshot") return yield* validateSnapshot(contracts, call, activity);
    if (call.commandName === "pricingListPriceUpdate") {
      if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return yield* validatePriceListPriceWriteReceipt(contracts, call, activity, contracts);
    }
    if (call.commandName === "pricingListPriceRestore") return yield* validateRestore(contracts, call, activity);
    return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError((cause: ReturnType<typeof commerceError>) => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const, allowRecordedRowReplay: true as const,
    allowPreservingDeletionUpsert: "preserveTimestamps" as const };
}
