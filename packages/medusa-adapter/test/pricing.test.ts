import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PricingModuleService } from "@medusajs/pricing/services";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { logicalPricingTestHost } from "./support/logical-pricing-test-host";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalPricingTestHost>>;
beforeAll(async () => {
  fixture = await logicalPricingTestHost(close => cleanup.push(close));
});
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

describe("native Pricing selected PriceSet admission", () => {
  it("composes the full six-model Pricing source", () => {
    expect(fixture.pricing.definition.schema.tables.map(table => table.identity.tableId).sort())
      .toEqual(["price", "price_list", "price_list_rule", "price_preference", "price_rule", "price_set"]);
  });
  it("creates scalar, array and empty inputs with exact pairs and native nested events", async () => {
    const beforeEvents = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
      .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
    const result = await runEffect(fixture.create({ id: "exact", prices: [
      { id: "exact-price", title: "Exact", currency_code: "USD", amount: "123.4567890123456789", min_quantity: null, rules: { region_id: "region" } },
      { currency_code: "usd", amount: 500, min_quantity: 2, max_quantity: 4 },
    ] }));
    expect(result).toMatchObject({ id: "exact", prices: expect.arrayContaining([
      expect.objectContaining({ id: "exact-price", currency_code: "USD", raw_amount: { value: "123.45678901234567890", precision: 20 }, min_quantity: null, raw_min_quantity: null,
        price_rules: [expect.objectContaining({ attribute: "region_id", value: "region", operator: "eq", priority: 0 })] }),
      expect.objectContaining({ currency_code: "usd", min_quantity: 2, max_quantity: 4 }),
    ]) });
    expect((await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
      .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal)).slice(beforeEvents.length)
      .map(event => event.envelope.contract).sort()).toEqual([
        "pricing.price-set.created", "pricing.price.created", "pricing.price.created", "pricing.price-rule.created",
      ].sort());
    expect(await runEffect(fixture.create([]))).toEqual([]);
    expect(await runEffect(fixture.create([{ id: "omitted" }, { id: "empty", prices: [] }]))).toMatchObject([{ id: "omitted", prices: [] }, { id: "empty", prices: [] }]);
    expect(await runEffect(fixture.read(fixture.pricing.runtime.list, { filters: { id: "omitted" }, config: { select: ["id"] } }))).toEqual([{ id: "omitted" }]);
  });
  it("keeps later equivalent-price normalization native and preserves root counts with projections", async () => {
    await runEffect(fixture.create({ id: "count-empty" }));
    const input = { id: "duplicate", prices: [{ amount: 100, currency_code: "USD", rules: { region_id: "1234" } }, { amount: 200, currency_code: "USD", rules: { region_id: "1234" } }] };
    const result = await runEffect(fixture.create(input));
    expect(result).toMatchObject({ id: "duplicate", prices: [expect.objectContaining({ amount: 200, rules_count: 1 })] });
    expect(await runEffect(fixture.read(fixture.pricing.runtime.count, { filters: { id: ["duplicate", "count-empty"] }, config: { select: ["id", "prices.amount"], relations: ["prices"], take: 4 } })))
      .toEqual([[{ id: "count-empty", prices: [] }, { id: "duplicate", prices: [expect.objectContaining({ amount: 200 })] }], 2]);
  });
  it("refuses managed/raw fields and unsupported capabilities without durable work", async () => {
    const before = await logicalCurrencyInventory(fixture.currency);
    for (const input of [{ deleted_at: null }, { prices: [{ amount: 1, currency_code: "USD", raw_amount: { value: "1" } }] },
      { prices: [{ amount: 1, currency_code: "USD", rules: { a: "1", b: "2" } }] }, { prices: [{ amount: "Infinity", currency_code: "USD" }] }]) {
      expect(await runEffectFailure(fixture.create(input))).toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await logicalCurrencyInventory(fixture.currency)).toEqual(before);
    }
  });
  it("makes caught custom repository calculation refusal sticky", async () => {
    const original = PricingModuleService.prototype.createPriceSets;
    let refused: unknown;
    const spy = vi.spyOn(PricingModuleService.prototype, "createPriceSets").mockImplementation(async function (this: PricingModuleService, data, context) {
      const result = await original.call(this, data, context);
      try { await this.calculatePrices({ id: [] }, {}, context); } catch (error) { refused = error; }
      return result;
    });
    const before = await logicalCurrencyInventory(fixture.currency);
    try {
      expect(await runEffectFailure(fixture.create({ id: "caught" }))).toMatchObject({ _tag: "CommerceTransactionError" });
      expect(refused).toMatchObject({ reason: "unsupportedProfile" });
      expect(await logicalCurrencyInventory(fixture.currency)).toEqual(before);
    } finally { spy.mockRestore(); }
  });
});
