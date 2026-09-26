import { describe, expect, it } from "vitest";
import { selectCalculatedPriceRows, type PricingSelectionRows } from "@medusajs/pricing/calculation";

const now = new Date("2026-09-26T10:00:00.000Z");
const price = (id: string, amount: string, list: string | null = null, rules = 0): PricingSelectionRows["prices"][number] => ({
  id, price_set_id: "set", currency_code: "usd", amount, raw_amount: null,
  min_quantity: null, max_quantity: null, price_list_id: list,
  price_list_type: null, rules_count: rules, deleted_at: null,
});
const list = (id: string, type: string, starts: string | null = null, ends: string | null = null): PricingSelectionRows["lists"][number] => ({
  id, type, status: "active", starts_at: starts, ends_at: ends, deleted_at: null, rules_count: 0,
});

describe("pinned Pricing row selection over complete indexed candidates", () => {
  it("keeps exact amount order and quantity edges while ignoring other currencies and sets", () => {
    const rows: PricingSelectionRows = { prices: [
      { ...price("high", "9007199254740993.000000000000000001"), min_quantity: "2", max_quantity: "4" },
      { ...price("low", "9007199254740993.000000000000000000"), min_quantity: "2", max_quantity: "4" },
      { ...price("wrong-currency", "1"), currency_code: "eur" },
      { ...price("wrong-set", "1"), price_set_id: "other" },
    ], lists: [], priceRules: [], listRules: [] };
    expect(selectCalculatedPriceRows(["set"], "usd", 2, {}, now, rows).map(row => row.id)).toEqual(["low", "high"]);
    expect(selectCalculatedPriceRows(["set"], "usd", 5, {}, now, rows)).toEqual([]);
    expect(selectCalculatedPriceRows(["set"], "usd", undefined, {}, now, rows)).toEqual([]);
  });

  it("selects active list specificity and rule matches without treating future lists as active", () => {
    const rows: PricingSelectionRows = { prices: [
      price("base", "100"), price("sale", "90", "sale-list", 1),
      price("future", "1", "future-list"), price("override", "80", "override-list"),
    ], lists: [
      list("sale-list", "sale"), list("future-list", "sale", "2026-09-27T00:00:00.000Z"),
      list("override-list", "override", null, "2026-09-25T00:00:00.000Z"),
    ], priceRules: [
      { price_id: "sale", attribute: "region_id", operator: "eq", value: "region", deleted_at: null },
    ], listRules: [] };
    expect(selectCalculatedPriceRows(["set"], "usd", undefined, { region_id: "region" }, now, rows)
      .map(row => [row.id, row.price_list_type])).toEqual([
        ["sale", "sale"], ["base", null],
      ]);
    expect(selectCalculatedPriceRows(["set"], "usd", undefined, { region_id: "elsewhere" }, now, rows)
      .map(row => row.id)).not.toContain("sale");
  });

  it("matches numeric price rules and JSON list rules under their native counts", () => {
    const rows: PricingSelectionRows = { prices: [price("base", "100"), price("sale", "70", "sale-list", 1)],
      lists: [{ ...list("sale-list", "sale"), rules_count: 1 }],
      priceRules: [{ price_id: "sale", attribute: "customer_score", operator: "gte", value: "10", deleted_at: null }],
      listRules: [{ price_list_id: "sale-list", attribute: "region_id", value: ["region"], deleted_at: null }],
    };
    expect(selectCalculatedPriceRows(["set"], "usd", 1, { customer_score: 10, region_id: "region" }, now, rows)
      .map(row => row.id)).toEqual(["sale", "base"]);
    expect(selectCalculatedPriceRows(["set"], "usd", 1, { customer_score: 9, region_id: "region" }, now, rows)
      .map(row => row.id)).toEqual(["base"]);
    expect(selectCalculatedPriceRows(["set"], "usd", 1, { customer_score: 10, region_id: "elsewhere" }, now, rows)
      .map(row => row.id)).toEqual(["base"]);
  });

  it("uses pinned text equality for numeric rules and ignores empty context values", () => {
    const rows: PricingSelectionRows = { prices: [price("base", "100"), price("number", "90", null, 1)],
      lists: [], priceRules: [{ price_id: "number", attribute: "tier", operator: "eq",
        value: "01", deleted_at: null }], listRules: [] };
    expect(selectCalculatedPriceRows(["set"], "usd", undefined, { tier: 1 }, now, rows).map(row => row.id))
      .toEqual(["base"]);
    expect(selectCalculatedPriceRows(["set"], "usd", undefined, { tier: "" }, now, rows).map(row => row.id))
      .toEqual(["base"]);
  });
});
