import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Option, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import SystemTaxService from "@medusajs/tax/providers/system";
import { defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { captureWorkflowCommandInput } from "../src/workflow/value";
import { captureTaxMetadata } from "../src/modules/tax/schema";
import { prepareTaxLinesRepository } from "../src/modules/tax/repository";
import { taxLinesReadPolicy } from "../src/modules/tax/receipt";
import { decodeTaxLinesCommandInput } from "../src/modules/tax/input";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let prepared: Result.Result.Success<ReturnType<typeof prepareTaxLinesRepository>>;
let policy: ReturnType<typeof taxLinesReadPolicy>;
const managed = { created_at: "2026-10-22T00:00:00.000Z", updated_at: "2026-10-22T00:00:00.000Z", deleted_at: null };
const region: JsonObject = { id: "txreg-receipt", country_code: "us", province_code: null, parent_id: null, provider_id: "tp_system",
  metadata: null, created_by: null, ...managed };
const rate = (id: string, is_default: boolean, value: number): JsonObject => ({ id, tax_region_id: "txreg-receipt", rate: value,
  code: id, name: id, is_default, is_combinable: false, metadata: null, created_by: null, ...managed });
const defaultRate = rate("txr-a-default", true, 10), productRate = rate("txr-b-product", false, 20);
const rule: JsonObject = { id: "txrule-receipt", tax_rate_id: "txr-b-product", reference: "product", reference_id: "prod-one",
  metadata: null, created_by: null, ...managed };
const methodInput = { items: [{ id: "li-one", product_id: "prod-one" }, { id: "li-two", product_id: "prod-two" }],
  context: { address: { country_code: "US" } } };
const line = (rate_id: string, value: number, line_item_id: string): JsonObject => ({ rate_id, rate: value, name: rate_id,
  code: rate_id, line_item_id, provider_id: "system" });
const output = [line("txr-b-product", 20, "li-one"), line("txr-a-default", 10, "li-two")];

beforeAll(async () => {
  prepared = Result.getOrThrow(prepareTaxLinesRepository((await Effect.runPromise(captureTaxMetadata())).frame));
  policy = taxLinesReadPolicy(prepared);
});

/** A fixed complete read transcript. Native output assertions above are
 * independent of the pure selector used by the receipt. */
function transcript(): { call: Call; activity: Activity } {
  const regionQuery = Result.getOrThrow(captureCommerceInput(buildQuery({ $or: [
    { country_code: "us", province_code: null }, { country_code: "us", province_code: null },
  ] }, { order: { id: "ASC" } })).pipe(Result.flatMap(prepared.queryRegion)));
  const rateQuery = Result.getOrThrow(captureCommerceInput(buildQuery({ $and: [
    { tax_region_id: ["txreg-receipt"] }, { $or: [{ is_default: true }, { rules: { $or: [
      { reference: "product", reference_id: "prod-one" }, { reference: "product", reference_id: "prod-two" },
    ] } }] },
  ] }, { relations: ["tax_region", "rules"], order: { id: "ASC" } })).pipe(Result.flatMap(prepared.queryRate)));
  if (rateQuery.rulePredicate === undefined) throw new Error("Expected the native product rule selector");
  const read = (table: string, predicate: Json, count: number) => ({ table,
    query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
  const cohort = prepared.ruleCohortPredicate(["txr-a-default", "txr-b-product"]);
  const activity: Activity = { mutations: [], lifecycle: [], setNull: [], referenceReplacements: [],
    observedRows: [{ table: "tax_region", row: region }, { table: "tax_rate", row: defaultRate },
      { table: "tax_rate", row: productRate }, { table: "tax_rate_rule", row: rule }], relationalReads: [
      read("tax_region", prepared.regionPlan(regionQuery).query.predicate, 1),
      read("tax_rate", prepared.regionalRatePredicate(["txreg-receipt"]), 2),
      read("tax_rate_rule", cohort, 1),
      read("tax_rate_rule", { kind: "and", children: [cohort, rateQuery.rulePredicate] }, 1),
      read("tax_rate", prepared.candidatePlan(["txreg-receipt"], { kind: "in", column: "id", values: ["txr-b-product"] }).query.predicate, 2),
    ] };
  const populationReads = [];
  for (const [table, columns, parentColumns] of [["tax_region", ["id"], ["tax_region_id"]], ["tax_rate_rule", ["tax_rate_id"], ["id"]]] as const) {
    const selection = Result.getOrThrow(prepareCommerceRelationPopulation(columns, [defaultRate, productRate], parentColumns, true, false));
    if (Option.isNone(selection)) throw new Error("Expected complete candidate relation population");
    populationReads.push(read(table, selection.value.predicate, 1));
  }
  return { call: { commandName: "taxGetItemTaxLines", mode: "read", input: Result.getOrThrow(captureWorkflowCommandInput(methodInput)),
    result: output, events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 },
  activity: { ...activity, relationalReads: [...activity.relationalReads, ...populationReads] } };
}
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native Tax complete read receipts", () => {
  it("authenticates the full native output without another provider invocation", async () => {
    const { call, activity } = transcript(), provider = vi.spyOn(SystemTaxService.prototype, "getTaxLines");
    try {
      await Effect.runPromise(policy.validateLogicalCall(call, activity));
      expect(provider).not.toHaveBeenCalled();
    } finally { provider.mockRestore(); }
  });

  it("refuses omitted output, another valid candidate and reordered native lines", async () => {
    const { call, activity } = transcript();
    await refused({ ...call, result: [] }, activity);
    await refused({ ...call, result: [line("txr-a-default", 10, "li-one"), output[1] ?? null] }, activity);
    await refused({ ...call, result: [...output].reverse() }, activity);
    await refused({ ...call, result: [...output, output[0] ?? null] }, activity);
  });

  it("binds exact complete read predicates, counts and observations", async () => {
    const { call, activity } = transcript(), first = activity.relationalReads[0];
    if (first === undefined || !isJsonObject(first.query)) throw new Error("Missing fixed Region read query");
    await refused(call, { ...activity, relationalReads: activity.relationalReads.slice(1) });
    await refused(call, { ...activity, relationalReads: [{ ...first, total: 0, returned: 0 }, ...activity.relationalReads.slice(1)] });
    await refused(call, { ...activity, relationalReads: [{ ...first, query: { ...first.query, predicate: { kind: "and", children: [] } } }, ...activity.relationalReads.slice(1)] });
    await refused(call, { ...activity, observedRows: activity.observedRows.filter(row => row.table !== "tax_rate_rule") });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "tax_provider", row: { id: "tp_system" } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows, { table: "tax_rate", row: { ...productRate, rate: 99 } }] });
  });

  it("authenticates valid deleted support rows without selecting them or relaxing active admission", async () => {
    const { call, activity } = transcript(), deletedRule = { ...rule, id: "txrule-deleted-support", reference_id: "prod-two", deleted_at: managed.created_at };
    await Effect.runPromise(policy.validateLogicalCall(call, { ...activity,
      observedRows: [...activity.observedRows, { table: "tax_rate_rule", row: deletedRule }] }));
    expect(Result.isFailure(prepared.admission("tax_rate_rule", [deletedRule]))).toBe(true);
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: { ...deletedRule, reference_id: 7 } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: { ...deletedRule, extra: true } }] });
    await refused(call, { ...activity, observedRows: [...activity.observedRows,
      { table: "tax_rate_rule", row: { ...deletedRule, deleted_at: false } }] });
  });

  it("refuses writes, events and a foreign command even with otherwise valid evidence", async () => {
    const { call, activity } = transcript();
    await refused({ ...call, commandName: "taxOtherRead" }, activity);
    await refused({ ...call, events: [{ name: "tax.tax-rate.updated" }] }, activity);
    await refused(call, { ...activity, mutations: [{ ordinal: 0, table: "tax_rate", operation: "patch", before: productRate, after: productRate }] });
  });

  it("retains arbitrary own undefined metadata through the checked method transport", () => {
    const input = { ...methodInput, context: { address: { country_code: "US", metadata: { nested: { kept: undefined } } },
      customer: undefined, locale: undefined, shipping_methods: undefined } };
    const decoded = Result.getOrThrow(decodeTaxLinesCommandInput(Result.getOrThrow(captureWorkflowCommandInput(input))));
    expect(decoded).toEqual(input);
    expect(Object.hasOwn(decoded.context, "customer")).toBe(true);
    expect(Result.isFailure(decodeTaxLinesCommandInput(Result.getOrThrow(captureWorkflowCommandInput({ ...methodInput,
      context: { address: { country_code: "US" }, is_return: "false" } }))))).toBe(true);
  });
});
