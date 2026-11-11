import { Clock, Effect, Scope, Schema } from "effect";
import type { IPricingModuleService } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { openCoreDatabase } from "@flarex/persistence-postgres/internal/core";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { makeStoreProductRequestReads, type StoreProductRequestReads, type StoreProductRequestCatalog } from "../../src/http/store-product-request";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListsInput } from "../../src/modules/pricing/input";
import { prepareCreatePriceListsWorkflow } from "../../src/workflows/pricing/create-price-lists";
import { prepareCreatePricePreferencesWorkflow } from "../../src/workflows/pricing/create-price-preferences";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { prepareProductCreationWorkflow } from "../../src/workflows/product/creation";
import { prepareSalesChannelCreationWorkflow } from "../../src/workflows/sales-channel/create";
import { prepareProductCategoryCreationWorkflow } from "../../src/workflows/product/category-workflows";
import { prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { compileStoreProductRequestFixtureCatalog } from "./store-product-request-catalog";

export async function prepareStoreProductRequestFixture(driver: "pglite" | "postgres", options: Readonly<{
  target?: Readonly<{ scopeUuid: string; epochUuid: string }>; physical?: CorePersistenceFixture;
}> = {}) {
  const { catalog, rows, target } = await Effect.runPromise(compileStoreProductRequestFixtureCatalog(options.target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: catalog.sources.map(source => ({ name: source.name,
    definition: source.definition, initialCommands: source.commands, initializationStepId: source.initialization.stepId, rows: rows[source.name] ?? [] })),
    eventDefinition: catalog.eventDefinition, ...(options.physical === undefined ? {} : { physical: options.physical }) });
  const use = <A, E>(work: (reads: StoreProductRequestReads) => Effect.Effect<A, E, Scope.Scope>) => fixture.run(Effect.scoped(
    fixture.useGeneration(generation => Effect.gen(function* () {
      const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 17, maximumPreparedBytes: 8 * 1024 * 1024 });
      const reads = yield* makeStoreProductRequestReads({ database: generation.database, hostRuntime, catalog,
        identityAndAccessPolicy: { profile: "native-store-product-proof" } });
      return yield* work(reads);
    }))));
  return { catalog, fixture, target, use };
}

export type StoreProductRequestFixture = Awaited<ReturnType<typeof prepareStoreProductRequestFixture>>;

const priceListsStep = createStep({ name: "native-store-seed-price-lists", compensation: "transactionCovered" },
  async (input: typeof PriceListsInput.Type, { container }) => {
    const service = container.resolve<IPricingModuleService>("pricing");
    return new StepResponse(await Reflect.apply(service.createPriceLists, service, [input]));
  });
const priceListsWorkflow = createWorkflow("native-store-seed-price-lists", (input: WorkflowData<typeof PriceListsInput.Type>) => new WorkflowResponse(priceListsStep(input)));

/** Real finite native owners seed the commerce graph once, before Store reads.
 * No Admin HTTP facade or private business rule is implemented by this helper. */
