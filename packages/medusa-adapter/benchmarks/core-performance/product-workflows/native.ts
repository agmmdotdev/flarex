// Native lane: pinned upstream Medusa createProductsWorkflow / updateProductsWorkflow
// with the Core lane's module set, seeds and per-request input. Every step is the
// pinned native implementation; no Flarex SDK, adapter or transaction runs here.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { benchmarkSettings, meterPgClient, productCreateInput, productUpdateInput, seedLabel, seedPrefixes, summarize, writeReport,
  type Sample } from "./shared";
const upstream = fileURLToPath(new URL("../../../../../third_party/medusa/upstream/", import.meta.url));
const U = upstream + "packages";
const require = createRequire(import.meta.url);
const pg = require(upstream + "node_modules/pg/lib/index.js");
const { asValue } = require(`${U}/core/framework/dist/deps/awilix.js`);
const { ContainerRegistrationKeys, Modules } = require(`${U}/core/framework/dist/utils/index.js`);
const { mikroOrmModuleTestPersistenceAdapter: adapter } = require(`${U}/medusa-test-utils/dist/module-test-persistence-adapter.js`);
const { getMikroOrmWrapper } = require(`${U}/medusa-test-utils/dist/database.js`);
const { initModules } = require(`${U}/medusa-test-utils/dist/init-modules.js`);
const { default: MockEventBusService } = require(`${U}/medusa-test-utils/dist/mock-event-bus-service.js`);
const { createProductsWorkflow, updateProductsWorkflow } = require(`${U}/core/core-flows/dist/index.js`);

const url = process.env.NATIVE_BUSINESS_MEDUSA_URL;
if (url === undefined || url === "") throw new Error("NATIVE_BUSINESS_MEDUSA_URL must name a disposable ordinary-role database");
if (process.env.MEDUSA_MODULE_TEST_PERSISTENCE === "pglite") throw new Error("The native lane requires PostgreSQL/MikroORM");
const settings = benchmarkSettings();
const meter = meterPgClient(pg.Client.prototype, settings.rttMs);

const mods = { product: "modules/product", pricing: "modules/pricing", sales_channel: "modules/sales-channel",
  fulfillment: "modules/fulfillment", inventory: "modules/inventory", stock_location: "modules/stock-location" } as const;
const dbConfig = { clientUrl: url, schema: "public", debug: false };
const connection = adapter.createConnection(dbConfig);
const models = Object.values(mods).flatMap(path => adapter.prepareDatabase({ connection, resolve: `${U}/${path}`, dbConfig }).models);
const database = getMikroOrmWrapper({ mikroOrmEntities: models, clientUrl: url, schema: "public" });
await database.setupDatabase();
const modulesConfig: Record<string, unknown> = Object.fromEntries(Object.entries({
  [Modules.PRODUCT]: mods.product, [Modules.PRICING]: mods.pricing, [Modules.SALES_CHANNEL]: mods.sales_channel,
  [Modules.FULFILLMENT]: mods.fulfillment, [Modules.INVENTORY]: mods.inventory, [Modules.STOCK_LOCATION]: mods.stock_location,
}).map(([key, path]) => [key, { resolve: `${U}/${path}`, options: adapter.getModuleOptions(dbConfig, {}, connection) }]));
modulesConfig[Modules.LINK] = { scope: "internal", resolve: `${U}/modules/link-modules`, options: { database: dbConfig } };
const initialized = await initModules({ databaseConfig: dbConfig, modulesConfig,
  injectedDependencies: { ...adapter.getInjectedDependencies(connection), [Modules.EVENT_BUS]: new MockEventBusService(),
    [ContainerRegistrationKeys.LOGGER]: { info() {}, warn() {}, error: console.error, debug() {}, log() {} },
    [ContainerRegistrationKeys.CONFIG_MODULE]: { modules: modulesConfig } },
  preventConnectionDestroyWarning: true, cwd: `${U}/${mods.product}` });
const app = initialized.medusaApp;
const planner = app.linkMigrationExecutionPlanner();
await planner.executePlan(await planner.createPlan());
const container = app.sharedContainer;
container.register({ [ContainerRegistrationKeys.QUERY]: asValue(app.query), [ContainerRegistrationKeys.REMOTE_QUERY]: asValue(app.query), [ContainerRegistrationKeys.LINK]: asValue(app.link), [ContainerRegistrationKeys.REMOTE_LINK]: asValue(app.link) });

// Seeds identical to the Core fixture's root/replacement references.
const product = container.resolve(Modules.PRODUCT), sales = container.resolve(Modules.SALES_CHANNEL), fulfillment = container.resolve(Modules.FULFILLMENT);
for (const prefix of seedPrefixes) {
  const label = seedLabel(prefix);
  await product.createProductTags(Array.from({ length: 4 }, (_, i) => ({ id: `${prefix}-tag-${i}`, value: `${label} tag ${i}` })));
  await product.createProductCategories(Array.from({ length: 4 }, (_, i) => ({ id: `${prefix}-category-${i}`, name: `${label} category ${i}` })));
  await sales.createSalesChannels([0, 1].map(i => ({ id: `${prefix}-channel-${i}`, name: `${label} channel ${i}` })));
  await fulfillment.createShippingProfiles([0, 1].map(i => ({ id: `${prefix}-profile-${i}`, name: `${label} profile ${i}`, type: "default" })));
}


// Native workflows report step failures in `errors`; surface them as failed samples.
const runWorkflow = async (work: Promise<{ errors?: unknown[] }>) => {
  const { errors = [] } = await work;
  const first = errors[0] as { action?: string; error?: { message?: string } } | undefined;
  if (first !== undefined) throw new Error(`${first.action ?? "workflow"}: ${first.error?.message ?? JSON.stringify(first)}`);
};
const created: Sample[] = [], updated: Sample[] = [];
const tag = Date.now().toString(36);
for (let index = 0; index < settings.warmups + settings.samples; index += 1) {
  const prefix = `native${tag}-${index}`;
  const create = await meter.measure(() => runWorkflow(createProductsWorkflow(container).run({ input: productCreateInput(prefix), throwOnError: false })));
  const change = await meter.measure(() => runWorkflow(updateProductsWorkflow(container).run({
    input: productUpdateInput(prefix + "-product", index), throwOnError: false })));
  if (index >= settings.warmups) { created.push(create); updated.push(change); }
}
const summaries = [summarize("native-product-create", created), summarize("native-product-update", updated)];
const path = writeReport("native", { settings, summaries, raw: { created, updated } });
console.info(JSON.stringify({ path, summaries }));
await initialized.shutdown();
await adapter.cleanupConnection(connection);
if (database.orm) await database.orm.close();
meter.restore();
process.exit(summaries.every(summary => summary.failures === 0) ? 0 : 1);
