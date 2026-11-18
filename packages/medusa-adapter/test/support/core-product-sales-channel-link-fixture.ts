import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { prepareProductSalesChannelLink } from "../../src/links/product-sales-channel-service";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

/** The selected native Product/Sales roots install only their three genuine
 * sources. Shared Core owners provide schema, lifecycle, roots and observations. */
export async function createCoreProductSalesChannelLinkFixture(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, physical?: CorePersistenceFixture) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const productRuntime = await Effect.runPromise(makeLocalProductCommands());
  const salesRuntime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const linkRuntime = await Effect.runPromise(prepareProductSalesChannelLink());
  const productDefinition = await Effect.runPromise(compileProductCoreDefinition(target));
  const salesDefinition = await Effect.runPromise(compileSalesChannelCoreDefinition(target));
  const linkDefinition = await Effect.runPromise(compileProductLinksCoreDefinition(target,
    { salesChannel: true, shippingProfile: false }));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
    ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }),
    sources: [
      { name: "product", definition: productDefinition, initialCommands: Object.values(productRuntime.commands), rows: [] },
      { name: "sales_channel", definition: salesDefinition, initialCommands: salesRuntime.commands, rows: [] },
      { name: "link", definition: linkDefinition, initialCommands: linkRuntime.commands, rows: [] },
    ] });
  close(fixture.close);
  const productReads = await fixture.run(fixture.openReadHost("product",
    [productRuntime.commands.internalProductList]));
  const salesReads = await fixture.run(fixture.openReadHost("sales_channel",
    [salesRuntime.list]));
  const linkReads = await fixture.run(fixture.openReadHost("link",
    [linkRuntime.list, linkRuntime.count, linkRuntime.links]));
  for (const reads of [productReads, salesReads, linkReads]) close(() => Effect.runPromise(reads.close));
  const product = { definition: productDefinition, runtime: productRuntime, source: fixture.source("product"), reads: productReads };
  const sales = { definition: salesDefinition, runtime: salesRuntime, source: fixture.source("sales_channel"), reads: salesReads };
  if (linkDefinition.source.definition.kind !== "relational") throw new Error("Expected the native relational Product Link source");
  const link = { definition: linkDefinition, schema: linkDefinition.source.definition.schema,
    runtime: linkRuntime, source: fixture.source("link"), reads: linkReads };
  const readPhysicalTables = () => fixture.physical.query("select tablename as name from pg_tables where schemaname = $1 order by tablename",
    [fixture.physical.namespace]);
  const physicalTablesBeforeCandidate = await readPhysicalTables();
  return { fixture, target, execution: fixture.execution, product, sales, link,
    snapshot: fixture.snapshot, readPhysicalTables, physicalTablesBeforeCandidate };
}

export type CoreProductSalesChannelLinkFixture = Awaited<ReturnType<typeof createCoreProductSalesChannelLinkFixture>>;
