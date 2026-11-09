import { Clock, Effect, type Scope } from "effect";
import { makePreparedHostRuntime } from "@flarex/persistence-postgres/internal/prepared-host-runtime";
import { openCoreDatabase } from "@flarex/persistence-postgres/internal/core";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileProductRequestCatalog, makeProductRequestOperations, type ProductRequestCatalog, type ProductRequestOperations } from "../../src/http/product-request";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";

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
    const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
    const operations = yield* makeProductRequestOperations({ database: generation.database, hostRuntime, catalog,
      identityAndAccessPolicy: { profile: "native-admin-product-request" }, revision: "d".repeat(64),
      subscribers: [{ id: "native-admin-product-request", revision: "e".repeat(64) }] });
    return yield* work(operations);
  })));
  return { fixture, catalog, target, use };
}

/** Use only after the prior app owner has fully drained. This independently
 * reopens the same durable instance and observes genuine Core rows/outcomes. */
export async function observeProductRequestFixture(input: Readonly<{ physical: CorePersistenceFixture; catalog: ProductRequestCatalog }>) {
  const persistence = await input.physical.reopen();
  return Effect.runPromise(Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, {
    schemaBundles: [input.catalog.bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
    randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2,
  }), database => Effect.gen(function* () {
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
      priceSets, prices, inventoryItems, variantPriceSets, variantInventoryItems };
  }), database => database.close())));
}
