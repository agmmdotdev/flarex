import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createSalesChannelsStep } from "@medusajs/core-flows/sales-channel/create-sales-channels-step";
import { createStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/create-stock-locations";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { StockLocationsInput } from "../../src/modules/stock-location/input";
import { SimpleSalesChannelInput } from "../../src/modules/sales-channel/service";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareStockLocationSalesChannelsWorkflow } from "../../src/workflows/stock-location/sales-channels";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";
import type { CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

const revision = "9".repeat(64);
const subscribers = [{ id: "sales-channel-location", revision }];
const Seed = Schema.Struct({ channels: Schema.Array(SimpleSalesChannelInput).pipe(Schema.mutable).check(Schema.isMaxLength(8)), locations: StockLocationsInput });
const seedWorkflow = createWorkflow("seed-sales-channel-location-endpoints", (input: WorkflowData<typeof Seed.Type>) => {
  const channels = createSalesChannelsStep({ data: input.channels });
  const locations = createStockLocationsWorkflow.runAsStep({ input: { locations: input.locations } });
  return new WorkflowResponse({ channels, locations });
});
const SeedRows = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
const SeedOutput = Schema.Struct({ channels: SeedRows, locations: SeedRows });

export interface LogicalSalesChannelLocationFixture {
  readonly fixture: LogicalCurrencyFixture;
  readonly sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  readonly stock: Effect.Success<ReturnType<typeof makeStockLocationCommands>>;
  readonly link: Effect.Success<ReturnType<typeof prepareSalesChannelLocationLink>>;
  readonly linkInput: LogicalCommerceHostInput<unknown>;
  readonly reader: CommerceHost;
  readonly options: Parameters<typeof prepareStockLocationSalesChannelsWorkflow>[0];
  readonly workflow: Effect.Success<ReturnType<typeof prepareStockLocationSalesChannelsWorkflow>>;
  readonly seed: { readonly newRequestKey: () => string; readonly close: Effect.Effect<void>;
    readonly run: (key: string, input: typeof Seed.Type) => Effect.Effect<typeof SeedOutput.Type, CommerceTransactionError> };
}

/** Test composition of existing native endpoint owners and the new Link source. */
export async function prepareLogicalSalesChannelLocation(fixture: LogicalCurrencyFixture, close: (cleanup: () => Promise<void>) => void): Promise<LogicalSalesChannelLocationFixture> {
  const sales = await prepareLogicalSalesChannelHost(fixture);
  close(() => Effect.runPromise(sales.host.close));
  await Effect.runPromise(sales.host.initialize([]));
  const stock = await Effect.runPromise(makeStockLocationCommands("create"));
  const link = await Effect.runPromise(prepareSalesChannelLocationLink());
  const stockDefinition = fixture.stockLocationDefinition, linkDefinition = fixture.salesChannelLocationLinkDefinition;
  if (stockDefinition === undefined || linkDefinition === undefined) throw new Error("Missing Sales Channel Location source set");
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid Link seed"), hashFailure: cause => new Error("Link seed hash", { cause }) }));
  const inputFor = (key: string, definition: typeof linkDefinition, commands: LogicalCommerceHostInput<unknown>["commands"]) => ({
    ...fixture.hostInput, identityAndAccessPolicy: { profile: key + ".internal-test" }, commands,
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: key, writeProfile: key, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: key.toLowerCase() + ".empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } },
  } satisfies LogicalCommerceHostInput<unknown>);
  const stockInput = inputFor("medusa.stockLocation", stockDefinition, stock.commands);
  const linkInput = inputFor("medusa.link.salesChannelLocation", linkDefinition, link.commands);
  const reader = await Effect.runPromise(makeCommerceHost(linkInput));
  close(() => Effect.runPromise(reader.close));
  await Effect.runPromise(reader.initialize([]));
  const stockHost = await Effect.runPromise(makeCommerceHost(stockInput));
  try { await Effect.runPromise(stockHost.initialize([])); } finally { await Effect.runPromise(stockHost.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options = { execution, link: { module: link.workflow, logicalStorage: linkInput.logicalStorage }, revision, subscribers };
  const workflow = await Effect.runPromise(prepareStockLocationSalesChannelsWorkflow(options));
  close(() => Effect.runPromise(workflow.close));
  const resources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
    sales_channel: { module: sales.runtime.workflow, methods: ["createSalesChannels"], graph: false },
    stock_location: { module: stock.workflow, methods: ["createStockLocations"], graph: false },
  }, true)));
  const seed = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, revision, subscribers,
    modules: { sales_channel: { module: sales.runtime.workflow, logicalStorage: sales.hostInput.logicalStorage },
      stock_location: { module: stock.workflow, logicalStorage: stockInput.logicalStorage } },
    workflow: { name: "seedSalesChannelLocation", resources, prepared: await Effect.runPromise(Effect.fromResult(seedWorkflow.prepare())),
      input: Seed, output: SeedOutput, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(seed.close));
  return { fixture, sales, stock, link, linkInput, reader, options, workflow, seed };
}
