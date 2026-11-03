import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { makeStoreCartReadCommands } from "../../src/modules/store/cart-read-service";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { makeLocalRegionCartReadCommands } from "../../src/modules/region/cart-read-service";
import { compileRegionCoreDefinition } from "../../src/modules/region/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { prepareCartContextReadWorkflow } from "../../src/workflows/cart/context-read";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

const stamp = "2026-10-22T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
export const cartContextRows = {
  channel: { id: "sc-cart-context-a", name: "Cart Channel", description: "Native context", is_disabled: false,
    metadata: { selected: true }, ...managed },
  disabledChannel: { id: "sc-cart-context-disabled", name: "Disabled Channel", description: null, is_disabled: true,
    metadata: null, ...managed },
  deletedChannel: { id: "sc-cart-context-deleted", name: "Deleted Channel", description: null, is_disabled: false,
    metadata: null, ...managed, deleted_at: stamp },
  region: { id: "reg-cart-context-a", name: "Cart Region", currency_code: "usd", automatic_taxes: true,
    metadata: { selected: true }, ...managed },
  emptyRegion: { id: "reg-cart-context-empty", name: "No Countries", currency_code: "eur", automatic_taxes: false,
    metadata: null, ...managed },
  singleRegion: { id: "reg-cart-context-single", name: "One Country", currency_code: "mmk", automatic_taxes: true,
    metadata: null, ...managed },
  deletedRegion: { id: "reg-cart-context-deleted", name: "Deleted Region", currency_code: "eur", automatic_taxes: true,
    metadata: null, ...managed, deleted_at: stamp },
};
export const cartContextCountries = {
  us: { iso_2: "us", iso_3: "usa", num_code: "840", name: "UNITED STATES", display_name: "United States",
    region_id: cartContextRows.region.id, metadata: { selected: true }, ...managed },
  gb: { iso_2: "gb", iso_3: "gbr", num_code: "826", name: "UNITED KINGDOM", display_name: "United Kingdom",
    region_id: cartContextRows.region.id, metadata: null, ...managed },
  mm: { iso_2: "mm", iso_3: "mmr", num_code: "104", name: "MYANMAR", display_name: "Myanmar",
    region_id: cartContextRows.singleRegion.id, metadata: null, ...managed },
  deleted: { iso_2: "de", iso_3: "deu", num_code: "276", name: "GERMANY", display_name: "Germany",
    region_id: cartContextRows.region.id, metadata: null, ...managed, deleted_at: stamp },
  unrelated: { iso_2: "fr", iso_3: "fra", num_code: "250", name: "FRANCE", display_name: "France",
    region_id: cartContextRows.deletedRegion.id, metadata: null, ...managed },
  unassigned: { iso_2: "ca", iso_3: "can", num_code: "124", name: "CANADA", display_name: "Canada",
    region_id: null, metadata: null, ...managed },
};
type Seed = { readonly table: string; readonly row: JsonObject };
type StoreMode = "defaults" | "none" | "null-region" | "empty-region" | "null-channel";

/** Ordinary initialization provides existing endpoints. The actual selections
 * execute native steps, native services and stored Query under one host. */
export async function prepareCoreCartContextReads(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  storeMode: StoreMode = "defaults", physical?: CorePersistenceFixture, label?: string) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { store, region, sales, storeDefinition, regionDefinition, salesDefinition } = await Effect.runPromise(Effect.all({
    store: makeStoreCartReadCommands(),
    region: makeLocalRegionCartReadCommands(),
    sales: makeLocalSalesChannelCommands(),
    storeDefinition: compileStoreCoreDefinition(target),
    regionDefinition: compileRegionCoreDefinition(target),
    salesDefinition: compileSalesChannelCoreDefinition(target),
  }));
  const seed = (rows: readonly Seed[]) => label === undefined ? rows : rows.map(entry => ({ ...entry, row: { ...entry.row,
      ...(typeof entry.row.name === "string" ? { name: label + entry.row.name } : {}),
      ...(typeof entry.row.display_name === "string" ? { display_name: label + entry.row.display_name } : {}),
    } }));
  const salesRows = seed(
    [cartContextRows.channel, cartContextRows.disabledChannel, cartContextRows.deletedChannel].map(row => ({ table: "sales_channel", row })));
  const regionRows = seed([
    ...[cartContextRows.region, cartContextRows.emptyRegion, cartContextRows.singleRegion, cartContextRows.deletedRegion]
      .map(row => ({ table: "region", row })),
    ...Object.values(cartContextCountries).map(row => ({ table: "region_country", row })),
  ]);
  const storeA = { id: "store-cart-context-a", name: "First Store", default_region_id: storeMode === "null-region" ? null : storeMode === "empty-region" ? "" : cartContextRows.region.id,
    default_sales_channel_id: storeMode === "null-channel" ? null : cartContextRows.channel.id,
    default_location_id: null, metadata: { first: true }, ...managed };
  const storeZ = { ...storeA, id: "store-cart-context-z", name: "Later Store", default_region_id: cartContextRows.emptyRegion.id,
    default_sales_channel_id: cartContextRows.disabledChannel.id, metadata: null };
  const storeDeleted = { ...storeA, id: "store-cart-context-0", name: "Deleted First Store", deleted_at: stamp };
  const storeRows = seed(
    storeMode === "none" ? [] : [storeZ, storeA, storeDeleted].map(row => ({ table: "store", row })));
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: [
    { name: "store", definition: storeDefinition, initialCommands: store.commands, rows: storeRows },
    { name: "region", definition: regionDefinition, initialCommands: region.commands, rows: regionRows },
    { name: "sales_channel", definition: salesDefinition, initialCommands: sales.commands, rows: salesRows },
  ], ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }) });
  close(fixture.close);
  const modules = { store: { module: store.workflow, nativeStorage: fixture.source("store") },
    region: { module: region.workflow, nativeStorage: fixture.source("region") },
    sales_channel: { module: sales.cartReadWorkflow, nativeStorage: fixture.source("sales_channel") } };
  const options: Parameters<typeof prepareCartContextReadWorkflow>[0] = { execution: fixture.execution, modules,
    revision: createHash("sha256").update("native-cart-context-reads").digest("hex") };
  const prepare = async () => {
    const host = await Effect.runPromise(prepareCartContextReadWorkflow(options));
    close(() => Effect.runPromise(host.close));
    return host;
  };
  return { fixture, region, sales, options, prepare, snapshot: fixture.snapshot };
}
