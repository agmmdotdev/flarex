import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createSalesChannelsStep } from "@medusajs/core-flows/sales-channel/create-sales-channels-step";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands, SimpleSalesChannelInput } from "../../src/modules/sales-channel/service";
import { SalesChannelCreatedRow } from "../../src/modules/sales-channel/create-input";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationsInput, StockLocationsOutput } from "../../src/modules/stock-location/input";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../src/links/sales-channel-location-schema";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareStockLocationSalesChannelsWorkflow } from "../../src/workflows/stock-location/sales-channels";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowFixture } from "./core-native-workflow-fixture";

const revision = "9".repeat(64);
const subscribers = [{ id: "sales-channel-location", revision }];
const Seed = Schema.Struct({ channels: Schema.Array(SimpleSalesChannelInput).pipe(Schema.mutable).check(Schema.isMaxLength(8)), locations: StockLocationsInput });
const seedWorkflow = createWorkflow("seed-sales-channel-location-endpoints", (input: WorkflowData<typeof Seed.Type>) => {
  const channels = createSalesChannelsStep({ data: input.channels });
  const locations = createStockLocationsWorkflow.runAsStep({ input: { locations: input.locations } });
  return new WorkflowResponse({ channels, locations });
});
const SeedOutput = Schema.Struct({ channels: Schema.Array(SalesChannelCreatedRow).check(Schema.isMaxLength(8)),
  locations: StockLocationsOutput });

/** Source assembly is separate from installation so the deletion graph can
 * include its additional native sources in the same Core bundle. */
export const prepareCoreSalesChannelLocationSources = Effect.fn("CoreSalesChannelLocation.sources")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
) {
  const salesRuntime = yield* makeLocalSalesChannelCommands();
  const salesDefinition = yield* compileSalesChannelCoreDefinition(target);
  const stock = yield* makeStockLocationCommands("create");
  const stockDefinition = yield* compileStockLocationCoreDefinition(target);
  const link = yield* prepareSalesChannelLocationLink();
  const linkDefinition = yield* compileSalesChannelLocationLinkCoreDefinition(target);
  return { salesRuntime, salesDefinition, stock, stockDefinition, link, linkDefinition,
    sources: [
      { name: "sales_channel", definition: salesDefinition, initialCommands: salesRuntime.commands, rows: [] },
      { name: "stock_location", definition: stockDefinition, initialCommands: stock.commands, rows: [] },
      { name: "sales_channel_location_links", definition: linkDefinition, initialCommands: link.commands, rows: [] },
    ] };
});

/** Attach real native facades and seed workflows to an already composed Core
 * installation; this adds no installation or transaction owner. */
export async function attachCoreSalesChannelLocation(fixture: CoreNativeWorkflowFixture,
  selected: Pick<Effect.Success<ReturnType<typeof prepareCoreSalesChannelLocationSources>>,
    "salesRuntime" | "salesDefinition" | "stock" | "stockDefinition" | "link" | "linkDefinition">,
  close: (cleanup: () => Promise<void>) => void) {
  const { salesRuntime, salesDefinition, stock, stockDefinition, link, linkDefinition } = selected;
  const salesReads = await fixture.run(fixture.openReadHost("sales_channel", [salesRuntime.list, salesRuntime.count]));
  const reader = await fixture.run(fixture.openReadHost("sales_channel_location_links", [link.list, link.count]));
  const stockReader = await fixture.run(fixture.openReadHost("stock_location", [stock.count]));
  for (const host of [salesReads, reader, stockReader]) close(() => Effect.runPromise(host.close));
  const sales = { definition: salesDefinition, runtime: salesRuntime, source: fixture.source("sales_channel"), host: salesReads };
  const stockSource = fixture.source("stock_location"), linkSource = fixture.source("sales_channel_location_links");
  const execution = fixture.execution;
  const options = { execution, link: { module: link.workflow, nativeStorage: linkSource }, revision, subscribers };
  const workflow = await Effect.runPromise(prepareStockLocationSalesChannelsWorkflow(options));
  close(() => Effect.runPromise(workflow.close));
  const resources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
    sales_channel: { module: salesRuntime.workflow, methods: ["createSalesChannels"], graph: false },
    stock_location: { module: stock.workflow, methods: ["createStockLocations"], graph: false },
  }, true)));
  const seed = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision, subscribers,
    modules: { sales_channel: { module: salesRuntime.workflow, nativeStorage: sales.source },
      stock_location: { module: stock.workflow, nativeStorage: stockSource } },
    workflow: { name: "seedSalesChannelLocation", resources, prepared: await Effect.runPromise(Effect.fromResult(seedWorkflow.prepare())),
      input: Seed, output: SeedOutput, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(seed.close));
  return { fixture, sales, stock, stockDefinition, stockSource, stockReader, link, linkDefinition, linkSource, reader, execution, options, workflow, seed };
}

/** Attach only the selected native API profiles to their already issued
 * sources. Stock deletion uses this seed/read assembly inside its full graph. */
export async function prepareCoreSalesChannelLocationHosts(fixture: CoreNativeWorkflowFixture,
  close: (cleanup: () => Promise<void>) => void) {
  const definition = (name: string) => {
    const source = fixture.source(name);
    const selected = fixture.sources.find(entry => entry.source === source);
    if (selected === undefined) throw new Error("Missing installed native source: " + name);
    return selected.definition;
  };
  const salesRuntime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const stock = await Effect.runPromise(makeStockLocationCommands("create"));
  const link = await Effect.runPromise(prepareSalesChannelLocationLink());
  return attachCoreSalesChannelLocation(fixture, { salesRuntime, salesDefinition: definition("sales_channel"),
    stock, stockDefinition: definition("stock_location"), link, linkDefinition: definition("sales_channel_location_links") }, close);
}

export async function prepareCoreSalesChannelLocation(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void, shared?: CorePersistenceFixture) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const selected = await Effect.runPromise(prepareCoreSalesChannelLocationSources(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = shared === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: selected.sources, eventDefinition,
    ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  return { ...await attachCoreSalesChannelLocation(fixture, selected, close), target };
}
