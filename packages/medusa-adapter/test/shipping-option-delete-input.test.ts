import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionDeletionContracts, decodeShippingOptionDeletionArguments, decodeShippingOptionDeletionIds,
  decodeShippingOptionDeletionOutput } from "../src/modules/fulfillment/shipping-option-delete-input";
import { compileFulfillmentLifecycleGraph } from "../src/modules/fulfillment/fulfillment-graph-contracts";
import { serviceZoneDeletionGraph } from "./support/logical-service-zone-creation-fixture";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionDeletionContracts>>;
const graph = serviceZoneDeletionGraph("option-delete-input", { geos: 1, options: 1, rules: 1 });
const options = graph.rows.filter(value => value.table === "shipping_option").map(value => value.row);
const rules = graph.rows.filter(value => value.table === "shipping_option_rule").map(value => value.row);
beforeAll(async () => { contracts = Result.getOrThrow(compileShippingOptionDeletionContracts(
  (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("native Shipping Option deletion boundaries", () => {
  it("retains native raw empty duplicate missing whitespace and Unicode IDs within the four-input bound", () => {
    for (const ids of [[], ["missing", " raw ", "missing", "option-\u{10000}"]]) {
      expect(Result.getOrThrow(decodeShippingOptionDeletionIds(ids))).toEqual(ids);
      expect(Result.getOrThrow(decodeShippingOptionDeletionArguments([ids]))).toEqual([ids]);
    }
    for (const value of [null, undefined, "scalar", [""], [1], Array(5).fill("id"), ["a".repeat(257)]])
      expect(Result.isFailure(decodeShippingOptionDeletionIds(value))).toBe(true);
    for (const value of [[], [[], {}], { ids: [] }]) expect(Result.isFailure(decodeShippingOptionDeletionArguments(value))).toBe(true);
  });

  it("admits only complete Option and Rule result maps without empty or foreign model keys", () => {
    for (const value of [{}, { shipping_option_id: graph.optionIds },
      { shipping_option_id: graph.optionIds, shipping_option_rule_id: graph.ruleIds }])
      expect(Result.getOrThrow(decodeShippingOptionDeletionOutput(value))).toEqual(value);
    for (const value of [{ shipping_option_id: [] }, { shipping_option_rule_id: [] }, { shipping_option_id: Array(5).fill("id") },
      { shipping_option_rule_id: Array(17).fill("id") }, { service_zone_id: graph.ids }])
      expect(Result.isFailure(decodeShippingOptionDeletionOutput(value))).toBe(true);
    expect(Result.isSuccess(contracts.decodeLifecycleResult([options, { ShippingOption: options, ShippingOptionRule: rules }]))).toBe(true);
    for (const value of [[options, {}], [[], { ShippingOption: options }], [options, { ShippingOption: options, ShippingOptionRule: [{ id: "partial" }] }],
      [options, { ShippingOption: options, ServiceZone: [] }]]) expect(Result.isFailure(contracts.decodeLifecycleResult(value))).toBe(true);
  });

  it("selects the two-table closure while preserving existing Set and Zone profile bounds and metadata guards", async () => {
    const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
    expect(contracts.entities.map(entity => [entity.table.name, entity.maximum])).toEqual([["shipping_option", 4], ["shipping_option_rule", 16]]);
    for (const root of ["serviceZone", "fulfillmentSet"] as const)
      expect(Result.getOrThrow(compileFulfillmentLifecycleGraph(metadata, root)).entities.find(entity => entity.table.name === "shipping_option")?.maximum).toBe(8);
    expect(Result.isFailure(compileShippingOptionDeletionContracts({ ...metadata, tables: metadata.tables.map(table => table.name === "shipping_option"
      ? { ...table, cascades: { ...table.cascades, delete: [] } } : table) }))).toBe(true);
  });
});
