// Broader Core lane: genuine Medusa workflow roots through the shared Core owner on
// ordinary-role PostgreSQL. Each case installs its own fixture; seeds run outside timing.
import { afterAll, expect, it } from "vitest";
import { Effect } from "effect";
import pg from "pg";
import { prepareProductCreationWorkflow } from "../../../src/workflows/product/creation";
import { productCreationOptions } from "../../../test/support/core-product-creation-fixture";
import { prepareCoreProductDeletion } from "../../../test/support/core-product-deletion-fixture";
import { prepareCoreProductUpdate, prepareCoreVariantUpdate } from "../../../test/support/core-product-update-fixture";
import { prepareCoreSalesChannelCreation } from "../../../test/support/core-sales-channel-creation-fixture";
import { prepareCoreShippingProfileCreation } from "../../../test/support/core-shipping-profile-creation-fixture";
import { prepareCoreInventoryItemCreation } from "../../../test/support/core-inventory-item-create-fixture";
import { prepareCoreInventoryLevelUpdate } from "../../../test/support/core-inventory-level-update-fixture";
import { prepareCorePriceListCreation } from "../../../test/support/core-price-list-create-fixture";
import { benchmarkSettings, meterPgClient, productCreateInput, summarize, workflowInputs as inputs, writeReport, type Sample } from "./shared";

const settings = benchmarkSettings();
const meter = meterPgClient(pg.Client.prototype, settings.rttMs);
const selected = process.env.BENCH_CASES?.split(",");
type Close = (cleanup: () => Promise<void>) => void;
type Prepared = Readonly<{ seed?: (prefix: string, index: number) => Promise<void>; run: (prefix: string, index: number) => Effect.Effect<unknown, unknown> }>;
const creator = async (creation: Parameters<typeof productCreationOptions>[0], close: Close) => {
  const host = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(creation), hooks: {} }));
  close(() => Effect.runPromise(host.close));
  return (prefix: string) => Effect.runPromise(host.run(host.newRequestKey(), productCreateInput(prefix))).then(() => undefined);
};

const cases: Readonly<Record<string, (close: Close) => Promise<Prepared>>> = {
  "sales-channel-create": async close => {
    const host = await (await prepareCoreSalesChannelCreation("postgres", close)).prepare();
    return { run: prefix => host.run(host.newRequestKey(), inputs.salesChannelCreate(prefix)) };
  },
  "shipping-profile-create": async close => {
    const host = await (await prepareCoreShippingProfileCreation("postgres", close)).prepare();
    return { run: prefix => host.run(host.newRequestKey(), inputs.shippingProfileCreate(prefix)) };
  },
  "inventory-item-create": async close => {
    const host = await (await prepareCoreInventoryItemCreation("postgres", close)).prepare();
    return { run: prefix => host.run(host.newRequestKey(), inputs.inventoryItemCreate(prefix)) };
  },
  "product-delete": async close => {
    const connected = await prepareCoreProductDeletion("postgres", close);
    const create = await creator(connected.creation, close), host = await connected.prepareProduct();
    return { seed: create, run: prefix => host.run(host.newRequestKey(), inputs.productDelete(prefix)) };
  },
  "variant-update": async close => {
    const connected = await prepareCoreProductUpdate("postgres", close);
    const create = await creator(connected.creation, close);
    const host = await (await prepareCoreVariantUpdate(connected.creation, close)).prepare();
    return { seed: create, run: prefix => host.run(host.newRequestKey(), inputs.variantUpdate(prefix)) };
  },
  "price-list-create": async close => {
    const connected = await prepareCorePriceListCreation("postgres", close), host = await connected.prepare();
    const variantId = connected.variantIds[0];
    if (variantId === undefined) throw new Error("Missing seeded Price List variant");
    return { run: prefix => host.run(host.newRequestKey(), inputs.priceListCreate(prefix, variantId)) };
  },
  "inventory-level-update": async close => {
    const connected = await prepareCoreInventoryLevelUpdate("postgres", close), host = await connected.prepare();
    const pairs = new Map<string, { inventory_item_id: string; location_id: string }>();
    return { seed: async prefix => {
      const [pair] = (await connected.seed(prefix)).pairs;
      if (pair === undefined) throw new Error("Missing seeded Inventory Level");
      pairs.set(prefix, pair);
    }, run: (prefix, index) => {
      const pair = pairs.get(prefix);
      return pair === undefined ? Effect.die(new Error("Missing seed")) : host.run(host.newRequestKey(), inputs.inventoryLevelUpdate(pair.inventory_item_id, pair.location_id, index));
    } };
  },
};

const summaries: ReturnType<typeof summarize>[] = [];
const raw: Record<string, readonly Sample[]> = {};
afterAll(() => {
  meter.restore();
  console.info(JSON.stringify({ path: writeReport("core", { settings, summaries, raw }), summaries }));
});
for (const [name, prepare] of Object.entries(cases).filter(([name]) => selected === undefined || selected.includes(name)))
  it(name, async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const prepared = await prepare(close => cleanup.push(close));
      const samples: Sample[] = [], tag = Date.now().toString(36);
      for (let index = 0; index < settings.warmups + settings.samples; index += 1) {
        const prefix = `core${tag}-${index}`;
        await prepared.seed?.(prefix, index);
        const sample = await meter.measure(() => Effect.runPromise(prepared.run(prefix, index)));
        if (index >= settings.warmups) samples.push(sample);
      }
      raw[name] = samples;
      const summary = summarize(`core-${name}`, samples);
      summaries.push(summary);
      expect(summary.firstError).toBeUndefined();
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 3_600_000);
