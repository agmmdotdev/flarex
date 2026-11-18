// Native read and concurrent load lane: pinned upstream Product service reads and
// workflow roots, matched with load.postgres.bench.ts. Seeds run outside timing.
import { container, flows, meter, Modules, runWorkflow, shutdownNative } from "./native-app";
import { catalogSize, loadPlan, productCreateInput, readInputs, runLoad, workflowInputs as inputs, writeReport } from "./shared";

type Workflow = (container: unknown) => { run: (options: object) => Promise<{ errors?: unknown[] }> };
const flow = (workflow: Workflow, input: unknown) => runWorkflow(workflow(container).run({ input, throwOnError: false }));
const product = container.resolve(Modules.PRODUCT);
const inventory = container.resolve(Modules.INVENTORY), locations = container.resolve(Modules.STOCK_LOCATION);
const selected = process.env.BENCH_CASES?.split(",");
const tag = Date.now().toString(36);

for (let index = 0; index < catalogSize; index += 1) await flow(flows.createProductsWorkflow, productCreateInput(`cat-${index}`));
await locations.createStockLocations([{ id: "hot-location", name: "hot" }]);
await inventory.createInventoryItems([{ id: "hot-item", sku: "hot-sku" }]);
await inventory.createInventoryLevels([{ inventory_item_id: "hot-item", location_id: "hot-location", stocked_quantity: 10 }]);
const distinctLevels = 64;
await inventory.createInventoryItems(Array.from({ length: distinctLevels }, (_, index) => ({ id: `distinct-${index}`, sku: `distinct-${index}` })));
await inventory.createInventoryLevels(Array.from({ length: distinctLevels }, (_, index) => ({ inventory_item_id: `distinct-${index}`, location_id: "hot-location", stocked_quantity: 10 })));

const catalogId = (index: number) => `cat-${index % catalogSize}-product`;
const cases: Readonly<Record<string, (run: string) => (index: number) => Promise<unknown>>> = {
  "read-retrieve": () => index => { const { id, config } = readInputs.retrieve(catalogId(index * 7)); return product.retrieveProduct(id, config); },
  "read-list-ids": () => index => {
    const { filters, config } = readInputs.listIds(Array.from({ length: 10 }, (_, offset) => catalogId(index * 10 + offset)));
    return product.listProducts(filters, config);
  },
  "read-list-page": () => index => { const { filters, config } = readInputs.listPage((index * 20) % catalogSize); return product.listProducts(filters, config); },
  "read-list-recent": () => index => { const { filters, config } = readInputs.listRecent((index * 20) % catalogSize); return product.listProducts(filters, config); },
  "read-search": () => index => { const { filters, config } = readInputs.search(`cat-${index % 20}`); return product.listProducts(filters, config); },
  "write-sales-channel": run => index => flow(flows.createSalesChannelsWorkflow, inputs.salesChannelCreate(`${run}-${index}`)),
  "write-product-create": run => index => flow(flows.createProductsWorkflow, productCreateInput(`${run}-${index}`)),
  "write-distinct-inventory-level": () => index => flow(flows.updateInventoryLevelsWorkflow, inputs.inventoryLevelUpdate(`distinct-${index % distinctLevels}`, "hot-location", index)),
  "write-hot-inventory-level": () => index => flow(flows.updateInventoryLevelsWorkflow, inputs.inventoryLevelUpdate("hot-item", "hot-location", index)),
};

const results: Awaited<ReturnType<typeof runLoad>>[] = [];
for (const [name, operation] of Object.entries(cases).filter(([name]) => selected === undefined || selected.includes(name)))
  for (const concurrency of loadPlan.levels) {
    const run = `native${tag}-${name}-${concurrency}`;
    await runLoad(meter, name, concurrency, Math.min(concurrency * 2, 20), operation(`${run}-warm`));
    results.push(await runLoad(meter, name, concurrency, loadPlan.ops(concurrency), operation(run)));
  }
console.info(JSON.stringify({ path: writeReport("native", { catalogSize, results }), results }));
await shutdownNative();
process.exit(0);
