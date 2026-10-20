import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { applyUpsertRelationResults, planUpsertManyEntries } from "@medusajs/utils/dal/upsert-planning";
import { buildPreNormalizationPriceConstraintsFromData } from "@medusajs/pricing/services";
import { normalizePrices } from "@medusajs/pricing/normalization";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { validatePriceListReadReceipt } from "./list-update-receipt";
import { decodeAddPriceListPrices, decodePriceListPriceRead, decodePriceListPriceRemovalIds,
  type PriceListPriceCreationContracts } from "./price-list-price-input";
import { planPriceListPriceWrite } from "./price-list-price-repository";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Row = JsonObject & Readonly<{ id: string }>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeIds = commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(defaultCommerceResources.queryRows)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literals(["price", "price_rule"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }), data: Schema.Struct({ id: Id }),
}), defaultCommerceResources);

function rowDecoder(contracts: PriceListPriceCreationContracts, table: string) {
  return table === "price" ? contracts.decodePriceRow : table === "price_rule" ? contracts.decodePriceRuleRow
    : table === "price_list" ? contracts.decodeListRow : table === "price_set" ? contracts.decodeSetRow : undefined;
}

const initialRows = Effect.fn("PricingLists.priceReceiptInitialRows")(function* (contracts: PriceListPriceCreationContracts, activity: Activity) {
  const rows = new Map<string, Row>();
  const decode = (table: string, value: JsonObject) => Result.gen(function* () {
    const decoder = rowDecoder(contracts, table);
    if (!decoder) return yield* Result.fail(commerceError("receiptMismatch"));
    const row = yield* decoder(projectNativeRow(value));
    if (typeof row.id !== "string") return yield* Result.fail(commerceError("receiptMismatch"));
    const identified: Row = { ...row, id: row.id }; return identified;
  });
  for (const observation of activity.observedRows) rows.set(observation.table + ":" + observation.row.id,
    yield* Effect.fromResult(decode(observation.table, observation.row)));
  for (const change of [...activity.mutations].reverse()) {
    if (change.before === null) {
      if (typeof change.after?.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      rows.delete(change.table + ":" + change.after.id);
    } else {
      const row = yield* Effect.fromResult(decode(change.table, change.before)); rows.set(change.table + ":" + row.id, row);
    }
  }
  for (const observation of activity.observedRows) {
    const row = projectNativeRow(observation.row), key = observation.table + ":" + row.id;
    if (!jsonEqual(rows.get(key) ?? null, row) && !activity.mutations.some(change => change.table === observation.table &&
      (change.before !== null && jsonEqual(projectNativeRow(change.before), row) ||
        change.after !== null && jsonEqual(projectNativeRow(change.after), row))))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  }
  return rows;
});

const validateRemoval = Effect.fn("PricingLists.validatePriceRemoval")(function* (
  contracts: PriceListPriceCreationContracts, call: Call, activity: Activity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  const ids = yield* Effect.fromResult(decodePriceListPriceRemovalIds(call.input));
  if (call.result !== null) return yield* Effect.fail(mismatch());
  if (ids.length === 0) {
    if (activity.observedRows.length || activity.mutations.length || activity.relationalReads.length || call.events.length)
      return yield* Effect.fail(mismatch());
    return;
  }
  const rows = yield* initialRows(contracts, activity), roots: string[] = [], children: Row[] = [];
  for (const [key, row] of rows) {
    if (key.startsWith("price:")) { if (!ids.includes(row.id)) return yield* Effect.fail(mismatch()); }
    else if (key.startsWith("price_rule:")) {
      if (typeof row.price_id !== "string" || !ids.includes(row.price_id)) return yield* Effect.fail(mismatch()); children.push(row);
    } else return yield* Effect.fail(mismatch());
  }
  const pending = new Set(rows.keys()), deletedChildren: string[] = [];
  let parentsStarted = false;
  for (const [ordinal, change] of activity.mutations.entries()) {
    const before = change.before;
    if (change.ordinal !== ordinal || change.operation !== "delete" || change.after !== null || typeof before?.id !== "string" ||
      !pending.delete(change.table + ":" + before.id) || !jsonEqual(projectNativeRow(before), rows.get(change.table + ":" + before.id)!))
      return yield* Effect.fail(mismatch());
    if (change.table === "price") { parentsStarted = true; roots.push(before.id); }
    else if (change.table !== "price_rule" || parentsStarted) return yield* Effect.fail(mismatch());
    else deletedChildren.push(before.id);
  }
  const rootRows = [...rows].filter(([key]) => key.startsWith("price:")).map(([, row]) => row);
  if (pending.size || !jsonEqual(deletedChildren, orderNativeIdRows(children, {}).map(row => row.id)) ||
    !jsonEqual(activity.relationalReads, [{ table: "price_rule",
    query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "price_id", values: [...ids] }),
    total: children.length, returned: children.length }, { table: "price",
    query: commerceRelationReadQuery(defaultCommerceResources, { kind: "in", column: "id", values: [...new Set(ids)] },
      { kind: "storageInsertion", direction: "asc" }), total: rootRows.length, returned: rootRows.length,
    orderedIdentities: roots.map(id => ({ id })) }])) return yield* Effect.fail(mismatch());
  if (call.events.length !== roots.length) return yield* Effect.fail(mismatch());
  for (const [index, event] of call.events.entries()) {
    const message = yield* decodeEvent(event);
    if (message.metadata.object !== "price" || message.metadata.action !== "deleted" || message.data.id !== roots[index])
      return yield* Effect.fail(mismatch());
  }
});

