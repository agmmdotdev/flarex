import { Clock, Effect, Scope } from "effect";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { openCoreDatabase, type CoreDatabase } from "@flarex/persistence-postgres/internal/core";
import { makeAtomicCommerceNativeHost } from "@flarex/persistence-postgres/internal/commerce-native";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileProductRequestCatalog, makeProductRequestOperations, type ProductRequestCatalog, type ProductRequestOperations } from "../../src/http/product-request";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListWorkflowInput } from "../../src/modules/pricing/list-input";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { prepareSalesChannelCreationWorkflow, SalesChannelCreationInput } from "../../src/workflows/sales-channel/create";
import { prepareCreatePriceListsWorkflow } from "../../src/workflows/pricing/create-price-lists";
import { InventoryStockingInput, prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import type { ReservationCreates } from "../../src/modules/inventory/reservation-input";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";

const productRequestTarget = Object.freeze({
  scopeUuid: "f0000000-0000-4000-8000-000000000001",
  epochUuid: "f0000000-0000-4000-8000-000000000002",
});

export async function prepareProductRequestFixture(driver: "pglite" | "postgres", options: Readonly<{
  physical?: CorePersistenceFixture; target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
}> = {}) {
  const target = options.target ?? productRequestTarget;
  const catalog = await Effect.runPromise(compileProductRequestCatalog(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: catalog.sources.map(source => ({ name: source.name,
    definition: source.definition, initialCommands: source.commands, initializationStepId: source.initialization.stepId, rows: [] })),
    eventDefinition: catalog.eventDefinition, ...(options.physical === undefined ? {} : { physical: options.physical }) });
  const use = <A, E>(work: (operations: ProductRequestOperations) => Effect.Effect<A, E, Scope.Scope>) => fixture.run(fixture.useGeneration(generation => Effect.gen(function* () {
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 41, maximumPreparedBytes: 8 * 1024 * 1024 });
    const operations = yield* makeProductRequestOperations({ database: generation.database, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-admin-product-request" }, revision: "d".repeat(64),
      subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] });
    return yield* work(operations);
  })));
  return { fixture, catalog, target, use };
}

/** Use only after the prior app owner has fully drained. This independently
 * reopens the same durable instance and observes genuine Core rows/outcomes. */
type ProductRequestDatabaseInput = Readonly<{ physical: CorePersistenceFixture; catalog: ProductRequestCatalog }>;

async function useProductRequestDatabase<A, E>(input: ProductRequestDatabaseInput,
  work: (database: CoreDatabase, persistence: CorePersistenceFixture["persistence"]) => Effect.Effect<A, E, Scope.Scope>) {
  const persistence = await input.physical.reopen();
  return Effect.runPromise(Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, {
    schemaBundles: [input.catalog.bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2,
  }), database => work(database, persistence), database => database.close())));
}

export async function observeProductRequestFixture(input: ProductRequestDatabaseInput) {
  return useProductRequestDatabase(input, (database, persistence) => Effect.gen(function* () {
    const publishedTimestamp = yield* database.publishedTimestamp;
    const inventory = yield* readCoreNativeFixtureInventory(database, persistence, publishedTimestamp);
    const trackedTables = new Map<string, string>();
    const select = (sourceName: string, localName: string) => Effect.gen(function* () {
      const sources = input.catalog.sources.filter(source => source.name === sourceName);
      const source = sources[0];
      if (sources.length !== 1 || source === undefined)
        return yield* Effect.die(new Error(`Expected exactly one Product observer source: ${sourceName}`));
      const tables = source.definition.tables.filter(table => table.localName === localName || table.name === localName);
      const table = tables[0];
      if (tables.length !== 1 || table === undefined)
        return yield* Effect.die(new Error(`Expected exactly one Product observer table: ${sourceName}/${localName}`));
      trackedTables.set(table.name, localName);
      return yield* Effect.forEach(inventory.rows.filter(row => row.table === table.name), entry => Effect.fromResult(coreNativeRelationalRow(entry.value)));
    });
    const product = input.catalog.productRuntime.metadata;
    const products = yield* select("product", product.product.table.name);
    const options = yield* select("product", product.option.table.name);
    const optionValues = yield* select("product", product.value.table.name);
    const variants = yield* select("product", product.variant.table.name);
    const variantOptions = yield* select("product", product.pivot.table.name);
    const priceSets = yield* select("pricing", "price_set");
    const prices = yield* select("pricing", "price");
    const inventoryItems = yield* select("inventory", "inventory_item");
    const inventoryLevels = yield* select("inventory", "inventory_level");
    const reservations = yield* select("inventory", "reservation_item");
    const variantPriceSets = yield* select("variant_links", "product_variant_price_set");
    const variantInventoryItems = yield* select("variant_links", "product_variant_inventory_item");
    // Every timestamp is the actual current document-version timestamp from
    // this one fixed Core snapshot, suitable for comparison with its durable
    // nativeRoot outcome. No commit or relationship logic is reconstructed.
    const businessRows = inventory.rows.flatMap(entry => {
      const table = trackedTables.get(entry.table);
      return table === undefined ? [] : [{ table, timestamp: entry.timestamp }];
    });
    return { ...inventory, publishedTimestamp, businessRows, products, options, optionValues, variants, variantOptions,
      priceSets, prices, inventoryItems, inventoryLevels, reservations, variantPriceSets, variantInventoryItems };
  }));
}

