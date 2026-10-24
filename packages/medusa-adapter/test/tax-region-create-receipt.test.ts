import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { TaxModuleService, prepareTaxRegionInputForCreate, normalizeTaxRegionCodes } from "@medusajs/tax/services";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { compileTaxRegionCreationContracts } from "../src/modules/tax/region-create-input";
import { prepareTaxRegionParentRepository } from "../src/modules/tax/region-create-query";
import { taxRegionCreationPolicy } from "../src/modules/tax/region-create-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileTaxRegionCreationContracts>>;
let policy: ReturnType<typeof taxRegionCreationPolicy>;
const managed = { created_at: "2026-10-24T00:00:00.000Z", updated_at: "2026-10-24T00:00:00.000Z", deleted_at: null };
const region = { id: "txreg170-receipt", country_code: "mm", province_code: null, parent_id: null, provider_id: null,
  metadata: null, created_by: "creator", ...managed };
const rate = { id: "txr170-receipt", tax_region_id: region.id, name: "standard", code: "standard", rate: 0.10000000149011612,
  is_default: true, is_combinable: false, metadata: null, created_by: "creator", ...managed };
const rule = { id: "txrule170-receipt", tax_rate_id: rate.id, reference: "product", reference_id: "product-one",
  metadata: { retained: true }, created_by: "creator", ...managed };
