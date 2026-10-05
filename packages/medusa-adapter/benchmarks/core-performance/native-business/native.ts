import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { Schema } from "effect";
import { BasePayload, buildConfig, type CollectionConfig, type CollectionAfterChangeHook } from "../../../../../work/native-business-baseline/dependencies/node_modules/payload/dist/index.js";
import { postgresAdapter } from "../../../../../work/native-business-baseline/dependencies/node_modules/@payloadcms/db-postgres/dist/index.js";
import type { PoolClient } from "pg";
import { asValue } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/deps/awilix.js";
import { ContainerRegistrationKeys, Modules } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/utils/index.js";
import { mikroOrmModuleTestPersistenceAdapter as adapter } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter.js";
import { getMikroOrmWrapper } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/database.js";
import { initModules } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules.js";
import type ProductService from "../../../../../third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service.js";
import type PricingService from "../../../../../third_party/medusa/upstream/packages/modules/pricing/dist/services/pricing-module.js";
import type { MedusaAppOutput } from "../../../../../third_party/medusa/upstream/packages/core/modules-sdk/dist/medusa-app.js";
import { productAttemptSeed } from "../../../test/support/product-attempt-seed";
import { nativeLaunchWorkflow } from "./workflow";

export const baselineFlows = ["payload-create", "payload-lifecycle", "product-graph", "medusa-workflow", "mixed-product", "mixed-payload", "mixed-workflow"] as const;
export type BaselineFlow = typeof baselineFlows[number];
// The pinned helper is CommonJS with exports.default, not a native ESM default.
const { default: MockEventBusService }: typeof import("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js") =
  createRequire(import.meta.url)("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js");
const nativePg: typeof import("pg") = createRequire(import.meta.url)("../../../../../work/native-business-baseline/dependencies/node_modules/pg/lib/index.js");
const post = Schema.decodeUnknownSync(Schema.StructWithRest(Schema.Struct({ id: Schema.String, title: Schema.String,
  score: Schema.Number, enabled: Schema.Boolean }), [Schema.Record(Schema.String, Schema.Json)]));
const launch = Schema.decodeUnknownSync(Schema.Struct({
  product: Schema.Struct({ id: Schema.String, title: Schema.String }),
  tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
  pricing: Schema.Struct({ variants: Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String })),
    priceSets: Schema.Array(Schema.Struct({ id: Schema.String, prices: Schema.Array(Schema.Struct({ id: Schema.String,
      currency_code: Schema.String, amount: Schema.Number, price_rules: Schema.Array(Schema.Unknown) })) })),
    links: Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String, price_set_id: Schema.String })) }),
}));
const lifecycleResult = Schema.decodeUnknownSync(Schema.Struct({ created: Schema.Unknown, afterHook: Schema.Unknown,
  enabled: Schema.Unknown, final: Schema.Unknown }));
const workflowResult = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Unknown }));
const productResult = Schema.decodeUnknownSync(Schema.Struct({ updated: Schema.Struct({ id: Schema.String, title: Schema.String }),
  pending: Schema.Struct({ id: Schema.String, title: Schema.String }), listed: Schema.Array(Schema.Struct({ id: Schema.String })) }));
const applicationPhase = Schema.decodeUnknownSync(Schema.Struct({ phase: Schema.String }));

/** Native executable benchmark boundary: Promises deliberately preserve library
 * exceptions and time the actual native calls without Effect bridge overhead.
 * Resource cleanup drains all owners and retains original plus cleanup errors. */
