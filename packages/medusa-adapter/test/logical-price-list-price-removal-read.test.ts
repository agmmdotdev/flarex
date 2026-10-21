import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceDecoder } from "../src/value/decoder";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceRemovalContracts, PriceListPriceRemovalWorkflowInput } from "../src/modules/pricing/price-list-price-removal-input";
import { readPriceListPriceRemovalRows } from "../src/modules/pricing/price-list-price-removal-repository";
import { prepareLogicalPriceListCreation } from "./support/logical-price-list-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const text = Schema.decodeUnknownSync(Schema.String);
const id = (row: JsonObject) => text(row.id);
const prices = (row: JsonObject) => objects(row.prices);
let base: Awaited<ReturnType<typeof prepareLogicalPriceListCreation>>;
let read: (ids: string[]) => Promise<ReturnType<typeof objects>>;

const seed = async (suffix: string, variant: number, currency = "USD") => {
  const host = await base.prepare();
  const output = await Effect.runPromise(host.run(host.newRequestKey(), { price_lists_data: [{
    title: "read157-" + suffix, description: suffix,
    prices: [{ variant_id: base.variantIds[variant]!, currency_code: currency, amount: 40 }],
  }] }));
  if (!output[0] || !prices(output[0])[0]) throw new Error("Missing genuine native Price List seed graph");
  return { list: output[0], price: prices(output[0])[0]! };
};

describe(`native157 independent Price read translation - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    base = await prepareLogicalPriceListCreation(driver, close => cleanup.push(close));
    const contracts = Result.getOrThrow(compilePriceListPriceRemovalContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    const decodeInput = commerceDecoder(PriceListPriceRemovalWorkflowInput, "invalidInput");
    // Trusted test-only read composition. This does not admit the removal module
    // or any lifecycle method while its portable event ordering is undecided.
    const command = defineCommerceCommand("native157PriceReadProbe", "read", Effect.fn(function* (ctx, input) {
      const selected = yield* Effect.fromResult(decodeInput(input));
      return yield* readPriceListPriceRemovalRows(ctx, contracts, buildQuery({ id: selected.ids },
        { relations: ["price_list"], order: { id: "ASC" } }));
    }));
    const logicalStorage = base.options.modules.pricing.logicalStorage;
    if (logicalStorage === undefined) throw new Error("Missing initialized Pricing logical source");
    const host = await Effect.runPromise(makeCommerceHost({ ...base.fixture.hostInput, logicalStorage, commands: [command],
      identityAndAccessPolicy: { profile: "native157-price-read-probe" } }));
    cleanup.push(() => Effect.runPromise(host.close));
    read = async ids => objects(await Effect.runPromise(host.read(command, { ids })));
  }, 240_000);
  afterEach(async () => { await base.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("keeps empty, missing and List-ID selectors empty without committed data or event changes", async () => {
    const before = await base.snapshot();
    expect(await read([])).toEqual([]);
    expect(await read(["", "missing157", "plist152-comparison-history", "missing157"])).toEqual([]);
    const after = await base.snapshot();
    for (const name of ["rows", "revisions", "rowChanges", "physicalFacts", "events"] as const)
      expect(after[name], name).toEqual(before[name]);
  });

  it("returns complete native DTOs in Price ID order for raw duplicate and cross-List selectors", async () => {
    const first = await seed("cross-a", 0), second = await seed("cross-b", 1, "EUR");
    const before = await base.snapshot();
    const persisted = await base.read([id(first.price), id(second.price)]);
    const selected = await read([id(second.price), "missing157", id(first.price), id(second.price), ""]);
    expect(selected.map(id)).toEqual([id(first.price), id(second.price)].sort());
    for (const expected of [first, second]) {
      const row = selected.find(row => row.id === expected.price.id);
      const stored = persisted.find(row => row.id === expected.price.id);
      if (stored === undefined) throw new Error("Missing actual persisted Price preimage");
      expect(row).toMatchObject({ id: id(expected.price), amount: 40, raw_amount: stored.raw_amount,
        price_set_id: expected.price.price_set_id, price_set: { id: expected.price.price_set_id },
        price_list_id: id(expected.list), price_list: { id: id(expected.list), title: expected.list.title,
          description: expected.list.description, status: expected.list.status, type: expected.list.type,
          rules_count: 0, deleted_at: null } });
      expect(row).not.toHaveProperty("price_rules");
      expect(row?.price_set).toEqual({ id: expected.price.price_set_id });
    }
    const after = await base.snapshot();
    for (const name of ["rows", "revisions", "rowChanges", "physicalFacts", "events"] as const)
      expect(after[name], name).toEqual(before[name]);
  });

  it("preserves base Prices and masks a historical List only in the returned nullable relation", async () => {
    const baseId = "plist152-protected-base", activeUnderHistory = "price152-comparison-0";
    const historicalPrice = "price152-comparison-1", secondActive = "price152-comparison-2";
    const stored = await base.read([baseId, activeUnderHistory, historicalPrice, secondActive]);
    expect(stored.find(row => row.id === activeUnderHistory)?.price_list_id).toBe(base.historicalRootId);
    expect(stored.find(row => row.id === historicalPrice)?.deleted_at).toEqual(expect.any(String));
    const selected = await read([secondActive, historicalPrice, baseId, activeUnderHistory]);
    expect(selected.map(id)).toEqual([secondActive, baseId, activeUnderHistory].sort());
    for (const row of selected) expect(row).toMatchObject({ price_list_id: null, price_list: null,
      price_set: { id: base.setIds[0] } });
    expect(await base.read([baseId, activeUnderHistory, historicalPrice, secondActive])).toEqual(stored);
  });

  it("requires an active native PriceSet while preserving the selected storage graph", async () => {
    const active = await seed("active-set", 0), hidden = await seed("historical-set", 3);
    const stored = await base.read([id(active.price), id(hidden.price), base.setIds[3]!]);
    expect(stored.find(row => row.id === hidden.price.id)?.deleted_at).toBeNull();
    expect(stored.find(row => row.id === base.setIds[3])?.deleted_at).toEqual(expect.any(String));
    expect((await read([id(hidden.price), id(active.price)])).map(id)).toEqual([id(active.price)]);
    expect(await read([id(hidden.price)])).toEqual([]);
    expect(await base.read([id(active.price), id(hidden.price), base.setIds[3]!])).toEqual(stored);
  });
});