export async function seedStoreProductRequestFixture(tested: StoreProductRequestFixture, options: Readonly<{ singleChannel?: boolean; label?: string }> = {}) {
  const { fixture, catalog } = tested;
  const label = options.label ?? "Store";
  return fixture.run(Effect.scoped(Effect.gen(function* () {
    const common = { execution: fixture.execution, revision: "a".repeat(64), subscribers: [{ id: "native-store-product-seed", revision: "b".repeat(64) }] };
    const channels = yield* Effect.acquireRelease(prepareSalesChannelCreationWorkflow({ ...common,
      modules: { sales_channel: catalog.product.modules.sales_channel } }), host => host.close);
    yield* channels.run(channels.newRequestKey(), { salesChannelsData: [{ id: "sc_active", name: "Store active channel" },
      ...(options.singleChannel === true ? [] : [{ id: "sc_other", name: "Store other channel" }])] });
    const categories = yield* Effect.acquireRelease(prepareProductCategoryCreationWorkflow({ ...common, modules: catalog.product.categoryModules }), host => host.close);
    yield* categories.run(categories.newRequestKey(), { product_categories: [{ id: "pcat_store_public", name: "Store public", is_active: true },
      { id: "pcat_store_internal", name: "Store internal", is_active: true, is_internal: true }] });
    const create = yield* Effect.acquireRelease(prepareProductCreationWorkflow({ ...common, modules: catalog.product.modules, link: catalog.product.link }), host => host.close);
    const input = (name: string, amount: number, currency = "usd", managed = true, channel: string | null = "sc_active", status = "published") => ({
      id: `prod_store_${name}`, title: `${label} ${name}`, handle: `${label.toLowerCase()}-${name}`, status,
      ...(channel === null ? {} : { sales_channels: [{ id: channel }] }),
      ...(name === "base" ? { categories: [{ id: "pcat_store_public" }, { id: "pcat_store_internal" }] } : {}),
      options: [{ title: "Size", values: ["One"] }], variants: [{ id: `variant_store_${name}`, title: "One", sku: `store-${name}`,
        manage_inventory: managed, options: { Size: "One" }, prices: [{ amount, currency_code: currency },
          // Native isTaxInclusive uses Region preferences only for a selected
          // Price carrying that Region rule; retain the ordinary base Price.
          ...(name === "base" ? [{ amount, currency_code: currency, rules: { region_id: "reg_store_inclusive" } }] : [])] }],
    });
    const products = yield* create.run(create.newRequestKey(), { products: [input("base", 100), input("sale", 100), input("override", 100), input("null", 15, "eur", false)] });
    yield* create.run(create.newRequestKey(), { products: [input("draft", 999, "usd", false, "sc_active", "draft"),
      input("foreign", 777, "usd", false, options.singleChannel === true ? null : "sc_other")] });
    const priceLinks = yield* Effect.promise(() => fixture.readRows("variant_links"));
    const priceSet = (name: string) => {
      const found = priceLinks.find(row => row.variant_id === `variant_store_${name}` && typeof row.price_set_id === "string");
      if (typeof found?.price_set_id !== "string") throw new Error("Missing native Store seed PriceSet");
      return found.price_set_id;
    };
    const pricing = yield* makeLocalPricingCommands("price-list-creations");
    const pricingLink = yield* prepareVariantPricingLink();
    const nativeLists = yield* Effect.acquireRelease(prepareCreatePriceListsWorkflow({ ...common, modules: {
      pricing: { module: pricing.workflow, nativeStorage: catalog.product.modules.pricing.nativeStorage },
      link: { module: pricingLink.workflow, nativeStorage: catalog.product.modules.variant_links.nativeStorage },
    } }), host => host.close);
    const lists = yield* nativeLists.run(nativeLists.newRequestKey(), { price_lists_data: [
      { title: "Store sale", description: "Native regional sale", status: "active", rules: { region_id: ["reg_store_us"] },
        prices: [{ variant_id: "variant_store_sale", amount: 70, currency_code: "usd" }] },
      { title: "Store VIP", description: "Native customer group", status: "active", rules: { "customer.groups.id": ["cg_store_vip"] },
        prices: [{ variant_id: "variant_store_sale", amount: 60, currency_code: "usd" }] },
    ] });
    const pricingResources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: { module: pricing.workflow, methods: ["createPriceLists"], graph: false } }, true));
    const pricingWriter = yield* Effect.acquireRelease(prepareAtomicWorkflowHost({ ...common,
      modules: { pricing: { module: pricing.workflow, nativeStorage: catalog.product.modules.pricing.nativeStorage } },
      workflow: { name: "native-store-seed-price-lists", resources: pricingResources, prepared: yield* Effect.fromResult(priceListsWorkflow.prepare()),
        input: PriceListsInput, output: Schema.Json, events: internalModuleWorkflowEvents } }), host => host.close);
    yield* pricingWriter.run(pricingWriter.newRequestKey(), [
      { id: "plist_store_override", title: "Store override", description: "Native override above base", status: "active", type: "override",
        prices: [{ id: "price_store_override", price_set_id: priceSet("override"), amount: 120, currency_code: "usd" }] },
    ]);
    const preferences = yield* makeLocalPricingCommands("price-preferences");
    const preferenceWriter = yield* Effect.acquireRelease(prepareCreatePricePreferencesWorkflow({ ...common,
      pricing: { module: preferences.workflow, nativeStorage: catalog.product.modules.pricing.nativeStorage } }), host => host.close);
    yield* preferenceWriter.run(preferenceWriter.newRequestKey(), [
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false },
      { attribute: "region_id", value: "reg_store_inclusive", is_tax_inclusive: true },
    ]);
    const items = priceLinks.filter(row => typeof row.inventory_item_id === "string");
    const item = (name: string) => {
      const found = items.find(row => row.variant_id === `variant_store_${name}`);
      if (typeof found?.inventory_item_id !== "string") throw new Error("Missing native Store seed Inventory item");
      return found.inventory_item_id;
    };
    const inventory = yield* makeLocalInventoryCommands("stock"), stock = yield* makeStockLocationCommands("create");
    const member = { module: inventory.workflow, nativeStorage: catalog.product.modules.inventory.nativeStorage };
    const stocking = yield* Effect.acquireRelease(prepareInventoryStockingWorkflow({ ...common, modules: { inventory: member,
      stock_location: { module: stock.workflow, nativeStorage: catalog.product.modules.stock_location.nativeStorage } } }), host => host.close);
    yield* stocking.run(stocking.newRequestKey(), { locations: [{ id: "sloc_store_main", name: "Store primary stock" }, { id: "sloc_store_other", name: "Other channel stock" }],
      inventory_levels: [
        ...["base", "sale", "override"].map(name => ({ inventory_item_id: item(name), location_index: 0, stocked_quantity: 10 })),
        { inventory_item_id: item("base"), location_index: 1, stocked_quantity: 100 },
      ] });
    const reservation = yield* Effect.acquireRelease(prepareCreateReservationWorkflow({ ...common, inventory: member }), host => host.close);
    yield* reservation.run(reservation.newRequestKey(), { reservations: [{ inventory_item_id: item("base"), location_id: "sloc_store_main", quantity: 2 }] });
    return { products, lists, baseId: "prod_store_base", saleId: "prod_store_sale", overrideId: "prod_store_override", nullId: "prod_store_null",
      draftId: "prod_store_draft", foreignId: "prod_store_foreign", priceSets: { base: priceSet("base"), sale: priceSet("sale"), override: priceSet("override"), null: priceSet("null") },
      inventoryItems: { base: item("base"), sale: item("sale"), override: item("override") } };
  })));
}

/** Independent durable observation only after the prior owner fully drains. */
export async function observeStoreProductRequestFixture(input: Readonly<{ physical: CorePersistenceFixture; catalog: StoreProductRequestCatalog }>) {
  const persistence = await input.physical.reopen();
  return Effect.runPromise(Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, { schemaBundles: [input.catalog.bundle],
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Clock.currentTimeMillis.pipe(Effect.map(ms => BigInt(Math.floor(ms)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 }),
  database => readCoreNativeFixtureInventory(database, persistence), database => database.close())));
}