const presented = (row: JsonObject): JsonObject => {
  const { parent_id: _parent, provider_id: _provider, ...scalar } = row;
  return { ...scalar, children: [], tax_rates: [] };
};
const event = (object: "tax_region" | "tax_rate" | "tax_rate_rule", id: string, action: "created" | "deleted" = "created"): JsonObject => ({
  name: "tax." + object.replaceAll("_", "-") + "." + action, metadata: { source: "tax", object, action }, data: { id },
});
beforeAll(async () => {
  contracts = Result.getOrThrow(compileTaxRegionCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
  policy = taxRegionCreationPolicy(contracts);
});
function transcript(): { call: Call; activity: Activity } {
  return { call: { commandName: "taxRegionCreateForWorkflow", mode: "write", input: [{ id: region.id, country_code: "MM", created_by: "creator",
    default_tax_rate: { id: rate.id, name: "standard", code: "standard", rate: 0.1, is_default: false, created_by: "overwritten", tax_region_id: "ignored",
      rules: [{ id: rule.id, reference: "product", reference_id: "product-one", metadata: { retained: true }, created_by: "ignored" }] } }],
    result: [presented(region)], events: [event("tax_region", region.id), event("tax_rate", rate.id), event("tax_rate_rule", rule.id)],
    fromAttempt: 0, toAttempt: 3, fromLifecycle: 0, toLifecycle: 0 },
  activity: { mutations: [{ ordinal: 0, table: "tax_region", operation: "insert", before: null, after: region },
    { ordinal: 1, table: "tax_rate", operation: "insert", before: null, after: rate, realNormalization: { rate: 0.1 } },
    { ordinal: 2, table: "tax_rate_rule", operation: "insert", before: null, after: rule }], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [],
    observedRows: [{ table: "tax_region", row: region }, { table: "tax_rate", row: rate }, { table: "tax_rate_rule", row: rule }] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native Region preparation extraction", () => {
  it("retains lowercasing without trimming and explicit undefined creator overwrite", () => {
    expect(normalizeTaxRegionCodes(" MM ")).toBe(" mm ");
    const prepared = prepareTaxRegionInputForCreate([{ country_code: "MM", province_code: "YY", default_tax_rate: { name: "standard", code: "A" } }]);
    expect(prepared.regionData).toEqual([{ country_code: "mm", province_code: "yy" }]);
    const nested = prepared.defaultRates[0]; if (nested === undefined || nested === null) throw new Error("Missing native default Rate");
    expect(Object.hasOwn(nested, "created_by")).toBe(true); expect(nested.created_by).toBeUndefined(); expect(nested.is_default).toBe(true);
  });
  it("preserves the native private instance normalizer callback", () => {
    const method: unknown = Reflect.get(TaxModuleService.prototype, "prepareTaxRegionInputForCreate");
    if (typeof method !== "function") throw new Error("Missing native private normalization method");
    expect(Reflect.apply(method, { normalizeRegionCodes: (code: string) => "instance:" + code }, [[{ country_code: "MM", province_code: "YY" }]]))
      .toEqual({ regionData: [{ country_code: "instance:MM", province_code: "instance:YY" }], defaultRates: [null] });
  });
});

describe("native Tax Region creation receipts", () => {
  it("binds canonical native normalization, nested creators, REAL evidence, output and grouped events", async () => {
    const { call, activity } = transcript(); await Effect.runPromise(policy.validateLogicalCall(call, activity));
    expect(policy.allowStorageInsertionOrder).toBe(true); expect(policy.allowReferenceCheckpoints).toBe(true);
    expect(policy.insertValidation).toBe("entityBatch");
  });
  it("accepts the complete four-Region, four-Rate and eight-Rule forward bound", async () => {
    const fixture = transcript(), roots: JsonObject[] = [], rates: JsonObject[] = [], rules: JsonObject[] = [], input: JsonObject[] = [];
    for (let index = 0; index < 4; index++) {
      const rootId = region.id + index, rateId = rate.id + index;
      roots.push({ ...region, id: rootId, country_code: "c" + index });
      rates.push({ ...rate, id: rateId, tax_region_id: rootId });
      const nested: JsonObject[] = [];
      for (let child = 0; child < 2; child++) {
        const id = rule.id + index + child, referenceId = "product-" + index + child;
        rules.push({ ...rule, id, tax_rate_id: rateId, reference_id: referenceId });
        nested.push({ id, reference: "product", reference_id: referenceId, metadata: { retained: true } });
      }
      input.push({ id: rootId, country_code: "C" + index, created_by: "creator", default_tax_rate: { id: rateId,
        name: "standard", code: "standard", rate: 0.1, rules: nested } });
    }
    const mutations: Activity["mutations"][number][] = [
      ...roots.map((row, ordinal) => ({ ordinal, table: "tax_region", operation: "insert" as const, before: null, after: row })),
      ...rates.map((row, index) => ({ ordinal: roots.length + index, table: "tax_rate", operation: "insert" as const,
        before: null, after: row, realNormalization: { rate: 0.1 } })),
      ...rules.map((row, index) => ({ ordinal: roots.length + rates.length + index, table: "tax_rate_rule", operation: "insert" as const, before: null, after: row })),
    ];
    const events = mutations.map(mutation => {
      const id = mutation.after?.id; if (typeof id !== "string") throw new Error("Missing fixed maximum identity");
      return event(mutation.table === "tax_region" ? "tax_region" : mutation.table === "tax_rate" ? "tax_rate" : "tax_rate_rule", id);
    });
    const call: Call = { ...fixture.call, input, result: roots.map(presented), events, toAttempt: mutations.length };
    const activity: Activity = { ...fixture.activity, mutations, observedRows: mutations.map(mutation => {
      if (mutation.after === null) throw new Error("Missing fixed maximum row"); return { table: mutation.table, row: mutation.after };
    }) };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    const firstInput = input[0]; if (firstInput === undefined) throw new Error("Missing maximum input");
    await refused({ ...call, input: [...input, firstInput] }, activity);
    await refused(call, { ...activity, mutations: mutations.slice(0, -1) });
  });
  it("accepts the genuine empty forward and retained inverse", async () => {
    const { call, activity } = transcript(), empty = { ...activity, mutations: [], observedRows: [] };
    await Effect.runPromise(policy.validateLogicalCall({ ...call, input: [], result: [], events: [], toAttempt: 0 }, empty));
    await Effect.runPromise(policy.validateLogicalCall({ ...call, commandName: "taxRegionPhysicalDeleteForWorkflow", input: [], result: null, events: [], toAttempt: 0 }, empty));
  });
  it("preserves canonical explicit Region/Rate/Rule aliases and positional nested inputs", async () => {
    const { call, activity } = transcript();
    const canonicalRegion = { ...region, metadata: { filled: true } }, canonicalRate = { ...rate, metadata: { filled: true }, is_combinable: true };
    const aliased: Call = { ...call, input: [
      { id: region.id, country_code: "MM", created_by: null, metadata: null, default_tax_rate: { id: rate.id, name: "standard", code: "standard", rate: 0.1,
        metadata: null, rules: [{ id: rule.id, reference: "product", reference_id: "product-one", metadata: null }] } },
      { id: region.id, country_code: "ignored", created_by: "creator", metadata: { filled: true }, default_tax_rate: { id: rate.id, name: "ignored", code: "ignored",
        rate: 7, metadata: { filled: true }, is_combinable: true, rules: [{ id: rule.id, reference: "ignored", reference_id: "ignored", metadata: { retained: true } }] } },
    ], result: [presented(canonicalRegion), presented(canonicalRegion)] };
    const canonical: Activity = { ...activity, mutations: activity.mutations.map(mutation => mutation.table === "tax_region"
      ? { ...mutation, after: canonicalRegion } : mutation.table === "tax_rate" ? { ...mutation, after: canonicalRate } : mutation),
      observedRows: activity.observedRows.map(observation => observation.table === "tax_region" ? { ...observation, row: canonicalRegion }
        : observation.table === "tax_rate" ? { ...observation, row: canonicalRate } : observation) };
    await Effect.runPromise(policy.validateLogicalCall(aliased, canonical));
    await refused({ ...aliased, result: [presented(canonicalRegion), presented(region)] }, canonical);
    await refused(aliased, { ...canonical, mutations: canonical.mutations.slice(0, 2) });
  });
  it("removes overwritten nested creators when the root creator is absent", async () => {
    const { call, activity } = transcript();
    const changed: Call = { ...call, input: [{ id: region.id, country_code: "MM", default_tax_rate: { id: rate.id, name: "standard", code: "standard", rate: 0.1,
      created_by: "must-disappear", rules: [{ id: rule.id, reference: "product", reference_id: "product-one", metadata: { retained: true }, created_by: "must-disappear" }] } }],
      result: [presented({ ...region, created_by: null })] };
    const canonical: Activity = { ...activity, mutations: activity.mutations.map(mutation => ({ ...mutation, after: mutation.after === null ? null : { ...mutation.after, created_by: null } })),
      observedRows: activity.observedRows.map(observation => ({ ...observation, row: { ...observation.row, created_by: null } })) };
    await Effect.runPromise(policy.validateLogicalCall(changed, canonical));
    await refused(changed, activity);
  });
  it("authenticates exact active parent lookup and disabled historical Provider checkpoint observations", async () => {
    const { call, activity } = transcript();
    const provider = { id: "tp170-provider", is_enabled: false, ...managed, deleted_at: "2026-01-01T00:00:00.000Z" };
    const supplied: Call = { ...call, input: [{ id: region.id, country_code: "MM", provider_id: provider.id }],
      result: [{ ...presented({ ...region, created_by: null }), provider_id: provider.id }], events: [event("tax_region", region.id)], toAttempt: 1 };
    const created = { ...region, provider_id: provider.id, created_by: null };
    const supporting: Activity = { ...activity, mutations: [{ ordinal: 0, table: "tax_region", operation: "insert", before: null, after: created }],
      observedRows: [{ table: "tax_region", row: created }, { table: "tax_provider", row: provider }] };
    await Effect.runPromise(policy.validateLogicalCall(supplied, supporting));
    await refused(supplied, { ...supporting, observedRows: supporting.observedRows.slice(0, 1) });
    await refused(supplied, { ...supporting, observedRows: [...supporting.observedRows, { table: "tax_provider", row: { ...provider, is_enabled: true } }] });
    const parent = { ...region, id: "txreg170-parent", country_code: "mm", province_code: "ancestor", created_by: null };
    const child = { ...region, parent_id: parent.id, province_code: "yy", created_by: null };
    const query = Result.getOrThrow(Result.getOrThrow(prepareTaxRegionParentRepository(contracts.region)).parentQueryForIds([parent.id]));
    const childCall: Call = { ...supplied, input: [{ id: region.id, country_code: "MM", province_code: "YY", parent_id: parent.id }],
      result: [{ ...presented(child), parent_id: parent.id }] };
    const childActivity: Activity = { ...supporting, mutations: [{ ordinal: 0, table: "tax_region", operation: "insert", before: null, after: child }],
      observedRows: [{ table: "tax_region", row: parent }, { table: "tax_region", row: child }], relationalReads: [{ table: "tax_region",
        query: commerceRelationReadQuery(defaultCommerceResources, query.query.predicate), total: 1, returned: 1 }] };
    await Effect.runPromise(policy.validateLogicalCall(childCall, childActivity));
    await refused(childCall, { ...childActivity, relationalReads: [] });
    await refused(childCall, { ...childActivity, observedRows: [{ table: "tax_region", row: { ...parent, deleted_at: managed.created_at } }, { table: "tax_region", row: child }] });
    await refused(childCall, { ...childActivity, observedRows: [{ table: "tax_region", row: { ...parent, country_code: "us" } }, { table: "tax_region", row: child }] });
  });
  it("refuses unrelated, corrupt or incomplete observations and forged read recipes", async () => {
    const { call, activity } = transcript();
    for (const observedRows of [activity.observedRows.slice(1), [...activity.observedRows, { table: "tax_provider", row: { id: "foreign" } }],
      [...activity.observedRows, { table: "tax_region", row: region }].map((observation, index) => index === 3 ? { ...observation, row: { ...region, country_code: "us" } } : observation)])
      await refused(call, { ...activity, observedRows });
    await refused(call, { ...activity, relationalReads: [{ table: "tax_region", query: {}, total: 0, returned: 0 }] });
  });
  it("refuses extra, reordered, partial and uncorrelated mutations, conversions and output", async () => {
    const { call, activity } = transcript();
    const first = activity.mutations[0]; if (first === undefined) throw new Error("Missing fixed Region mutation");
    await refused(call, { ...activity, mutations: [...activity.mutations].reverse() });
    await refused(call, { ...activity, mutations: [{ ...first, realNormalization: { rate: 0.1 } }, ...activity.mutations.slice(1)] });
    await refused(call, { ...activity, mutations: [{ ...first, after: { id: region.id } }, ...activity.mutations.slice(1)] });
    await refused({ ...call, result: [{ ...presented(region), tax_rates: [rate] }] }, activity);
    await refused({ ...call, result: [{ ...presented(region), provider_id: null }] }, activity);
    await refused({ ...call, result: [{ ...presented(region), created_by: "foreign" }] }, activity);
    await refused({ ...call, input: [{ country_code: 7 }] }, activity);
  });
  it("authenticates the complete physical inverse with storage-ordered explicit roots and root-only events", async () => {
    const { call, activity } = transcript();
    const selection = (table: string, predicate: JsonObject, count: number) => ({ table,
      query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
    const inverse: Call = { ...call, commandName: "taxRegionPhysicalDeleteForWorkflow", input: [region.id], result: null,
      events: [event("tax_region", region.id, "deleted")] };
    const removed: Activity = { ...activity, mutations: [
      { ordinal: 0, table: "tax_rate_rule", operation: "delete", before: rule, after: null },
      { ordinal: 1, table: "tax_rate", operation: "delete", before: rate, after: null },
      { ordinal: 2, table: "tax_region", operation: "delete", before: region, after: null }],
      relationalReads: [{ table: "tax_region", query: commerceRelationReadQuery(defaultCommerceResources,
        { kind: "in", column: "id", values: [region.id] }, { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true }),
        total: 1, returned: 1, orderedIdentities: [{ id: region.id }] },
        selection("tax_rate", { kind: "in", column: "tax_region_id", values: [region.id] }, 1),
        selection("tax_rate_rule", { kind: "in", column: "tax_rate_id", values: [rate.id] }, 1),
        selection("tax_region", { kind: "in", column: "parent_id", values: [region.id] }, 0)] };
    await Effect.runPromise(policy.validateLogicalCall(inverse, removed));
    await refused({ ...inverse, events: [...inverse.events, event("tax_rate", rate.id, "deleted")] }, removed);
    await refused(inverse, { ...removed, mutations: removed.mutations.slice(1) });
  });
  it("refuses wrong commands, call bounds and changed event order or action", async () => {
    const { call, activity } = transcript();
    await refused({ ...call, commandName: "taxOtherCreate" }, activity);
    await refused({ ...call, mode: "read" }, activity); await refused({ ...call, toAttempt: 4 }, activity);
    await refused({ ...call, events: [...call.events].reverse() }, activity);
    await refused({ ...call, events: [event("tax_region", region.id, "deleted"), ...call.events.slice(1)] }, activity);
    await refused({ ...call, events: [...call.events, event("tax_region", "foreign")] }, activity);
  });
});
