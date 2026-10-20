import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { GetIsoStringFromDate } from "@medusajs/utils/common/get-iso-string-from-date";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery } from "../../query/relations";
import { projectRows } from "../../query/projection";
import { commerceDecoder } from "../../value/decoder";
import { decodePriceListUpdate, decodePriceListUpdateRead, type PriceListUpdateContracts } from "./list-update-input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Row = Result.Result.Success<ReturnType<PriceListUpdateContracts["decodeListRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeIdentities = commerceDecoder(Schema.Array(Schema.Struct({ id: Id }))
  .check(Schema.isMaxLength(defaultCommerceResources.queryRows)), "receiptMismatch");
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.PRICING), object: Schema.Literals(["price_list", "price_list_rule"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, defaultCommerceResources.eventIds))]) }),
}), defaultCommerceResources);
type Capture = (input: unknown) => ReturnType<typeof decodeEvent>;

export const validatePriceListReadReceipt = Effect.fn("PricingLists.validateRead")(function* (
  contracts: PriceListUpdateContracts, call: Call, activity: Activity,
  commandName: "pricingListUpdateRead" | "pricingPriceListPriceRead" = "pricingListUpdateRead",
) {
  const mismatch = () => commerceError("receiptMismatch");
  if (call.mode !== "read" || call.commandName !== commandName || call.events.length || activity.mutations.length ||
    activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
    return yield* Effect.fail(mismatch());
  const input = yield* Effect.fromResult(decodePriceListUpdateRead(call.input));
  const plan = yield* Effect.fromResult(contracts.compileReadPlan(input));
  const rows = new Map<string, Row>();
  for (const observation of activity.observedRows) {
    const decode = observation.table === "price_list" ? contracts.decodeListRow : observation.table === "price_list_rule" ? contracts.decodeListRuleRow : undefined;
    if (!decode) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(decode(projectNativeRow(observation.row)));
    if (observation.table === "price_list" && !input.filters.id.includes(row.id)) return yield* Effect.fail(mismatch());
    const key = observation.table + ":" + row.id, prior = rows.get(key);
    if (prior && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
    rows.set(key, row);
  }
  const roots: Row[] = [], children: Row[] = [];
  const rootRead = activity.relationalReads[0];
  const rootIdentities = yield* Effect.fromResult(decodeIdentities(rootRead?.orderedIdentities));
  if (rootIdentities.length > 4 || new Set(rootIdentities.map(row => row.id)).size !== rootIdentities.length)
    return yield* Effect.fail(mismatch());
  for (const identity of rootIdentities) {
    const row = rows.get("price_list:" + identity.id);
    if (!row || row.deleted_at !== null || !input.filters.id.includes(row.id)) return yield* Effect.fail(mismatch());
    roots.push(row);
  }
  if (!jsonEqual(rootIdentities, orderNativeIdRows(roots, {}).map(row => ({ id: row.id }))) ||
    !jsonEqual(rootRead ?? null, { table: "price_list", query: plan.rootQuery, total: roots.length, returned: roots.length, orderedIdentities: rootIdentities }))
    return yield* Effect.fail(mismatch());
  const rootIds = roots.map(row => row.id), ruleQuery = plan.ruleQuery(rootIds);
  for (const [key, row] of rows) if (key.startsWith("price_list_rule:") && (ruleQuery === undefined ||
    typeof row.price_list_id !== "string" || !rootIds.includes(row.price_list_id))) return yield* Effect.fail(mismatch());
  if (ruleQuery !== undefined) {
    const childRead = activity.relationalReads[1], childIdentities = yield* Effect.fromResult(decodeIdentities(childRead?.orderedIdentities));
    if (new Set(childIdentities.map(row => row.id)).size !== childIdentities.length) return yield* Effect.fail(mismatch());
    for (const identity of childIdentities) {
      const row = rows.get("price_list_rule:" + identity.id);
      if (!row || row.deleted_at !== null || typeof row.price_list_id !== "string" || !rootIds.includes(row.price_list_id))
        return yield* Effect.fail(mismatch());
      children.push(row);
    }
    if (!jsonEqual(childRead ?? null, { table: "price_list_rule", query: ruleQuery, total: children.length, returned: children.length, orderedIdentities: childIdentities }))
      return yield* Effect.fail(mismatch());
  }
  if (activity.relationalReads.length !== (ruleQuery === undefined ? 1 : 2)) return yield* Effect.fail(mismatch());
  const graph = assembleCommerceRelations("price_list", new Map([["price_list", roots], ["price_list_rule", children]]), plan.paths, contracts.relations);
  const expected = yield* Effect.fromResult(projectRows(graph, plan.projection.node));
  const output = yield* Effect.fromResult(contracts.decodeReadOutput(call.result));
  if (!jsonEqual(expected, output)) return yield* Effect.fail(mismatch());
});

const validateWrite = Effect.fn("PricingLists.validateUpdateWrite")(function* (
  contracts: PriceListUpdateContracts, capture: Capture, call: Call, activity: Activity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  if (call.commandName !== "pricingListUpdate" || call.mode !== "write" || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
    return yield* Effect.fail(mismatch());
  const input = yield* Effect.fromResult(decodePriceListUpdate(call.input)), output = yield* Effect.fromResult(contracts.decodeUpdateOutput(call.result));
  const rootIds = input.map(row => row.id);
  if (new Set(rootIds).size !== rootIds.length || output.length !== input.length) return yield* Effect.fail(mismatch());
  const initial = new Map<string, Row>(), inserted = new Map<string, Row>(), patched = new Map<string, Row>(), removed = new Map<string, Row>();
  const decode = (table: string, value: JsonObject) => Result.gen(function* () {
    const decoder = table === "price_list" ? contracts.decodeListRow : table === "price_list_rule" ? contracts.decodeListRuleRow : undefined;
    if (!decoder) return yield* Result.fail(mismatch());
    return yield* decoder(projectNativeRow(value));
  });
  for (const observation of activity.observedRows) {
    const row = yield* Effect.fromResult(decode(observation.table, observation.row));
    if (observation.table === "price_list" ? !rootIds.includes(row.id) : typeof row.price_list_id !== "string" || !rootIds.includes(row.price_list_id))
      return yield* Effect.fail(mismatch());
    initial.set(observation.table + ":" + row.id, row);
  }
  for (const change of [...activity.mutations].reverse()) {
    const raw = change.before ?? change.after;
    if (!raw) return yield* Effect.fail(mismatch());
    const row = yield* Effect.fromResult(decode(change.table, raw)), key = change.table + ":" + row.id;
    if (change.before === null) initial.delete(key); else initial.set(key, row);
  }
  for (const [ordinal, change] of activity.mutations.entries()) {
    if (change.ordinal !== ordinal) return yield* Effect.fail(mismatch());
    if (change.table === "price_list") {
      if (change.operation !== "patch" || change.before === null || change.after === null) return yield* Effect.fail(mismatch());
      const before = yield* Effect.fromResult(decode(change.table, change.before)), after = yield* Effect.fromResult(decode(change.table, change.after));
      if (!rootIds.includes(before.id) || before.id !== after.id || before.deleted_at !== null || after.deleted_at !== null || patched.has(after.id) ||
        !jsonEqual(initial.get("price_list:" + before.id) ?? null, before) ||
        !jsonEqual(change.before._id ?? null, change.after._id ?? null) || !jsonEqual(change.before._creationTime ?? null, change.after._creationTime ?? null))
        return yield* Effect.fail(mismatch());
      patched.set(after.id, after);
    } else if (change.table === "price_list_rule") {
      const inserting = change.operation === "insert", deleting = change.operation === "delete";
      if ((!inserting && !deleting) || (inserting ? change.before !== null || change.after === null : change.after !== null || change.before === null))
        return yield* Effect.fail(mismatch());
      const raw = inserting ? change.after : change.before;
      if (raw === null) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decode(change.table, raw));
      const group = inserting ? inserted : removed;
      if (group.has(row.id) || typeof row.price_list_id !== "string" || !rootIds.includes(row.price_list_id)) return yield* Effect.fail(mismatch());
      if (inserting ? initial.has("price_list_rule:" + row.id) || row.deleted_at !== null || typeof row.created_at !== "string" || row.created_at !== row.updated_at
        : !jsonEqual(initial.get("price_list_rule:" + row.id) ?? null, row)) return yield* Effect.fail(mismatch());
      group.set(row.id, row);
    } else return yield* Effect.fail(mismatch());
  }
  if (patched.size !== input.length) return yield* Effect.fail(mismatch());
  for (const observation of activity.observedRows) {
    const value = projectNativeRow(observation.row), key = observation.table + ":" + value.id;
    if (!jsonEqual(initial.get(key) ?? null, value) && !activity.mutations.some(change => change.table === observation.table &&
      (change.before !== null && jsonEqual(projectNativeRow(change.before), value) || change.after !== null && jsonEqual(projectNativeRow(change.after), value))))
      return yield* Effect.fail(mismatch());
  }
  const reads: Activity["relationalReads"][number][] = [];
  const selectedRead = Effect.fn("PricingLists.validateUpdateSelection")(function* (table: string, query: JsonObject, expected: readonly Row[], identities: boolean) {
    const actual = activity.relationalReads[reads.length], byId = new Map(expected.map(row => [row.id, row]));
    const selected: Row[] = [];
    let expectedRead: Activity["relationalReads"][number];
    if (identities) {
      const ordered = yield* Effect.fromResult(decodeIdentities(actual?.orderedIdentities));
      if (ordered.length !== byId.size || new Set(ordered.map(row => row.id)).size !== ordered.length) return yield* Effect.fail(mismatch());
      for (const identity of ordered) {
        const row = byId.get(identity.id); if (!row) return yield* Effect.fail(mismatch()); selected.push(row);
      }
      expectedRead = { table, query, total: selected.length, returned: selected.length, orderedIdentities: ordered };
    } else { selected.push(...expected); expectedRead = { table, query, total: expected.length, returned: expected.length }; }
    if (!jsonEqual(actual ?? null, expectedRead)) return yield* Effect.fail(mismatch());
    reads.push(expectedRead);
    return selected;
  });
  const roots: Row[] = [];
  for (const id of rootIds) {
    const row = initial.get("price_list:" + id);
    if (!row || row.deleted_at !== null) return yield* Effect.fail(mismatch()); roots.push(row);
  }
  const plan = yield* Effect.fromResult(contracts.compileReadPlan({ filters: { id: rootIds }, config: {} }));
  const preimageRoots = yield* selectedRead("price_list", plan.rootQuery, roots, true);
  if (!jsonEqual(preimageRoots, orderNativeIdRows(roots, {}))) return yield* Effect.fail(mismatch());
  const existingRules = [...initial].filter(([key]) => key.startsWith("price_list_rule:")).map(([, row]) => row);
  const inQuery = (column: string, values: readonly string[], intrinsic = false) => commerceRelationReadQuery(defaultCommerceResources,
    { kind: "in", column, values: [...values] }, intrinsic ? { kind: "storageInsertion", direction: "asc" } : "id");
  const wantedDeletes: Row[] = [], wantedCreates: Row[] = [], expectedOutput: JsonObject[] = [];
  for (const [index, supplied] of input.entries()) {
    const before = roots[index], after = patched.get(supplied.id), returned = output[index];
    if (!before || !after || !returned || returned.id !== supplied.id) return yield* Effect.fail(mismatch());
    yield* selectedRead("price_list", inQuery("id", [supplied.id]), [before], false);
    const expected: Record<string, Json> = { ...before }, sparse: Record<string, Json> = { id: supplied.id };
    for (const field of ["title", "description", "status", "starts_at", "ends_at"] as const) {
      const value = supplied[field]; if (value === undefined) continue;
      const normalized: Json = (field === "starts_at" || field === "ends_at") && typeof value === "string" && value.length > 0
        ? yield* Effect.try({ try: () => GetIsoStringFromDate(value), catch: cause => commerceError("receiptMismatch", cause) }) : value;
      expected[field] = normalized; sparse[field] = normalized;
    }
    if (supplied.rules !== undefined) {
      const previous = existingRules.filter(row => row.price_list_id === supplied.id);
      wantedDeletes.push(...yield* selectedRead("price_list_rule", inQuery("price_list_id", [supplied.id], true), previous, true));
      const children = returned.price_list_rules;
      const tuples = Object.entries(supplied.rules);
      if (!children || children.length !== tuples.length) return yield* Effect.fail(mismatch());
      const sparseRules: JsonObject[] = [];
      for (const [offset, [attribute, values]] of tuples.entries()) {
        const child = children[offset], row = child && inserted.get(child.id);
        if (!row || !child || row.price_list_id !== supplied.id || row.attribute !== attribute || !jsonEqual(row.value ?? null, [...values]))
          return yield* Effect.fail(mismatch());
        yield* selectedRead("price_list_rule", inQuery("id", [row.id], true), [], true);
        const projected: JsonObject = { id: row.id, attribute, value: [...values], price_list_id: supplied.id };
        if (!jsonEqual(child, projected)) return yield* Effect.fail(mismatch());
        wantedCreates.push(row); sparseRules.push(projected);
      }
      expected.rules_count = tuples.length; sparse.rules_count = tuples.length; sparse.price_list_rules = sparseRules;
    }
    if (!jsonEqual(after, expected) || !jsonEqual(returned, sparse)) return yield* Effect.fail(mismatch());
    expectedOutput.push(sparse);
  }
  if (!jsonEqual(output, expectedOutput) || new Set(wantedCreates.map(row => row.id)).size !== inserted.size ||
    wantedCreates.length !== inserted.size || wantedDeletes.length !== removed.size || wantedDeletes.some(row => !removed.has(row.id)))
    return yield* Effect.fail(mismatch());
  const deleted = wantedDeletes.length ? yield* selectedRead("price_list_rule", inQuery("id", wantedDeletes.map(row => row.id), true), wantedDeletes, true) : [];
  const finalRules = existingRules.filter(row => !removed.has(row.id) && typeof row.price_list_id === "string" && rootIds.includes(row.price_list_id))
    .concat(wantedCreates);
  if (rootIds.length) yield* selectedRead("price_list_rule", inQuery("price_list_id", rootIds, true), finalRules, true);
  const expectedMutations = [
    ...deleted.map(row => "price_list_rule:delete:" + row.id), ...wantedCreates.map(row => "price_list_rule:insert:" + row.id),
    ...rootIds.map(id => "price_list:patch:" + id),
  ];
  if (reads.length !== activity.relationalReads.length || !jsonEqual(expectedMutations, activity.mutations.map(change =>
    change.table + ":" + change.operation + ":" + (change.after?.id ?? change.before?.id)))) return yield* Effect.fail(mismatch());
  const expectedEvents = [...wantedCreates.map(row => "price_list_rule:created:" + row.id), ...rootIds.map(id => "price_list:updated:" + id),
    ...deleted.map(row => "price_list_rule:deleted:" + row.id)];
  const actualEvents: string[] = [];
  for (const event of call.events) {
    const message = yield* capture(event);
    for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
      actualEvents.push(message.metadata.object + ":" + message.metadata.action + ":" + id);
  }
  if (!jsonEqual(expectedEvents, actualEvents)) return yield* Effect.fail(mismatch());
});

/** Native methods own normalization and sparse DTO shape; this profile binds
 * their selected roots, complete row attempts and actual events to core proof. */
export function pricingListUpdatePolicy(contracts: PriceListUpdateContracts) {
  const capture = Effect.fn("PricingLists.captureUpdateEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: message.metadata.object, action: message.metadata.action }) ||
      (message.metadata.object === "price_list" ? message.metadata.action !== "updated" : message.metadata.action === "updated"))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("PricingLists.validateUpdateCall")(function* (call: Call, activity: Activity) {
    if (call.commandName === "pricingListUpdateRead") return yield* validatePriceListReadReceipt(contracts, call, activity);
    return yield* validateWrite(contracts, capture, call, activity);
  }, Effect.mapError((cause: ReturnType<typeof commerceError>) => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture, validateLogicalCall, allowStorageInsertionOrder: true as const };
}
