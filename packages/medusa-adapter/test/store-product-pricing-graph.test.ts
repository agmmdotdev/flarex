import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { ProductVariantPriceSet } from "@medusajs/link-modules";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { nativeLinkGraphPaths } from "../src/local-graph/links";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import type { GraphParticipant, GraphReadContext } from "../src/local-graph/model";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { decodeStorePriceSetRead } from "../src/modules/pricing/input";
import { decodeStorePriceSetCount } from "../src/modules/pricing/store-read";
import { prepareVariantItemPricingContext } from "../src/modules/pricing/calculation";
import { workflowModuleDefinition } from "../src/workflow/module";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/support/effectTestRuntime";
import { promiseFailureObserver } from "./support/promise-failure-observer";

const participant = defineAtomicCommerceParticipant("store-price-graph");
const variant = defineGraphReadCommand("storePriceVariants", () => Effect.succeed([[], 0]));
const link = defineGraphReadCommand("storePriceLinks", () => Effect.succeed([[], 0]));
const bound = { maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1 };
let pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
beforeAll(async () => { pricing = await runEffect(makeLocalPricingCommands("store-product-read")); });
const nested = { id: "p", price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null };
const calculated = { id: "s", is_calculated_price_price_list: false, is_calculated_price_tax_inclusive: false,
  calculated_amount: 10, raw_calculated_amount: { value: "10", precision: 20 }, is_original_price_price_list: false,
  is_original_price_tax_inclusive: false, original_amount: 10, raw_original_amount: { value: "10", precision: 20 },
  currency_code: "usd", calculated_price: nested, original_price: nested };
function graph() {
  const paths = Result.getOrThrow(nativeLinkGraphPaths(ProductVariantPriceSet,
    ["price_set", "prices", "calculated_price"].map(path => ({ root: "ProductVariant", path, ...bound }))));
  const reads = (model: string, command: typeof variant, columns: readonly string[], primaryKeys: readonly string[]) => ({ model, command,
    table: { name: model.toLowerCase(), columns, primaryKeys, foreignKeys: [], companions: {} }, paths: [],
    orderable: [primaryKeys[0]!], uniqueOrder: primaryKeys.length === 1 ? primaryKeys : [], multipleOrder: false, decode: decodeGraphCount });
  const participants: GraphParticipant[] = [
    { participant, module: { aliases: [{ name: "variant", model: "ProductVariant" }], reads: [reads("ProductVariant", variant, ["id"], ["id"])] } },
    { participant, module: { aliases: [{ name: "price_link", model: "LinkProductVariantPriceSet" }],
      reads: [reads("LinkProductVariantPriceSet", link, ["id", "variant_id", "price_set_id"], ["variant_id", "price_set_id"])], remotePaths: paths } },
    { participant, module: pricing.graph },
  ];
  return Result.getOrThrow(prepareLocalGraph(participants));
}
function context(responses: readonly Json[], calls: Array<{ command: unknown; args: Json }> = []): GraphReadContext {
  let index = 0;
  return { refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command, args) => {
    calls.push({ command, args });
    const response = responses[index++];
    return response === undefined ? Effect.fail(commerceError("storedCorruption")) : Effect.succeed(response);
  } };
}
const request = (fields = ["id", "price_set.id", "prices.amount", "calculated_price.calculated_amount"], context = {}) =>
  ({ entity: "variant", fields, context, pagination: { take: 4 } });
const responses = (dto: Json = calculated): Json[] => [[[{ id: "v" }], 1], [[{ variant_id: "v", price_set_id: "s" }], 1],
  [[{ id: "s", prices: [{ id: "p", price_set_id: "s", amount: 10, raw_amount: { value: "10", precision: 20 } }], calculated_price: dto }], 1]];