/** Test composition only: the existing native host owns every seed operation. */
const prepareProductRequestSeedExecution = Effect.fn("ProductRequestFixture.prepareSeedExecution")(function* (
  input: ProductRequestDatabaseInput, database: CoreDatabase,
) {
  const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 8, maximumPreparedBytes: 8 * 1024 * 1024 });
  const generationScope = yield* Effect.scope;
  const execution: AtomicWorkflowExecution = {
    identityAndAccessPolicy: { profile: "native-product-prerequisite-fixture" },
    prepare: composition => Scope.provide(generationScope)(Effect.acquireRelease(makeAtomicCommerceNativeHost({ ...composition, database, hostRuntime,
      bundle: input.catalog.bundle, sources: input.catalog.sources, eventStorage: { definition: input.catalog.eventDefinition } }), host => host.close)),
  };
  return execution;
});

/** The DO owner must be fully drained before opening this trusted seed owner. */
export async function seedProductRequestAssociations(input: ProductRequestDatabaseInput & Readonly<{
  salesChannelsData?: typeof SalesChannelCreationInput.Type.salesChannelsData;
  priceListsData?: typeof PriceListWorkflowInput.Type.price_lists_data;
}>) {
  return useProductRequestDatabase(input, database => Effect.gen(function* () {
    const execution = yield* prepareProductRequestSeedExecution(input, database);
    const options = { execution, revision: "a".repeat(64), subscribers: [{ id: "product-association-fixture", revision: "b".repeat(64) }] };
    const { salesChannelsData, priceListsData } = input;
    const salesChannels = salesChannelsData === undefined ? [] : yield* Effect.gen(function* () {
      const workflow = yield* Effect.acquireRelease(prepareSalesChannelCreationWorkflow({ ...options,
        modules: { sales_channel: input.catalog.modules.sales_channel } }), workflow => workflow.close);
      return yield* workflow.run(workflow.newRequestKey(), { salesChannelsData });
    });
    const priceLists = priceListsData === undefined ? [] : yield* Effect.gen(function* () {
      const pricing = yield* makeLocalPricingCommands("price-list-creations"), link = yield* prepareVariantPricingLink();
      const workflow = yield* Effect.acquireRelease(prepareCreatePriceListsWorkflow({ ...options, modules: {
        pricing: { module: pricing.workflow, nativeStorage: input.catalog.modules.pricing.nativeStorage },
        link: { module: link.workflow, nativeStorage: input.catalog.modules.variant_links.nativeStorage },
      } }), workflow => workflow.close);
      return yield* workflow.run(workflow.newRequestKey(), { price_lists_data: priceListsData });
    });
    return { salesChannels, priceLists };
  }));
}

/** Trusted fixture seeding through the existing native Stock and Reservation
 * workflows, after the HTTP/DO owner has drained. No quantity logic lives here. */
export async function seedProductRequestInventory(input: ProductRequestDatabaseInput & Readonly<{
  stocking: typeof InventoryStockingInput.Type;
  reservationBatches?: readonly (typeof ReservationCreates.Type)[];
}>) {
  return useProductRequestDatabase(input, database => Effect.gen(function* () {
    const execution = yield* prepareProductRequestSeedExecution(input, database);
    const inventory = yield* makeLocalInventoryCommands("stock");
    const stock = yield* makeStockLocationCommands("create");
    const member = { module: inventory.workflow, nativeStorage: input.catalog.modules.inventory.nativeStorage };
    const options = { execution, revision: "a".repeat(64), subscribers: [{ id: "variant-quantity-fixture", revision: "b".repeat(64) }] };
    const stocking = yield* prepareInventoryStockingWorkflow({ ...options, modules: { inventory: member,
      stock_location: { module: stock.workflow, nativeStorage: input.catalog.modules.stock_location.nativeStorage } } });
    const result = yield* stocking.run(stocking.newRequestKey(), input.stocking);
    if (input.reservationBatches !== undefined && input.reservationBatches.length > 0) {
      const reservations = yield* prepareCreateReservationWorkflow({ ...options, inventory: member });
      for (const batch of input.reservationBatches) {
        yield* reservations.run(reservations.newRequestKey(), { reservations: batch });
      }
    }
    return result;
  }));
}
