// Core read and concurrent load lane: genuine Product service reads and workflow roots
// through the shared Core owner on ordinary-role PostgreSQL, matched with load-native.ts.
import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect } from "effect";
import pg from "pg";
import { prepareProductCreationWorkflow } from "../../../src/workflows/product/creation";
import { productCreationOptions } from "../../../test/support/core-product-creation-fixture";
import { prepareCoreProductUpdate } from "../../../test/support/core-product-update-fixture";
import { prepareCoreSalesChannelCreation } from "../../../test/support/core-sales-channel-creation-fixture";
import { prepareCoreInventoryLevelUpdate } from "../../../test/support/core-inventory-level-update-fixture";
import { benchmarkSettings, catalogSize, loadPlan, meterPgClient, productCreateInput, readInputs, runLoad, workflowInputs as inputs,
  writeReport } from "./shared";

const settings = benchmarkSettings();
const meter = meterPgClient(pg.Client.prototype, settings.rttMs);
const selected = process.env.BENCH_CASES?.split(",");
const cleanup: Array<() => Promise<void>> = [];
const close = (done: () => Promise<void>) => { cleanup.push(done); };
const results: Awaited<ReturnType<typeof runLoad>>[] = [];
const run = <A>(work: Effect.Effect<A, unknown>) => Effect.runPromise(work);
let cases: Readonly<Record<string, (prefix: string) => (index: number) => Promise<unknown>>>;

beforeAll(async () => {
  const connected = await prepareCoreProductUpdate("postgres", close);
  const creation = await run(prepareProductCreationWorkflow({ ...productCreationOptions(connected.creation), hooks: {} }));
  close(() => run(creation.close));
  for (let index = 0; index < catalogSize; index += 1)
    await run(creation.run(creation.newRequestKey(), productCreateInput(`cat-${index}`)));
  const { reads, runtime } = connected.creation.product;
  const sales = await (await prepareCoreSalesChannelCreation("postgres", close)).prepare();
  const levels = await prepareCoreInventoryLevelUpdate("postgres", close), levelHost = await levels.prepare();
  const [hot] = (await levels.seed("hot")).pairs;
  if (hot === undefined) throw new Error("Missing seeded hot Inventory Level");
  const distinct = (await levels.seed("distinct", 4)).pairs;
  const catalogId = (index: number) => `cat-${index % catalogSize}-product`;
  cases = {
    "read-retrieve": () => index => run(reads.read(runtime.commands.retrieve, readInputs.retrieve(catalogId(index * 7)))),
    "read-list-ids": () => index => run(reads.read(runtime.commands.list,
      readInputs.listIds(Array.from({ length: 10 }, (_, offset) => catalogId(index * 10 + offset))))),
    "read-list-page": () => index => run(reads.read(runtime.commands.list, readInputs.listPage((index * 20) % catalogSize))),
    "read-list-recent": () => index => run(reads.read(runtime.commands.list, readInputs.listRecent((index * 20) % catalogSize))),
    "read-search": () => index => run(reads.read(runtime.commands.list, readInputs.search(`cat-${index % 20}`))),
    "write-sales-channel": prefix => index => run(sales.run(sales.newRequestKey(), inputs.salesChannelCreate(`${prefix}-${index}`))),
    "write-product-create": prefix => index => run(creation.run(creation.newRequestKey(), productCreateInput(`${prefix}-${index}`))),
    "write-distinct-inventory-level": () => index => { const pair = distinct[index % distinct.length];
      return pair === undefined ? Promise.reject(new Error("Missing seeded Inventory Level")) : run(levelHost.run(levelHost.newRequestKey(),
        inputs.inventoryLevelUpdate(pair.inventory_item_id, pair.location_id, index))); },
    // Core only: the genuine scope-exclusive checkout path; the native lane has no Locking module.
    "write-hot-stock-adjust": () => () => run(levels.adjust.run(levels.adjust.newRequestKey(),
      [{ inventory_item_id: hot.inventory_item_id, location_id: hot.location_id, adjustment: 1 }])),
    "write-hot-inventory-level": () => index => run(levelHost.run(levelHost.newRequestKey(),
      inputs.inventoryLevelUpdate(hot.inventory_item_id, hot.location_id, index))),
  };
}, 3_600_000);
afterAll(async () => {
  for (const done of cleanup.reverse()) await done();
  meter.restore();
  console.info(JSON.stringify({ path: writeReport("core", { settings, catalogSize, results }), results }));
});

it("measures Core reads and concurrent load", async () => {
  const tag = Date.now().toString(36);
  for (const [name, operation] of Object.entries(cases).filter(([name]) => selected === undefined || selected.includes(name)))
    for (const concurrency of loadPlan.levels) {
      const prefix = `core${tag}-${name}-${concurrency}`;
      await runLoad(meter, name, concurrency, Math.min(concurrency * 2, 20), operation(`${prefix}-warm`));
      results.push(await runLoad(meter, name, concurrency, loadPlan.ops(concurrency), operation(prefix)));
    }
  // Core refusals are results of this report, grouped by reason; only an empty run fails.
  expect(results.length).toBeGreaterThan(0);
}, 3_600_000);
