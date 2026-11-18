// Broader native lane: the same pinned upstream workflow roots and matched inputs
// as workflows.postgres.bench.ts. Seeds run outside timing.
import { container, flows, meter, Modules, runWorkflow, settings, shutdownNative } from "./native-app";
import { productCreateInput, summarize, workflowInputs as inputs, writeReport, type Sample } from "./shared";

type Prepared = Readonly<{ seed?: (prefix: string, index: number) => Promise<void>; run: (prefix: string, index: number) => Promise<unknown> }>;
const selected = process.env.BENCH_CASES?.split(",");
const flow = (workflow: (container: unknown) => { run: (options: object) => Promise<{ errors?: unknown[] }> }, input: unknown) =>
  runWorkflow(workflow(container).run({ input, throwOnError: false }));
const seedProduct = (prefix: string) => flow(flows.createProductsWorkflow, productCreateInput(prefix)).then(() => undefined);

const cases: Readonly<Record<string, () => Promise<Prepared>>> = {
  "sales-channel-create": async () => ({ run: prefix => flow(flows.createSalesChannelsWorkflow, inputs.salesChannelCreate(prefix)) }),
  "shipping-profile-create": async () => ({ run: prefix => flow(flows.createShippingProfilesWorkflow, inputs.shippingProfileCreate(prefix)) }),
  "inventory-item-create": async () => ({ run: prefix => flow(flows.createInventoryItemsWorkflow, inputs.inventoryItemCreate(prefix)) }),
  "product-delete": async () => ({ seed: seedProduct, run: prefix => flow(flows.deleteProductsWorkflow, inputs.productDelete(prefix)) }),
  "variant-update": async () => ({ seed: seedProduct, run: prefix => flow(flows.updateProductVariantsWorkflow, inputs.variantUpdate(prefix)) }),
  "price-list-create": async () => {
    await seedProduct("price-list-seed");
    return { run: prefix => flow(flows.createPriceListsWorkflow, inputs.priceListCreate(prefix, "price-list-seed-variant")) };
  },
  "inventory-level-update": async () => {
    const inventory = container.resolve(Modules.INVENTORY), locations = container.resolve(Modules.STOCK_LOCATION);
    return { seed: async prefix => {
      await locations.createStockLocations([{ id: prefix + "-location", name: prefix }]);
      await inventory.createInventoryItems([{ id: prefix + "-item", sku: prefix + "-sku" }]);
      await inventory.createInventoryLevels([{ inventory_item_id: prefix + "-item", location_id: prefix + "-location", stocked_quantity: 10 }]);
    }, run: (prefix, index) => flow(flows.updateInventoryLevelsWorkflow, inputs.inventoryLevelUpdate(prefix + "-item", prefix + "-location", index)) };
  },
};

const summaries: ReturnType<typeof summarize>[] = [];
const raw: Record<string, readonly Sample[]> = {};
const tag = Date.now().toString(36);
for (const [name, prepare] of Object.entries(cases).filter(([name]) => selected === undefined || selected.includes(name))) {
  const prepared = await prepare();
  const samples: Sample[] = [];
  for (let index = 0; index < settings.warmups + settings.samples; index += 1) {
    const prefix = `native${tag}-${name}-${index}`;
    await prepared.seed?.(prefix, index);
    const sample = await meter.measure(() => prepared.run(prefix, index));
    if (index >= settings.warmups) samples.push(sample);
  }
  raw[name] = samples;
  summaries.push(summarize(`native-${name}`, samples));
}
console.info(JSON.stringify({ path: writeReport("native", { settings, summaries, raw }), summaries }));
await shutdownNative();
process.exit(summaries.every(summary => summary.failures === 0) ? 0 : 1);
