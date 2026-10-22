import { Effect, Option, Result, Schema } from "effect";
import { formatSystemTaxLines } from "@medusajs/tax/providers/system";
import { selectTaxRatesForItems } from "@medusajs/tax/services";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { assembleCommerceRelations, commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../../query/relations";
import type { Predicate } from "../../query/predicate";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { decodeTaxLinesCommandInput, decodeTaxLinesOutput, TaxableLine } from "./input";
import { taxLinesLimits } from "./query";
import type { prepareTaxLinesRepository } from "./repository";

type Prepared = Result.Result.Success<ReturnType<typeof prepareTaxLinesRepository>>;
type Row = Result.Result.Success<ReturnType<Prepared["contracts"]["decodeRegion"]>>;
const decodeSelection = commerceDecoder(Schema.Array(Schema.Struct({ item: TaxableLine,
  rates: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)) })).check(Schema.isMaxLength(taxLinesLimits.items + taxLinesLimits.shipping)), "receiptMismatch");

/** Authenticate call-local complete cohorts and the exact admitted SQL recipes.
 * Exact native pure selection and formatting compute the full expected output
 * from authenticated complete cohorts, without repeating provider invocations. */
export function taxLinesReadPolicy(prepared: Prepared) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Tax.validateReadCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    if (call.commandName !== "taxGetItemTaxLines" || call.mode !== "read" || call.events.length || activity.mutations.length ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeTaxLinesCommandInput(call.input)), output = yield* Effect.fromResult(decodeTaxLinesOutput(call.result));
    const regions = new Map<string, Row>(), rates = new Map<string, Row>(), rules = new Map<string, Row>();
    for (const observation of activity.observedRows) {
      const table = observation.table;
      const decode = table === prepared.region.name ? prepared.contracts.decodeRegion : table === prepared.rate.name ? prepared.contracts.decodeRate
        : table === prepared.rule.name ? prepared.contracts.decodeRule : undefined;
      if (decode === undefined) return yield* Effect.fail(mismatch());
      const row = yield* Effect.fromResult(decode(projectNativeRow(observation.row))), cohort = table === prepared.region.name ? regions : table === prepared.rate.name ? rates : rules,
        prior = cohort.get(row.id);
      if (prior !== undefined && !jsonEqual(prior, row)) return yield* Effect.fail(mismatch());
      cohort.set(row.id, row);
    }
    // This is the native lookup scalar projection, not a Tax matching algorithm.
    // The original calculation context remains untouched for provider delivery.
    const country = input.context.address.country_code.toLowerCase(), province = input.context.address.province_code
      ? input.context.address.province_code.toLowerCase() : null;
    const regionQuery = yield* Effect.fromResult(captureCommerceInput(buildQuery({ $or: [
      { country_code: country, province_code: null }, { country_code: country, province_code: province },
    ] }, { order: { id: "ASC" } })).pipe(Result.flatMap(prepared.queryRegion)));
    // Observations include complete bodies used by shared read support before
    // residual selection. A valid deleted/unselected support row is not an
    // active Tax candidate. Every raw body was decoded above; apply active
    // cohort admission only after reconstructing the exact query selection.
    const selectedRegions = orderNativeIdRows([...regions.values()].filter(row => row.deleted_at === null && row.country_code === country &&
      (row.province_code === null || row.province_code === province)), {});
    yield* Effect.fromResult(prepared.admission(prepared.region.name, selectedRegions));
    const reads: JsonObject[] = [];
    const record = (table: string, predicate: Json, count: number) => reads.push({ table,
      query: commerceRelationReadQuery(defaultCommerceResources, predicate), total: count, returned: count });
    record(prepared.region.name, prepared.regionPlan(regionQuery).query.predicate, selectedRegions.length);
    if (!selectedRegions.some(row => row.province_code === null)) {
      if (rates.size || rules.size || output.length || !jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
      return;
    }
    const regionIds = selectedRegions.map(row => row.id), regionalRates = orderNativeIdRows([...rates.values()].filter(row => row.deleted_at === null &&
      typeof row.tax_region_id === "string" && regionIds.includes(row.tax_region_id)), {}), rateIds = regionalRates.map(row => row.id),
      completeRules = orderNativeIdRows([...rules.values()].filter(row => row.deleted_at === null && typeof row.tax_rate_id === "string" && rateIds.includes(row.tax_rate_id)), {});
    yield* Effect.fromResult(prepared.admission(prepared.rate.name, regionalRates));
    yield* Effect.fromResult(prepared.admission(prepared.rule.name, completeRules));
    record(prepared.rate.name, prepared.regionalRatePredicate(regionIds), regionalRates.length);
    const ruleCohort = prepared.ruleCohortPredicate(rateIds);
    record(prepared.rule.name, ruleCohort, completeRules.length);
    // Preserve the native Set insertion order and omitted undefined selectors.
    // Pinned MikroORM connection settings explicitly ignore undefined in queries.
    const products = new Set<string | null | undefined>(), types = new Set<string>(), shipping = new Set<string | null | undefined>();
    for (const item of input.items) {
      if ("shipping_option_id" in item) shipping.add(item.shipping_option_id);
      else { products.add(item.product_id); if (item.product_type_id) types.add(item.product_type_id); }
    }
    const branches = [...[...products].map(reference_id => ({ reference: "product", reference_id })),
      ...[...types].map(reference_id => ({ reference: "product_type", reference_id })),
      ...[...shipping].map(reference_id => ({ reference: "shipping_option", reference_id }))];
    const parsedRateQuery = yield* Effect.fromResult(captureCommerceInput(buildQuery({ $and: [{ tax_region_id: regionIds },
      { $or: [{ is_default: true }, ...(branches.length ? [{ rules: { $or: branches } }] : [])] }] },
    { relations: ["tax_region", "rules"], order: { id: "ASC" } })).pipe(Result.flatMap(prepared.queryRate)));
    const matchedRules = completeRules.filter(row => branches.some(branch => row.reference === branch.reference &&
      (branch.reference_id === undefined || row.reference_id === branch.reference_id)));
    let matches: Predicate | undefined;
    if (parsedRateQuery.rulePredicate !== undefined) {
      record(prepared.rule.name, { kind: "and", children: [ruleCohort, parsedRateQuery.rulePredicate] }, matchedRules.length);
      const keys: string[] = [];
      for (const row of matchedRules) {
        if (typeof row.tax_rate_id !== "string") return yield* Effect.fail(mismatch());
        if (!keys.includes(row.tax_rate_id)) keys.push(row.tax_rate_id);
      }
      matches = { kind: "in", column: "id", values: keys };
    }
    const candidateIds = new Set(matchedRules.map(row => row.tax_rate_id));
    const candidates = regionalRates.filter(row => row.is_default === true || candidateIds.has(row.id));
    const plan = prepared.candidatePlan(regionIds, matches);
    record(prepared.rate.name, plan.query.predicate, candidates.length);
    for (const [table, columns, parentColumns, members] of [
      [prepared.region.name, ["id"], ["tax_region_id"], selectedRegions],
      [prepared.rule.name, ["tax_rate_id"], ["id"], completeRules],
    ] as const) {
      const population = yield* Effect.fromResult(prepareCommerceRelationPopulation(columns, candidates, parentColumns, true, false));
      if (Option.isSome(population)) {
        const column = columns[0], selected = members.filter(row => {
          const value = row[column];
          return typeof value === "string" && population.value.values.includes(value);
        });
        record(table, population.value.predicate, selected.length);
      }
    }
    if (!jsonEqual(reads, activity.relationalReads)) return yield* Effect.fail(mismatch());
    const populated = assembleCommerceRelations(prepared.rate.name, new Map([
      [prepared.rate.name, candidates], [prepared.region.name, selectedRegions], [prepared.rule.name, completeRules],
    ]), ["tax_region", "rules"], prepared.relations);
    // Native authoring aliases omit nullable custom-line IDs and DML Rate
    // values. Decode the exact pure helper output at this foreign type seam.
    const selected: unknown = Reflect.apply(selectTaxRatesForItems, undefined, [[...input.items], populated, regionIds]);
    const selection = yield* Effect.fromResult(decodeSelection(selected));
    const itemLines = selection.filter(entry => !("shipping_option_id" in entry.item)).map(entry => ({ line_item: entry.item, rates: [...entry.rates] }));
    const shippingLines = selection.filter(entry => "shipping_option_id" in entry.item).map(entry => ({ shipping_line: entry.item, rates: [...entry.rates] }));
    // Native DTO aliases omit nullable DML Rate values. The exact extracted
    // native pure formatter owns their null-to-zero and field semantics. It
    // does not invoke the provider a second time or acquire any capability.
    const formatted: unknown = Reflect.apply(formatSystemTaxLines, undefined, [itemLines, shippingLines, () => "system"]);
    const expected = yield* Effect.fromResult(captureCommerceInput(formatted).pipe(Result.flatMap(decodeTaxLinesOutput)));
    if (!jsonEqual(output, expected) || output.length > input.items.length * 2) return yield* Effect.fail(mismatch());
  }, Effect.mapError(cause => cause.reason === "receiptMismatch" ? cause : commerceError("receiptMismatch", cause)));
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