const validateAddition = Effect.fn("PricingLists.validatePriceAddition")(function* (
  contracts: PriceListPriceCreationContracts, call: Call, activity: Activity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  const input = yield* Effect.fromResult(decodeAddPriceListPrices(call.input)), output = yield* Effect.fromResult(contracts.decodeOutput(call.result));
  const initial = yield* initialRows(contracts, activity), consumedReads = new Set<number>();
  const consumeRead = Effect.fn(function* (table: string, query: JsonObject, expected?: readonly Row[], unique = true,
    source: ReadonlyMap<string, Row> = initial) {
    const matching = activity.relationalReads.map((read, index) => ({ read, index })).filter(({ read, index }) =>
      !consumedReads.has(index) && read.table === table && jsonEqual(read.query, query));
    if (matching.length === 0 || unique && matching.length !== 1) {
      const available = activity.relationalReads.map((read, index) => ({ read, index })).filter(({ read, index }) =>
        !consumedReads.has(index) && read.table === table);
      return yield* Effect.fail(commerceError("receiptMismatch", { phase: "price-read-correlation", table, wanted: query, unique,
        matching: matching.map(value => value.index), remaining: available.slice(0, 16).map(({ read, index }) => ({ index,
          query: read.query, total: read.total, returned: read.returned, orderedIdentities: read.orderedIdentities ?? null })),
        omitted: Math.max(0, available.length - 16) }));
    }
    const selected = matching[0]; if (!selected) return yield* Effect.fail(mismatch());
    consumedReads.add(selected.index);
    if (selected.read.total !== selected.read.returned) return yield* Effect.fail(mismatch());
    if (expected !== undefined && selected.read.returned !== expected.length) return yield* Effect.fail(mismatch());
    if (selected.read.orderedIdentities !== undefined) {
      const ids = yield* Effect.fromResult(decodeIds(selected.read.orderedIdentities));
      if (ids.length !== selected.read.returned || new Set(ids.map(row => row.id)).size !== ids.length ||
        expected !== undefined && !jsonEqual(ids, expected.map(row => ({ id: row.id })))) return yield* Effect.fail(mismatch());
      if (expected !== undefined) return [...expected];
      const rows: Row[] = [];
      for (const { id } of ids) { const row = source.get(table + ":" + id); if (!row) return yield* Effect.fail(mismatch()); rows.push(row); }
      return rows;
    }
    return [...expected ?? []];
  });
  const listIds = input.map(row => row.price_list_id), setIds = [...new Set(input.flatMap(row => row.prices.map(price => price.price_set_id)))];
  const listPlan = yield* Effect.fromResult(contracts.listReadContracts.compileReadPlan({ filters: { id: listIds }, config: {} }));
  const lists = orderNativeIdRows([...initial].filter(([key, row]) => key.startsWith("price_list:") && listIds.includes(row.id) && row.deleted_at === null)
    .map(([, row]) => row), {});
  yield* consumeRead("price_list", listPlan.rootQuery, lists);
  const nativeWhere: unknown = yield* Effect.try({ try: () => Reflect.apply(buildPreNormalizationPriceConstraintsFromData, undefined,
    [input.flatMap(row => row.prices), listIds]), catch: cause => commerceError("receiptMismatch", cause) });
  const nativeQuery: unknown = yield* Effect.try({ try: () => Reflect.apply(buildQuery, undefined,
    [nativeWhere, { relations: ["price_rules"], order: { id: "ASC" } }]), catch: cause => commerceError("receiptMismatch", cause) });
  const plan = yield* Effect.fromResult(contracts.compileNativeCandidatePlan(nativeQuery));
  const sets = orderNativeIdRows([...initial].filter(([key, row]) => key.startsWith("price_set:") && setIds.includes(row.id) && row.deleted_at === null)
    .map(([, row]) => row), {});
  yield* consumeRead("price_set", plan.setQuery, sets);
  const candidates = yield* consumeRead("price", plan.rootQuery({ kind: "in", column: "price_set_id", values: sets.map(row => row.id) }));
  const candidateIds = new Set(candidates.map(row => row.id));
  const ruleQuery = plan.ruleQuery([...candidateIds]), rules = orderNativeIdRows([...initial].filter(([key, row]) =>
    key.startsWith("price_rule:") && typeof row.price_id === "string" && candidateIds.has(row.price_id) && row.deleted_at === null).map(([, row]) => row), {});
  if (ruleQuery !== undefined) yield* consumeRead("price_rule", ruleQuery, rules);
  const graph = assembleCommerceRelations("price", new Map([["price", candidates], ["price_rule", rules]]), ["price_rules"], contracts.relations);
  const candidateDTOs = yield* projectExactNumericColumns(graph, contracts.tables.price.columns.filter(column => column.type === "bigNumber"));
  const normalized: unknown[] = [];
  for (const entry of input) {
    const values: unknown = yield* Effect.try({ try: () => Reflect.apply(normalizePrices, undefined,
      [structuredClone(entry.prices), structuredClone(candidateDTOs), entry.price_list_id]), catch: cause => commerceError("receiptMismatch", cause) });
    if (!Array.isArray(values)) return yield* Effect.fail(mismatch()); normalized.push(...values);
  }
  const createdRules = activity.mutations.filter(change => change.table === "price_rule" && change.operation === "insert");
  let generatedRule = 0;
  const staged = yield* planPriceListPriceWrite(contracts, normalized, { relations: ["price_rules"] }, defaultCommerceResources,
    (supplied, index) => {
      const id = output[index]?.id;
      return id === undefined || supplied !== undefined && supplied !== id || supplied === undefined && initial.has("price:" + id)
        ? Result.fail(mismatch()) : Result.succeed(id);
    }, supplied => {
      if (supplied !== undefined) return Result.succeed(supplied);
      const id = createdRules[generatedRule++]?.after?.id;
      return typeof id === "string" && !initial.has("price_rule:" + id) ? Result.succeed(id) : Result.fail(mismatch());
    });
  if (normalized.length !== output.length || generatedRule !== createdRules.length) return yield* Effect.fail(mismatch());
  const wantedRoots = new Map(staged.unique.map(row => [row.id, row])), wantedRules = new Map<string, JsonObject>();
  for (const children of staged.relationRows.values()) for (const row of children) {
    if (typeof row.id !== "string" || wantedRules.has(row.id)) return yield* Effect.fail(mismatch()); wantedRules.set(row.id, row);
  }
  const deleted: Row[] = [], inserted = new Map<string, string[]>(), patched = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const [ordinal, change] of activity.mutations.entries()) {
    const decoder = change.table === "price" ? contracts.decodePriceRow : change.table === "price_rule" ? contracts.decodePriceRuleRow : undefined;
    if (!decoder || change.ordinal !== ordinal) return yield* Effect.fail(mismatch());
    const raw = change.operation === "delete" ? change.before : change.after;
    if (raw === null) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(decoder(projectNativeRow(raw))), key = change.table + ":" + row.id;
    if (seen.has(key)) return yield* Effect.fail(mismatch()); seen.add(key);
    if (change.operation === "delete") {
      if (change.table !== "price_rule" || change.after !== null || typeof row.price_id !== "string" ||
        !staged.relationRows.has(row.price_id) || wantedRules.has(row.id) || !jsonEqual(initial.get(key) ?? null, row)) return yield* Effect.fail(mismatch());
      deleted.push(row); continue;
    }
    const expected = change.table === "price" ? wantedRoots.get(row.id) : wantedRules.get(row.id);
    if (!expected || row.deleted_at !== null) return yield* Effect.fail(mismatch());
    for (const [field, value] of Object.entries(expected)) if (field !== "price_rules" && (row[field] === undefined || !jsonEqual(row[field], value)))
      return yield* Effect.fail(commerceError("receiptMismatch", { phase: "price-scalar-correlation", table: change.table,
        id: row.id, field, expected: value, actual: row[field] ?? null, absent: row[field] === undefined }));
    const before = initial.get(key);
    if (change.operation === "insert") {
      if (before || change.before !== null || typeof row.created_at !== "string" || row.created_at !== row.updated_at) return yield* Effect.fail(mismatch());
      const group = inserted.get(change.table) ?? []; group.push(row.id); inserted.set(change.table, group);
    } else if (change.operation === "patch") {
      if (!before || before.deleted_at !== null || change.before === null || !jsonEqual(projectNativeRow(change.before), before) ||
        row.created_at !== before.created_at || row.updated_at !== before.updated_at ||
        !jsonEqual(change.before._id ?? null, change.after?._id ?? null) || !jsonEqual(change.before._creationTime ?? null, change.after?._creationTime ?? null))
        return yield* Effect.fail(mismatch());
      for (const [field, value] of Object.entries(before)) if (expected[field] === undefined && (row[field] === undefined || !jsonEqual(row[field], value)))
        return yield* Effect.fail(mismatch());
      const group = patched.get(change.table) ?? []; group.push(row.id); patched.set(change.table, group);
    } else return yield* Effect.fail(mismatch());
  }
  for (const [id] of wantedRoots) if (!seen.has("price:" + id)) return yield* Effect.fail(mismatch());
  for (const [id] of wantedRules) if (!seen.has("price_rule:" + id)) return yield* Effect.fail(mismatch());
  for (const [key, row] of initial) if (key.startsWith("price_rule:") && typeof row.price_id === "string" &&
    staged.relationRows.has(row.price_id) && !wantedRules.has(row.id) && !seen.has(key)) return yield* Effect.fail(mismatch());
  const graphQuery = (column: string, values: readonly string[], intrinsic = false) => commerceRelationReadQuery(defaultCommerceResources,
    { kind: "in", column, values: [...values] }, intrinsic ? { kind: "storageInsertion", direction: "asc" } : "id");
  const loadedReferences = new Set<string>(), plannedDeletes: Row[] = [];
  for (const root of staged.unique) {
    const prior = initial.get("price:" + root.id);
    yield* consumeRead("price", graphQuery("id", [root.id]), prior ? [prior] : [], false);
    for (const [table, column] of [["price_set", "price_set_id"], ["price_list", "price_list_id"]] as const) {
      const id = root[column]; if (typeof id !== "string") return yield* Effect.fail(mismatch());
      const key = table + ":" + id;
      if (loadedReferences.has(key)) continue;
      const row = initial.get(key); if (!row) return yield* Effect.fail(mismatch());
      yield* consumeRead(table, graphQuery("id", [id]), [row], false); loadedReferences.add(key);
    }
    const children = staged.relationRows.get(root.id);
    if (children === undefined) continue;
    const previous = yield* consumeRead("price_rule", graphQuery("price_id", [root.id], true), undefined, false);
    if (previous.some(row => row.price_id !== root.id)) return yield* Effect.fail(mismatch());
    for (const row of previous) if (!wantedRules.has(row.id)) plannedDeletes.push(row);
    for (const child of children) {
      if (typeof child.id !== "string") return yield* Effect.fail(mismatch());
      if (previous.some(row => row.id === child.id)) continue;
      yield* consumeRead("price_rule", graphQuery("id", [child.id], true), [], false);
    }
  }
  if (plannedDeletes.length !== deleted.length || plannedDeletes.some(row => !deleted.some(value => value.id === row.id)))
    return yield* Effect.fail(mismatch());
  if (plannedDeletes.length) {
    const ordered = yield* consumeRead("price_rule", graphQuery("id", plannedDeletes.map(row => row.id), true), undefined, false);
    if (!jsonEqual(ordered.map(row => row.id), deleted.map(row => row.id))) return yield* Effect.fail(mismatch());
  }
  const final = new Map(initial);
  for (const change of activity.mutations) {
    const row = change.after ?? change.before; if (typeof row?.id !== "string") return yield* Effect.fail(mismatch());
    const key = change.table + ":" + row.id;
    if (change.after === null) final.delete(key); else final.set(key, { ...projectNativeRow(change.after), id: row.id });
  }
  const nativeWrites = planUpsertManyEntries(staged.unique, new Map([...initial].filter(([key]) => key.startsWith("price:"))
    .map(([, row]) => [row.id, row])));
  const rootInserts = nativeWrites.toInsert.map(row => row.id), rootUpdates = nativeWrites.toUpdate.map(row => row.id);
  if (staged.unique.length) {
    // Shared graph application appends actual created roots before updated
    // roots. Its final relation refresh uses that cache order, independently
    // of the native DTO's preserved raw positions and the Rule storage order.
    const selected = yield* consumeRead("price_rule", graphQuery("price_id", [...rootInserts, ...rootUpdates], true), undefined, false, final);
    const complete = [...final].filter(([key, row]) => key.startsWith("price_rule:") && typeof row.price_id === "string" && wantedRoots.has(row.price_id));
    if (selected.length !== complete.length || complete.some(([, row]) => !selected.some(value => value.id === row.id))) return yield* Effect.fail(mismatch());
  }
  if (consumedReads.size !== activity.relationalReads.length) return yield* Effect.fail(mismatch());
  const ruleInserts = [...wantedRules.keys()].filter(id => !initial.has("price_rule:" + id)), ruleUpdates = [...wantedRules.keys()].filter(id => initial.has("price_rule:" + id));
  if (!jsonEqual(inserted.get("price") ?? [], rootInserts) || !jsonEqual(patched.get("price") ?? [], rootUpdates) ||
    !jsonEqual(inserted.get("price_rule") ?? [], ruleInserts) || !jsonEqual(patched.get("price_rule") ?? [], ruleUpdates)) return yield* Effect.fail(mismatch());
  const expectedMutations = [...deleted.map(row => "price_rule:delete:" + row.id), ...rootInserts.map(id => "price:insert:" + id),
    ...ruleInserts.map(id => "price_rule:insert:" + id), ...rootUpdates.map(id => "price:patch:" + id), ...ruleUpdates.map(id => "price_rule:patch:" + id)];
  if (!jsonEqual(expectedMutations, activity.mutations.map(change => change.table + ":" + change.operation + ":" + (change.after?.id ?? change.before?.id))))
    return yield* Effect.fail(mismatch());
  applyUpsertRelationResults(staged.batch.reconstructedResponse, "price_rules", staged.relationResults);
  const expectedOutput = yield* projectExactNumericColumns(yield* Effect.fromResult(captureCommerceInput(staged.batch.reconstructedResponse)), staged.numeric, "reserialize");
  if (!jsonEqual(output, expectedOutput)) return yield* Effect.fail(mismatch());
  const expectedEvents = [
    ...["price", "price_rule"].flatMap(table => (inserted.get(table) ?? []).map(id => table + ":created:" + id)),
    ...["price", "price_rule"].flatMap(table => (patched.get(table) ?? []).map(id => table + ":updated:" + id)),
    ...deleted.map(row => "price_rule:deleted:" + row.id),
  ];
  if (call.events.length !== expectedEvents.length) return yield* Effect.fail(mismatch());
  for (const [index, event] of call.events.entries()) {
    const message = yield* decodeEvent(event);
    if (message.metadata.object + ":" + message.metadata.action + ":" + message.data.id !== expectedEvents[index]) return yield* Effect.fail(mismatch());
  }
});

export function pricingListPriceCreationPolicy(contracts: PriceListPriceCreationContracts) {
  const capture = Effect.fn("PricingLists.capturePriceEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingLists.validatePriceCreationCall")(function* (call, activity) {
    if (call.commandName === "pricingPriceListPriceRead") {
      yield* Effect.fromResult(decodePriceListPriceRead(call.input));
      return yield* validatePriceListReadReceipt(contracts.listReadContracts, call, activity, "pricingPriceListPriceRead");
    }
    if (call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.commandName === "pricingRemovePriceListPrices") return yield* validateRemoval(contracts, call, activity);
    if (call.commandName === "pricingAddPriceListPrices") return yield* validateAddition(contracts, call, activity);
    return yield* Effect.fail(commerceError("receiptMismatch"));
  }, Effect.mapError((cause: ReturnType<typeof commerceError>) => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
