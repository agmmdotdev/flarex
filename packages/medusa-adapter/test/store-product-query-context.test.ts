import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { QueryContext } from "@medusajs/utils/modules-sdk/query-context";
import { normalizeStoreProductQueryContext } from "../src/http/store-product-request";
import { runProductRequestPromise } from "../src/http/product-request";

describe("native Store Product QueryContext admission", () => {
  it("gives native HTTP postprocessing mutable detached DTOs without mutating Core values", async () => {
    const row = Object.freeze({ id: "prod_one", categories: Object.freeze([
      Object.freeze({ id: "pcat_public", is_internal: false }), Object.freeze({ id: "pcat_internal", is_internal: true }),
    ]) });
    const original = Object.freeze({ data: Object.freeze([row]) });
    const dto = await runProductRequestPromise(Effect.succeed(original));
    const result = dto.data[0];
    expect(result).toBeDefined();
    if (result === undefined) throw new Error("Missing native Product result");
    expect(Reflect.set(result, "categories", result.categories.filter(category => !category.is_internal))).toBe(true);
    expect(result.categories).toEqual([{ id: "pcat_public", is_internal: false }]);
    expect(row.categories.map(category => category.id)).toEqual(["pcat_public", "pcat_internal"]);
    expect(Object.isFrozen(row)).toBe(true);
  });

  it("strips the actual native producer's structural tag at the selected alias", () => {
    const pricing = { region_id: "reg_us", currency_code: "usd", customer: { groups: [{ id: "cg_member" }] } };
    expect(Result.getOrThrow(normalizeStoreProductQueryContext({ variants: { calculated_price: QueryContext(pricing) } })))
      .toEqual({ "variants.calculated_price": pricing });
  });

  it("keeps native empty context as an empty graph plan", () => {
    expect(Result.getOrThrow(normalizeStoreProductQueryContext({}))).toEqual({});
  });

  it.each([
    { variants: { calculated_price: { currency_code: "usd" } } },
    { variants: { calculated_price: { __type: "Wrong", currency_code: "usd" } } },
    { variants: { prices: QueryContext({ currency_code: "usd" }) } },
    { product: QueryContext({ currency_code: "usd" }) },
    { variants: { calculated_price: QueryContext({ currency_code: "usd", arbitrary: true }) } },
    { variants: { calculated_price: QueryContext({ customer: { groups: Array.from({ length: 17 }, (_, index) => ({ id: `cg_${index}` })) } }) } },
  ])("refuses unsupported context before graph execution: %j", context => {
    expect(Result.isFailure(normalizeStoreProductQueryContext(context))).toBe(true);
  });
});
