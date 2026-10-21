import { Effect, Option, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { correlateLifecycleGraphReceipt } from "../../repository/lifecycle-graph-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { decodePriceListPriceRemovalIds } from "./price-list-price-input";
import { decodePriceListPriceRemovalRead, type PriceListPriceRemovalContracts } from "./price-list-price-removal-input";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literals(["price", "price_rule"]),
    action: Schema.Literals(["deleted", "updated"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, defaultCommerceResources.eventIds))]) }),
}), defaultCommerceResources);

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Row = JsonObject & Readonly<{ id: string }>;
const validateRead = Effect.fn("PricingPriceRemoval.validateRead")(function* (
  contracts: PriceListPriceRemovalContracts, call: Call, activity: Activity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  if (call.mode !== "read" || call.events.length || activity.mutations.length || activity.lifecycle.length ||
    activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(mismatch());
  const input = yield* Effect.fromResult(decodePriceListPriceRemovalRead(call.input));
  const native = yield* Effect.try({ try: () => buildQuery(input.filters, { relations: [...input.config.relations], order: { id: "ASC" } }),
    catch: cause => commerceError("receiptMismatch", cause) });
  const plan = yield* Effect.fromResult(contracts.compileNativeReadPlan(native));
  const rows = new Map<string, Map<string, Row>>();
  for (const observation of activity.observedRows) {
    const decode = observation.table === contracts.tables.price.name ? contracts.decodePriceRow
      : observation.table === contracts.tables.set.name ? contracts.decodeSetRow
      : observation.table === contracts.tables.list.name ? contracts.decodeListRow : undefined;
    if (!decode) return yield* Effect.fail(mismatch());
    const scalar = yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
    if (typeof scalar.id !== "string") return yield* Effect.fail(mismatch());
    const row: Row = { ...scalar, id: scalar.id }, group = rows.get(observation.table) ?? new Map<string, Row>();
    const prior = group.get(row.id);
    if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
    group.set(row.id, row); rows.set(observation.table, group);
  }
  const consumed = new Set<string>();
  let readPosition = 0;
  const consume = Effect.fn("PricingPriceRemoval.consumeRead")(function* (
    table: string, query: JsonObject, expected: readonly Row[], identities = false, lookedUp: readonly Row[] = expected,
  ) {
    const actual = activity.relationalReads[readPosition++];
    if (!jsonEqual(actual ?? null, { table, query, total: expected.length, returned: expected.length,
      ...(identities ? { orderedIdentities: expected.map(row => ({ id: row.id })) } : {}) })) return yield* Effect.fail(mismatch());
    for (const row of lookedUp) consumed.add(JSON.stringify([table, row.id]));
  });
  const lookedUpPrices = orderNativeIdRows([...rows.get(contracts.tables.price.name)?.values() ?? []], {});
  if (lookedUpPrices.length > 8 || lookedUpPrices.some(row => !input.filters.id.includes(row.id))) return yield* Effect.fail(mismatch());
  const candidates = lookedUpPrices.filter(row => row.deleted_at === null);
  yield* consume(contracts.tables.price.name, plan.rootQuery(), candidates, true, lookedUpPrices);
  let roots: Row[] = [];
  const related = new Map<string, readonly JsonObject[]>();
  if (candidates.length) {
    const setIds: string[] = [];
    for (const row of candidates) {
      if (typeof row.price_set_id !== "string") return yield* Effect.fail(mismatch());
      setIds.push(row.price_set_id);
    }
    // The native required Set relation determines membership before population.
    const lookedUpSets = orderNativeIdRows([...rows.get(contracts.tables.set.name)?.values() ?? []], {});
    if (lookedUpSets.some(row => !setIds.includes(row.id))) return yield* Effect.fail(mismatch());
    const sets = lookedUpSets.filter(row => row.deleted_at === null);
    yield* consume(contracts.tables.set.name, commerceRelationReadQuery(defaultCommerceResources,
      plan.setPredicate(setIds)), sets, false, lookedUpSets);
    const activeSetIds = new Set(sets.map(row => row.id));
    roots = candidates.filter(row => typeof row.price_set_id === "string" && activeSetIds.has(row.price_set_id));
    yield* consume(contracts.tables.price.name, plan.rootQuery({ kind: "in", column: "price_set_id", values: sets.map(row => row.id) }), roots, true);
    for (const [name, table, column] of [["price_set", contracts.tables.set.name, "price_set_id"],
      ["price_list", contracts.tables.list.name, "price_list_id"]] as const) {
      const selection = yield* Effect.fromResult(prepareCommerceRelationPopulation(["id"], roots, [column], true, false));
      const lookedUpMembers = orderNativeIdRows([...rows.get(table)?.values() ?? []]
        .filter(row => roots.some(root => root[column] === row.id)), {});
      const members = lookedUpMembers.filter(row => row.deleted_at === null);
      if (Option.isSome(selection)) yield* consume(table, commerceRelationReadQuery(defaultCommerceResources, selection.value.predicate), members, false, lookedUpMembers);
      else if (lookedUpMembers.length) return yield* Effect.fail(mismatch());
      related.set(table, members);
      // Keep the admitted path tied to its checked relation owner.
      if (contracts.relations.get(contracts.tables.price.name)?.get(name)?.targetTable !== table) return yield* Effect.fail(mismatch());
    }
  }
  if (readPosition !== activity.relationalReads.length || [...rows].some(([table, group]) =>
    [...group.keys()].some(id => !consumed.has(JSON.stringify([table, id]))))) return yield* Effect.fail(mismatch());
  related.set(contracts.tables.price.name, roots);
  const graph = assembleCommerceRelations(contracts.tables.price.name, related, ["price_set", "price_list"], contracts.relations);
  const expected: JsonObject[] = [];
  for (const row of graph) {
    if (row.price_set === undefined || !isJsonObject(row.price_set) || typeof row.price_set.id !== "string")
      return yield* Effect.fail(mismatch());
    expected.push({ ...row, price_set: { id: row.price_set.id }, ...(row.price_list === null ? { price_list_id: null } : {}) });
  }
  const projected = yield* projectExactNumericColumns(expected, contracts.tables.price.columns.filter(column => column.type === "bigNumber"));
  const output = yield* Effect.fromResult(contracts.decodeReadOutput(call.result));
  if (!jsonEqual(projected, output)) return yield* Effect.fail(mismatch());
});

/** Authenticate actual TABLE+ID rows, complete current history and the approved
 * Price group followed by Rules in parent Price.id/Rule.id traversal order. */
export function pricingPriceListPriceRemovalPolicy(contracts: PriceListPriceRemovalContracts) {
  const byTable = new Map(contracts.families.map(entity => [entity.table.name, entity]));
  const capture = Effect.fn("PricingPriceRemoval.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING,
      objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingPriceRemoval.validateCall")(function* (call, activity) {
    if (call.commandName === "pricingListPricesForRemovalWorkflow") return yield* validateRead(contracts, call, activity);
    const mismatch = () => commerceError("receiptMismatch");
    const operation = call.commandName === "pricingPriceSoftDeleteForRemovalWorkflow" ? "softDelete"
      : call.commandName === "pricingPriceRestoreForRemovalWorkflow" ? "restore" : undefined;
    if (!operation || call.mode !== "write" || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const ids = yield* Effect.fromResult(decodePriceListPriceRemovalIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const result = yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const evidence = new Map<string, Map<string, JsonObject>>(), observed = new Map<string, JsonObject>();
    const key = (table: string, id: string) => JSON.stringify([table, id]);
    const record = Effect.fn("PricingPriceRemoval.observeRow")(function* (table: string, value: JsonObject, overwrite = false) {
      const family = byTable.get(table);
      if (!family) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(family.decodeRow(projectNativeRow(value)))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (typeof row.id !== "string" || table === contracts.tables.price.name && !ids.includes(row.id))
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
      [...evidence.get(contracts.tables.price.name)?.entries() ?? []].map(([id, row]) => ({ ...row, id }));
    const roots = orderNativeIdRows(allRoots.filter(row => operation === "restore" || row.deleted_at === null), {});
    const selected = new Map<string, Set<string>>([[contracts.tables.price.name, new Set(roots.map(row => row.id))]]);
    const ordered = new Map<string, string[]>([[contracts.tables.price.name, roots.map(row => row.id)]]);
    const reads: JsonObject[] = [];
    if (ids.length) reads.push({ table: contracts.tables.price.name,
      query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: ids }), total: allRoots.length, returned: allRoots.length });
    const ruleIds = new Set<string>(), ruleOrder: string[] = [];
    for (const root of roots) {
      const rules = orderNativeIdRows([...evidence.get(contracts.tables.rule.name)?.entries() ?? []]
        .filter(([, row]) => row.price_id === root.id).map(([id, row]) => ({ ...row, id })), {});
      reads.push({ table: contracts.tables.rule.name,
        query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "price_id", values: [root.id] }),
        total: rules.length, returned: rules.length });
      for (const rule of rules) { ruleIds.add(rule.id); ruleOrder.push(rule.id); }
    }
    selected.set(contracts.tables.rule.name, ruleIds); ordered.set(contracts.tables.rule.name, ruleOrder);
    if ([...evidence.get(contracts.tables.rule.name)?.keys() ?? []].some(id => !ruleIds.has(id)) || !jsonEqual(activity.relationalReads, reads))
      return yield* Effect.fail(mismatch());
    const expectedLifecycle = contracts.families.flatMap(family => (ordered.get(family.table.name) ?? []).map(id => ({ table: family.table.name, id })));
    const actualLifecycle: Array<Readonly<{ table: string; id: string }>> = [];
    for (const transition of activity.lifecycle) {
      if (typeof transition.key.id !== "string") return yield* Effect.fail(mismatch());
      actualLifecycle.push({ table: transition.table, id: transition.key.id });
    }
    if (!jsonEqual(actualLifecycle, expectedLifecycle)) return yield* Effect.fail(mismatch());
    yield* Effect.fromResult(correlateLifecycleGraphReceipt({ entities: contracts.families, rootTable: contracts.tables.price.name,
      operation, activity, evidence, selected, result }));
    if (operation === "restore") {
      if (call.events.length) return yield* Effect.fail(mismatch());
      return;
    }
    const expected = expectedLifecycle.map(item => ({ ...item,
      action: evidence.get(item.table)?.get(item.id)?.deleted_at === null ? "deleted" : "updated" }));
    if (call.events.length !== expected.length) return yield* Effect.fail(mismatch());
    for (const [index, event] of call.events.entries()) {
      const message = yield* capture(event), item = expected[index];
      if (typeof message.data.id !== "string" || !item || item.table !== message.metadata.object ||
        item.id !== message.data.id || item.action !== message.metadata.action)
        return yield* Effect.fail(mismatch());
    }
  }, Effect.mapError((cause: ReturnType<typeof commerceError>) => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall };
}
