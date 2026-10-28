import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStoreCartReadCommands } from "../../src/modules/store/cart-read-service";
import { makeLocalRegionCartReadCommands } from "../../src/modules/region/cart-read-service";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { prepareCartContextReadWorkflow } from "../../src/workflows/cart/context-read";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

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
export async function prepareLogicalCartContextReads(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  storeMode: StoreMode = "defaults", shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>, label?: string) {
  const sources = { includeStore: true, includeRegion: true, includeSalesChannel: true };
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? sources : { ...sources, ...shared });
  const store = await Effect.runPromise(makeStoreCartReadCommands());
  const region = await Effect.runPromise(makeLocalRegionCartReadCommands());
  const sales = await Effect.runPromise(makeLocalSalesChannelCommands());
  type Definition = Pick<NonNullable<LogicalCurrencyFixture["storeDefinition"]>, "schema" | "provenance">;
  const initialize = async (key: string, definition: Definition | undefined,
    commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly Seed[]) => {
    if (definition === undefined) throw new Error("Missing Cart context source " + key);
    const seeded = label === undefined ? rows : rows.map(entry => ({ ...entry, row: { ...entry.row,
      ...(typeof entry.row.name === "string" ? { name: label + entry.row.name } : {}),
      ...(typeof entry.row.display_name === "string" ? { display_name: label + entry.row.display_name } : {}),
    } }));
    const values = definition.schema.tables.length === 1 ? seeded.map(entry => entry.row) : seeded;
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: values }, 1_048_576,
      { invalidInput: () => new Error("Invalid Cart context seed"), hashFailure: cause => new Error("Cart seed hash", { cause }) }));
    const input = { ...fixture.hostInput, commands, identityAndAccessPolicy: { profile: key + ".cart-context-test" },
      logicalStorage: { ...fixture.hostInput.logicalStorage,
        source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: key.toLowerCase() + ".cart-context-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } },
    } satisfies LogicalCommerceHostInput<unknown>;
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(values)); }
    finally { await Effect.runPromise(host.close); }
    return input.logicalStorage;
  };
  const salesStorage = await initialize("medusa.salesChannel", fixture.salesChannelDefinition, sales.commands,
    [cartContextRows.channel, cartContextRows.disabledChannel, cartContextRows.deletedChannel].map(row => ({ table: "sales_channel", row })));
  const regionStorage = await initialize("medusa.region", fixture.regionDefinition, region.commands, [
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
  const storeStorage = await initialize("medusa.store", fixture.storeDefinition, store.commands,
    storeMode === "none" ? [] : [storeZ, storeA, storeDeleted].map(row => ({ table: "store", row })));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = { store: { module: store.workflow, logicalStorage: storeStorage },
    region: { module: region.workflow, logicalStorage: regionStorage },
    sales_channel: { module: sales.cartReadWorkflow, logicalStorage: salesStorage } };
  const options: Parameters<typeof prepareCartContextReadWorkflow>[0] = { execution, modules,
    revision: createHash("sha256").update("native-cart-context-reads").digest("hex") };
  const prepare = async (selectedExecution = execution) => {
    const host = await Effect.runPromise(prepareCartContextReadWorkflow({ ...options, execution: selectedExecution }));
    close(() => Effect.runPromise(host.close));
    return host;
  };
  const snapshot = async () => {
    const value = await logicalCurrencyInventory(fixture);
    return { rows: value.rows, revisions: value.revisions, indexEntries: value.indexEntries, indexRevisions: value.indexRevisions,
      uniqueKeys: value.uniqueKeys, rowChanges: value.rowChanges, physicalFacts: value.physicalFacts, events: value.events };
  };
  return { fixture, store, region, sales, storeA, storeZ, options, prepare, snapshot };
}