describe("Store Product native PriceSet expansion", () => {
  it("captures bounded computed metadata through the workflow owner and admits no writes", () => {
    expect(pricing.commands).toEqual([pricing.count, pricing.calculate]);
    expect(workflowModuleDefinition(pricing.workflow)?.graph.reads[0]?.computedObjects).toEqual(pricing.graph.reads[0]?.computedObjects);
    expect(pricing.graph.reads[0]?.table.columns).not.toContain("calculated_price");
    expect(pricing.graph.reads[0]?.orderable).toEqual(["id"]);
  });

  it("retains native alias suffixes and forwarding paths from the pinned Link", () => {
    const paths = Result.getOrThrow(nativeLinkGraphPaths(ProductVariantPriceSet,
      ["price_set", "prices", "calculated_price"].map(path => ({ root: "ProductVariant", path, ...bound }))));
    expect(paths.map(path => ({ canonical: path.canonicalPath, suffix: path.targetSuffix, forwarding: path.forwardArgumentsOnPath })))
      .toEqual([{ canonical: "price_set", suffix: undefined, forwarding: undefined },
        { canonical: "price_set", suffix: "prices", forwarding: ["price_set_link.price_set"] },
        { canonical: "price_set", suffix: "calculated_price", forwarding: ["price_set_link.price_set"] }]);
  });

  it("merges all three aliases and context before exactly one genuine PriceSet call", async () => {
    const calls: Array<{ command: unknown; args: Json }> = [];
    const pricingContext = { currency_code: "usd", region_id: "r", customer: { groups: [{ id: "g" }] } };
    const result = await runEffect(graph().bind(context(responses(), calls)).graph(request(undefined, { calculated_price: pricingContext })));
    expect(result.data).toEqual([{ id: "v", price_set: { id: "s" }, prices: [{ amount: 10, raw_amount: { value: "10", precision: 20 } }], calculated_price: { calculated_amount: 10 } }]);
    expect(calls.map(call => call.command)).toEqual([variant, link, pricing.count]);
    expect(calls[2]?.args).toMatchObject({ filters: { id: ["s"], context: pricingContext }, config: { relations: ["prices", "calculated_price"] } });
    expect(calls[2]?.args).not.toHaveProperty("config.select.calculated_price");
    expect(Result.getOrThrow(prepareVariantItemPricingContext(pricingContext, "store-product-read")))
      .toEqual({ currency_code: "usd", region_id: "r", "customer.groups.id": ["g"] });
  });

  it("retains calculated null while omitting a missing Link and skips endpoint reads for no rows", async () => {
    expect((await runEffect(graph().bind(context(responses(null))).graph(request(["calculated_price.calculated_amount"])))).data)
      .toEqual([{ calculated_price: null }]);
    const calls: Array<{ command: unknown; args: Json }> = [];
    expect((await runEffect(graph().bind(context([[[{ id: "v" }], 1], [[], 0]], calls)).graph(request(["calculated_price.calculated_amount"])))).data).toEqual([{}]);
    expect(calls.map(call => call.command)).toEqual([variant, link]);
    const empty: Array<{ command: unknown; args: Json }> = [];
    expect((await runEffect(graph().bind(context([[[], 0]], empty)).graph(request()))).data).toEqual([]);
    expect(empty.map(call => call.command)).toEqual([variant]);
  });

  it("refuses unsupported contexts and conflicting aliases before the first read", async () => {
    for (const supplied of [{ unknown: {} },
      { calculated_price: { currency_code: "usd" }, prices: { currency_code: "eur" } }]) {
      const calls: Array<{ command: unknown; args: Json }> = [];
      expect(await runEffectFailure(graph().bind(context([], calls)).graph(request(undefined, supplied)))).toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toEqual([]);
    }
    for (const extra of [{ unknown: true }, { customer: { groups: Array.from({ length: 17 }, () => ({ id: "g" })) } }])
      expect(Result.isFailure(decodeStorePriceSetRead({ filters: { context: extra } }))).toBe(true);
  });

  it("forwards canonical alias context only when a selected native alias declares the same target", async () => {
    const refused: Array<{ command: unknown; args: Json }> = [];
    expect(await runEffectFailure(graph().bind(context([], refused)).graph(request(["price_set.id"], { price_set: { currency_code: "usd" } }))))
      .toMatchObject({ reason: "unsupportedProfile" });
    expect(refused).toEqual([]);
    const calls: Array<{ command: unknown; args: Json }> = [];
    await runEffect(graph().bind(context(responses(), calls)).graph(request(["price_set.id", "calculated_price.calculated_amount"],
      { price_set: { currency_code: "usd" } })));
    expect(calls.map(call => call.command)).toEqual([variant, link, pricing.count]);
    expect(calls[2]?.args).toMatchObject({ filters: { id: ["s"], context: { currency_code: "usd" } } });
  });

  it("normalizes omitted and empty contexts and refuses computed ordering or unknown DTO fields before reading", async () => {
    for (const supplied of [undefined, {}, { calculated_price: {} }, { price_set: {} }]) {
      const calls: Array<{ command: unknown; args: Json }> = [];
      const input = supplied === undefined ? { entity: "variant", fields: request().fields, pagination: { take: 4 } } : request(undefined, supplied);
      await runEffect(graph().bind(context(responses(), calls)).graph(input));
      expect(calls[2]?.args).toMatchObject({ filters: { id: ["s"] } });
      expect(calls[2]?.args).not.toHaveProperty("filters.context");
    }
    for (const input of [{ ...request(), pagination: { take: 4, order: { calculated_amount: "ASC" } } },
      request(["calculated_price.unknown"]), request(["calculated_price.calculated_price.secret"])]) {
      const calls: Array<{ command: unknown; args: Json }> = [];
      expect(await runEffectFailure(graph().bind(context([], calls)).graph(input))).toMatchObject({ reason: "unsupportedProfile" });
      expect(calls).toEqual([]);
    }
  });

  it("validates every complete DTO field before a partial graph projection", async () => {
    for (const key of Object.keys(calculated)) {
      const partial = Object.fromEntries(Object.entries(calculated).filter(([name]) => name !== key));
      expect(Result.isFailure(decodeStorePriceSetCount([[{ id: "s", calculated_price: partial }], 1], true))).toBe(true);
    }
    expect(Result.isFailure(decodeStorePriceSetCount([[{ id: "s", calculated_price: { ...calculated, id: "wrong" } }], 1], true))).toBe(true);
    expect(Result.isFailure(decodeStorePriceSetCount([[{ id: "s" }], 1], true))).toBe(true);
    expect(await runEffectFailure(graph().bind(context(responses({ calculated_amount: 10 }))).graph(request(["calculated_price.calculated_amount"]))))
      .toMatchObject({ reason: "storedCorruption" });
  });
});
