import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileProductRequestCatalog } from "../src/http/product-request";
import { prepareProductRequestReadGraph } from "../src/http/product-request-reads";
import { preparePricingRepository } from "../src/modules/pricing/repository";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { captureCommerceInput } from "../src/value/input";

let prepared: Result.Result.Success<ReturnType<typeof preparePricingRepository>>;
let native: Effect.Success<ReturnType<typeof prepareProductRequestReadGraph>>;
const fields = ["id", "variants.id", "variants.sku", "variants.price_set.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"];
beforeAll(async () => {
  const catalog = await Effect.runPromise(compileProductRequestCatalog({
    scopeUuid: "b0000000-0000-4000-8000-000000000011", epochUuid: "b0000000-0000-4000-8000-000000000012",
  }));
  native = await Effect.runPromise(prepareProductRequestReadGraph(catalog));
  prepared = Result.getOrThrow(preparePricingRepository((await Effect.runPromise(capturePricingMetadata())).frame));
});

it("compiles the actual native Product Variant stored-Price expansion in the ordinary Pricing owner", async () => {
  const query = prepared.query;
  if (query === undefined) throw new Error("Missing ordinary Pricing read planner");
  const calls: unknown[] = [], plans: Result.Result.Success<ReturnType<typeof query>>[] = [];
  await Effect.runPromise(native.graph.bind({ refuse: Effect.fail, recordFailure: cause => Result.succeed(cause),
    call: (participant, command, args) => Effect.gen(function* () {
      const model = native.members.find(member => member.participant === participant)?.module.reads.find(read => read.command === command)?.model;
      if (model === "PriceSet") {
        calls.push(args);
        if (!isJsonObject(args) || args.filters === undefined || args.config === undefined || !isJsonObject(args.filters) || !isJsonObject(args.config))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const dal = yield* Effect.fromResult(captureCommerceInput(buildQuery(args.filters, args.config)));
        plans.push(yield* Effect.fromResult(query(dal)));
        return [[], 0] satisfies Json;
      }
      const rows = model === "Product" ? [{ id: "product", variants: [{ id: "variant", sku: "sku" }] }]
        : model === "LinkProductVariantPriceSet" ? [{ variant_id: "variant", price_set_id: "set" }]
        : model === "LinkProductVariantInventoryItem" ? [] : undefined;
      if (rows === undefined) return yield* Effect.die(new Error("Unexpected genuine Product expansion read: " + model));
      return [rows, rows.length] satisfies Json;
    }),
  }).nativeGraph({ entity: "product", fields, filters: { id: "product" } }));
  expect(calls).toEqual([{ filters: { id: ["set"] }, config: {
    select: ["prices_id", "id"], relations: ["prices"], take: 256, skip: 0,
  } }]);
  expect(plans).toHaveLength(1);
  expect(plans[0]?.query.fields).not.toContain("prices_id");
  expect(plans[0]?.projection.node.fields.has("prices_id")).toBe(false);
  expect(plans[0]?.projection.node.children.find(child => child.name === "prices")?.node.fields.has("amount")).toBe(true);
});

it("keeps native absent scalar admission separate from relations, unsafe names and public field authority", () => {
  const query = prepared.query;
  if (query === undefined) throw new Error("Missing ordinary Pricing read planner");
  const plan = (select: string[]) => captureCommerceInput(buildQuery({ id: ["set"] }, {
    select, relations: ["prices", "prices.price_rules"], take: 256, skip: 0,
  })).pipe(Result.flatMap(query));
  const selected = Result.getOrThrow(plan(["id", "prices_id", "prices.id", "prices.price_rules_id", "prices.price_rules.attribute"]));
  expect(selected.projection.node.fields.has("prices_id")).toBe(false);
  expect(selected.query.fields).not.toContain("prices_id");
  expect(selected.projection.node.children.find(child => child.name === "prices")?.node.fields.has("price_rules_id")).toBe(false);
  for (const field of ["*", "prices", "prices.price_rules", "__proto__", "constructor", "prototype", "prices.constructor", "prices..id", "prices.unknown.id"])
    expect(Result.isFailure(plan(["id", field])), field).toBe(true);
  for (const field of ["variants.price_set.prices_id", "variants.price_set.prices.price_rules_id", "variants.price_set.unknown", "variants.price_set.prices.unknown"])
    expect(Result.isFailure(native.graph.admitProjection("product", ["id", field])), field).toBe(true);
});
