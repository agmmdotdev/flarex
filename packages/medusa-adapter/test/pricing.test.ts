import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { makeLocalPricingCommands } from "../src/pricing-service";
import { prepareProductVariantPricing } from "../src/product-variant-pricing-schema";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let commands: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
const delivered: unknown[] = [];
beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => { cleanup.push(close); };
  const postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
  const resource = postgres ? await (async () => { const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) }; })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = postgres ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  commands = await runEffect(makeLocalPricingCommands());
  const prepare = (...args: Parameters<typeof prepareProductVariantPricing>) => prepareProductVariantPricing(...args).pipe(Effect.map(value => ({ ...value, profile: value.profiles.pricing })));
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, commands.commands, control,
    descriptor => commands.eventPolicy(descriptor, events => Effect.sync(() => { delivered.push(...events); })));
});
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

describe("native Pricing base-price admission", () => {
  it("creates scalar, array and empty inputs with exact pairs and native nested events", async () => {
    const result = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, { id: "exact", prices: [
      { id: "exact-price", title: "Exact", currency_code: "USD", amount: "123.4567890123456789", min_quantity: null, rules: { region_id: "region" } },
      { currency_code: "usd", amount: 500, min_quantity: 2, max_quantity: 4 },
    ] }));
    expect(result).toMatchObject({ id: "exact", prices: expect.arrayContaining([
      expect.objectContaining({ id: "exact-price", currency_code: "USD", raw_amount: { value: "123.45678901234567890", precision: 20 }, min_quantity: null, raw_min_quantity: null,
        price_rules: [expect.objectContaining({ attribute: "region_id", value: "region", operator: "eq", priority: 0 })] }),
      expect.objectContaining({ currency_code: "usd", min_quantity: 2, max_quantity: 4 }),
    ]) });
    expect(delivered).toHaveLength(4);
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, []))).toEqual([]);
    expect(await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, [{ id: "omitted" }, { id: "empty", prices: [] }]))).toMatchObject([{ id: "omitted", prices: [] }, { id: "empty", prices: [] }]);
    expect(await runEffect(fixture.host.read(commands.list, { filters: { id: "omitted" }, config: { select: ["id"] } }))).toEqual([{ id: "omitted" }]);
  });
  it("keeps later equivalent-price normalization native and preserves root counts with projections", async () => {
    await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, { id: "count-empty" }));
    const input = { id: "duplicate", prices: [{ amount: 100, currency_code: "USD", rules: { region_id: "1234" } }, { amount: 200, currency_code: "USD", rules: { region_id: "1234" } }] };
    const result = await runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, input));
    expect(result).toMatchObject({ id: "duplicate", prices: [expect.objectContaining({ amount: 200, rules_count: 1 })] });
    expect(await runEffect(fixture.host.read(commands.count, { filters: { id: ["duplicate", "count-empty"] }, config: { select: ["id", "prices.amount"], relations: ["prices"], take: 4 } })))
      .toEqual([[{ id: "count-empty", prices: [] }, { id: "duplicate", prices: [expect.objectContaining({ amount: 200 })] }], 2]);
  });
  it("refuses managed/raw fields and unsupported capabilities without durable work", async () => {
    const before = await commerceInventory(fixture);
    for (const input of [{ deleted_at: null }, { prices: [{ amount: 1, currency_code: "USD", raw_amount: { value: "1" } }] },
      { prices: [{ amount: 1, currency_code: "USD", rules: { a: "1", b: "2" } }] }, { prices: [{ amount: "Infinity", currency_code: "USD" }] }]) {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create, input))).toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await commerceInventory(fixture)).toEqual(before);
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
    const before = await commerceInventory(fixture);
    try {
      expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create, { id: "caught" }))).toMatchObject({ _tag: "CommerceTransactionError" });
      expect(refused).toMatchObject({ reason: "unsupportedProfile" });
      expect(await commerceInventory(fixture)).toEqual(before);
    } finally { spy.mockRestore(); }
  });
});