export async function prepareNativeBusiness(medusaUrl: string, payloadUrl: string) {
  assert.notEqual(process.env.MEDUSA_MODULE_TEST_PERSISTENCE, "pglite", "Native business baseline requires PostgreSQL/MikroORM; unset MEDUSA_MODULE_TEST_PERSISTENCE=pglite");
  const releases: Array<() => Promise<void>> = [];
  const dispose = async () => {
    const errors: unknown[] = [];
    for (const release of releases.splice(0).toReversed()) try { await release(); } catch (error) { errors.push(error); }
    if (errors.length > 0) throw new AggregateError(errors, "Native baseline cleanup failed");
  };
  try {
    const pool = new Pool({ connectionString: medusaUrl, max: 2 });
    releases.push(() => pool.end());
    const payloadSettingsPool = new Pool({ connectionString: payloadUrl, max: 1 });
    releases.push(() => payloadSettingsPool.end());
    const settings = await Promise.all([readSettings(pool), readSettings(payloadSettingsPool)]);
    assert.notEqual(settings[0]?.database, settings[1]?.database);
    await pool.query("CREATE TABLE IF NOT EXISTS native_baseline_application (id text PRIMARY KEY, document jsonb NOT NULL)");
    const dbConfig = { clientUrl: medusaUrl, schema: "public", debug: false };
    const connection = adapter.createConnection(dbConfig);
    releases.push(() => adapter.cleanupConnection(connection));
    const productResolve = fileURLToPath(new URL("../../../../../third_party/medusa/upstream/packages/modules/product", import.meta.url));
    const pricingResolve = fileURLToPath(new URL("../../../../../third_party/medusa/upstream/packages/modules/pricing", import.meta.url));
    const productModels = adapter.prepareDatabase({ connection, resolve: productResolve, dbConfig }).models;
    const pricingModels = adapter.prepareDatabase({ connection, resolve: pricingResolve, dbConfig }).models;
    const database = getMikroOrmWrapper({ mikroOrmEntities: [...productModels, ...pricingModels], clientUrl: medusaUrl, schema: "public" });
    releases.push(async () => { if (database.orm !== null) await database.orm.close(); });
    await database.setupDatabase();
    const modulesConfig = {
      [Modules.PRODUCT]: { resolve: productResolve, options: adapter.getModuleOptions(dbConfig, {}, connection) },
      [Modules.PRICING]: { resolve: pricingResolve, options: adapter.getModuleOptions(dbConfig, {}, connection) },
      [Modules.LINK]: { scope: "internal" as const, resolve: fileURLToPath(new URL("../../../../../third_party/medusa/upstream/packages/modules/link-modules", import.meta.url)),
        options: { database: dbConfig } },
    };
    const initialized = await initModules({ databaseConfig: dbConfig, modulesConfig,
      injectedDependencies: { ...adapter.getInjectedDependencies(connection), [Modules.EVENT_BUS]: new MockEventBusService(),
        [ContainerRegistrationKeys.LOGGER]: console, [ContainerRegistrationKeys.CONFIG_MODULE]: { modules: modulesConfig } },
      preventConnectionDestroyWarning: true, cwd: productResolve });
    releases.push(initialized.shutdown);
    const app: MedusaAppOutput = initialized.medusaApp;
    const planner = app.linkMigrationExecutionPlanner();
    await planner.executePlan(await planner.createPlan());
    const container = app.sharedContainer;
    if (container === undefined || app.link === undefined) throw new Error("Missing native query/link container");
    container.register({ [ContainerRegistrationKeys.QUERY]: asValue(app.query),
      [ContainerRegistrationKeys.LINK]: asValue(app.link) });
    const product = container.resolve<ProductService>(Modules.PRODUCT);
    const pricing = container.resolve<PricingService>(Modules.PRICING);
    let hookRuns = 0;
    let nestedReads = 0;
    const afterChange: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
      if (operation !== "create") return doc;
      hookRuns += 1;
      assert.equal(doc.score, 0); assert.equal(doc.enabled, false);
      const updated = await req.payload.update({ collection: "posts", id: doc.id, data: { score: 1 }, req, depth: 0, overrideAccess: false });
      assert.equal(updated.score, 1);
      const observed = await req.payload.findByID({ collection: "posts", id: doc.id, req, depth: 0, overrideAccess: false });
      assert.equal(observed.score, 1); nestedReads += 1;
      return doc;
    };
    const access: CollectionConfig["access"] = { read: ({ req }) => req.context.flarexFixedPayloadPrincipal === "allowed",
      create: ({ req }) => req.context.flarexFixedPayloadPrincipal === "allowed",
      update: ({ req }) => req.context.flarexFixedPayloadPrincipal === "allowed", delete: ({ req }) => req.context.flarexFixedPayloadPrincipal === "allowed" };
    const payload = new BasePayload();
    const payloadPools: OwnedPayloadPool[] = [];
    class OwnedPayloadPool extends nativePg.Pool {
      readonly held = new Set<PoolClient>();
      constructor(options: ConstructorParameters<typeof nativePg.Pool>[0]) {
        super(options); payloadPools.push(this);
        this.on("acquire", client => { this.held.add(client); });
        this.on("release", (_error, client) => { this.held.delete(client); });
      }
    }
    // Payload's native destroy resets schema state but does not close its pool,
    // and connect retains a bootstrap checkout. Track public Pool lifecycle
    // events without changing query/transaction behavior; drain only after all
    // native business calls and native destroy have completed.
    releases.push(async () => {
      for (const owned of payloadPools) {
        for (const client of owned.held) client.release();
        await owned.end();
      }
    });
    releases.push(() => payload.destroy());
    await payload.init({ disableOnInit: true, config: await buildConfig({
      secret: "private-native-baseline-not-a-deployment-secret", db: postgresAdapter({ pool: { connectionString: payloadUrl, max: 2 },
        idType: "uuid", push: true, disableCreateDatabase: true, pg: { ...nativePg, Pool: OwnedPayloadPool } }),
      collections: [
        { slug: "news-items", lockDocuments: false, enableQueryPresets: false, defaultSort: "id",
          access: { read: () => true, create: () => true, update: () => true, delete: () => true }, fields: [
          { name: "headline", type: "text", required: true, unique: true }, { name: "score", type: "number", required: true, defaultValue: 0 }] },
        { slug: "authors", lockDocuments: false, enableQueryPresets: false, defaultSort: "id",
          access: { read: () => true, create: () => true, update: () => true, delete: () => true }, fields: [{ name: "name", type: "text", required: true }] },
        { slug: "posts", lockDocuments: false, enableQueryPresets: false, defaultSort: "id", timestamps: true, access,
          fields: [{ name: "title", type: "text", required: true, unique: true }, { name: "score", type: "number", required: true, defaultValue: 0 },
            { name: "enabled", type: "checkbox", required: true, defaultValue: false }, { name: "publishedAt", type: "date", required: true }],
          hooks: { afterChange: [afterChange] } },
        { slug: "users", auth: true, lockDocuments: false, fields: [] },
      ], admin: { user: "users", disable: true }, globals: [], folders: false, telemetry: false,
      jobs: { tasks: [], workflows: [] }, typescript: { autoGenerate: false },
      email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled",
        sendEmail: async () => { throw new Error("Email is outside the native baseline"); } }),
    }) });
    const local = { depth: 0, overrideAccess: false, context: { flarexFixedPayloadPrincipal: "allowed" } };
    async function payloadLifecycle(title: string) {
      const created = await payload.create({ ...local, collection: "posts", data: { title, publishedAt: "2026-01-01" } });
      const afterHook = await payload.findByID({ ...local, collection: "posts", id: created.id });
      const enabled = await payload.update({ ...local, collection: "posts", id: created.id, data: { enabled: true } });
      const final = await payload.findByID({ ...local, collection: "posts", id: created.id });
      return { created, afterHook, enabled, final };
    }
    return { dispose, settings, readSettings: () => Promise.all([readSettings(pool), readSettings(payloadSettingsPool)]),
      async prepareSample(flow: BaselineFlow, suffix: string) {
        const workflow = flow === "medusa-workflow" || flow === "mixed-workflow";
        const mixed = flow.startsWith("mixed-");
        const callsPayload = flow === "payload-lifecycle" || flow === "mixed-payload" || flow === "mixed-workflow";
        const seed = productAttemptSeed(suffix, workflow ? "launch" : "existing");
        if (workflow || mixed || flow === "product-graph") {
          await product.createProductTags(seed.tagInput); await product.createProductCategories(seed.categoryInput);
          await product.createProducts(seed.createInput.products);
        }
        const beforeHook = hookRuns; const beforeReads = nestedReads;
        const applicationId = `app_${suffix}`;
        let output: unknown;
        let payloadId: string | number | undefined;
        let newsId: string | number | undefined;
        let graph: ReturnType<typeof launch> | undefined;
        return {
          async run() {
            if (flow === "payload-create") {
              const created = await payload.create({ collection: "news-items", data: { headline: suffix }, depth: 0, overrideAccess: false });
              newsId = created.id; output = created; return created;
            }
            if (flow === "payload-lifecycle") {
              const value = await payloadLifecycle(seed.newTitle); payloadId = value.final.id; output = value; return value;
            }
            if (mixed) await pool.query("INSERT INTO native_baseline_application VALUES ($1, $2)", [applicationId,
              workflow ? { productId: seed.productId, phase: "draft" } : { name: "before" }]);
            const updated = flow === "medusa-workflow" ? undefined : await product.updateProducts(seed.productId, seed.updateInput.data);
            const pending = flow === "medusa-workflow" ? undefined : await product.retrieveProduct(seed.productId);
            const listed = workflow ? undefined : await product.listProducts(seed.listInput.filters);
            let workflowResult: unknown;
            if (workflow) {
              const completed = await nativeLaunchWorkflow(container).run({ input: { product_id: seed.productId, tag_id: seed.tagId,
                variant_title: "Launch variant", usd_amount: 50 } });
              if (completed.errors.length > 0) throw new AggregateError(completed.errors, "Native launch failed");
              workflowResult = completed.result;
            }
            const posts = callsPayload ? await payloadLifecycle(seed.newTitle) : undefined;
            payloadId = posts?.final.id;
            if (mixed) {
              graph = workflow ? launch(workflowResult) : undefined;
              const variant = graph?.pricing.variants[0]; const priceSet = graph?.pricing.priceSets[0];
              await pool.query("UPDATE native_baseline_application SET document = $2 WHERE id = $1", [applicationId,
                workflow ? { productId: seed.productId, phase: "launched", variantId: variant?.id, priceSetId: priceSet?.id,
                  priceId: priceSet?.prices[0]?.id, tagId: seed.tagId, payloadPostId: payloadId } :
                  { name: posts === undefined ? seed.newTitle : `${posts.final.title}:${posts.final.score}` }]);
            }
            output = { updated, pending, listed, workflow: workflowResult, ...posts };
            return output;
          },
          async verify() {
            if (flow === "payload-create") {
              assert.ok(newsId !== undefined);
              const persisted = await payload.findByID({ collection: "news-items", id: newsId, depth: 0, overrideAccess: false });
              assert.equal(persisted.headline, suffix); assert.equal(persisted.score, 0); return;
            }
            if (callsPayload) {
              assert.ok(payloadId !== undefined);
              const persisted = post(await payload.findByID({ ...local, collection: "posts", id: payloadId }));
              assert.equal(persisted.title, seed.newTitle); assert.equal(persisted.score, 1); assert.equal(persisted.enabled, true);
              assert.equal(hookRuns, beforeHook + 1); assert.equal(nestedReads, beforeReads + 1);
              const values = lifecycleResult(output);
              assert.equal(post(values.created).score, 0); assert.equal(post(values.afterHook).score, 1);
              assert.equal(post(values.created).enabled, false); assert.equal(post(values.afterHook).enabled, false);
            }
            if (flow !== "payload-lifecycle") {
              const persisted = await product.retrieveProduct(seed.productId, { relations: ["tags", "variants"] });
              assert.equal(persisted.title, flow === "medusa-workflow" ? seed.createInput.products[0]?.title : seed.newTitle);
              if (workflow) {
                const value = workflowResult(output);
                graph = launch(value.workflow);
                assert.equal(graph.product.id, seed.productId); assert.equal(graph.tags[0]?.id, seed.tagId);
                assert.equal(graph.tags[0]?.value, "launched"); assert.equal(graph.tags.length, 1);
                assert.equal(graph.pricing.variants.length, 1); assert.equal(graph.pricing.priceSets.length, 1); assert.equal(graph.pricing.links.length, 1);
                const variant = graph.pricing.variants[0]; const priceSet = graph.pricing.priceSets[0];
                assert.ok(variant !== undefined && priceSet !== undefined);
                assert.equal(variant.product_id, seed.productId); assert.equal(priceSet.prices.length, 1);
                assert.equal(priceSet.prices[0]?.amount, 50); assert.equal(priceSet.prices[0]?.currency_code, "USD");
                assert.deepEqual(priceSet.prices[0]?.price_rules, []);
                assert.equal(graph.pricing.links[0]?.variant_id, variant.id); assert.equal(graph.pricing.links[0]?.price_set_id, priceSet.id);
                assert.equal(persisted.variants?.some(value => value.id === variant.id), true);
                assert.equal(persisted.tags?.some(value => value.id === seed.tagId && value.value === "launched"), true);
                const prices = await pricing.retrievePriceSet(priceSet.id, { relations: ["prices"] });
                assert.equal(prices.prices?.[0]?.amount, 50);
                const links = await app.query.graph({ entity: "product_variant_price_sets",
                  fields: ["id", "variant_id", "price_set_id"], filters: { variant_id: variant.id, price_set_id: priceSet.id } });
                assert.equal(links.data.length, 1);
              } else {
                assert.equal(persisted.handle, seed.newHandle); assert.equal(persisted.status, "published");
                const values = productResult(output);
                assert.equal(values.updated.id, seed.productId); assert.equal(values.updated.title, seed.newTitle);
                assert.equal(values.pending.title, seed.newTitle); assert.deepEqual(values.listed.map(value => value.id), [seed.productId]);
              }
            }
            if (mixed) {
              const row = await pool.query<{ document: unknown }>("SELECT document FROM native_baseline_application WHERE id = $1", [applicationId]);
              if (workflow) assert.equal(applicationPhase(row.rows[0]?.document).phase, "launched");
              else assert.deepEqual(row.rows[0]?.document, { name: callsPayload ? `${seed.newTitle}:1` : seed.newTitle });
            }
          },
          async cleanup() {
            if (payloadId !== undefined) await payload.delete({ ...local, collection: "posts", id: payloadId });
            if (newsId !== undefined) await payload.delete({ collection: "news-items", id: newsId, overrideAccess: false });
            if (workflow || mixed || flow === "product-graph") {
              if (graph !== undefined) await pricing.deletePriceSets(graph.pricing.priceSets.map(value => value.id));
              await product.deleteProducts([seed.productId]); await product.deleteProductTags([seed.tagId]); await product.deleteProductCategories([seed.categoryId]);
            }
            if (mixed) await pool.query("DELETE FROM native_baseline_application WHERE id = $1", [applicationId]);
          },
        };
      },
    };
  } catch (error) {
    try { await dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native preparation and cleanup failed"); }
    throw error;
  }
}

const settingsDecoder = Schema.decodeUnknownSync(Schema.Struct({ database: Schema.String, role: Schema.String,
  superuser: Schema.Boolean, synchronous_commit: Schema.String, fsync: Schema.String, full_page_writes: Schema.String,
  server_version: Schema.String, track: Schema.NullOr(Schema.String) }));
async function readSettings(pool: Pool) {
  const result = await pool.query("SELECT current_database() AS database, current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser, current_setting('synchronous_commit') AS synchronous_commit, current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_page_writes, current_setting('server_version') AS server_version, current_setting('pg_stat_statements.track', true) AS track");
  const settings = settingsDecoder(result.rows[0]);
  assert.equal(settings.superuser, false); assert.equal(settings.synchronous_commit, "on");
  assert.equal(settings.fsync, "on"); assert.equal(settings.full_page_writes, "on");
  assert.ok(settings.track === "none" || settings.track === null);
  return settings;
}
