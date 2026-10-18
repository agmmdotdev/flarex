import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteSalesChannelsWorkflow } from "@medusajs/core-flows/sales-channel/delete-sales-channels";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { workflowMethodDefinition } from "../../src/workflow/module";
import { makeStoreGuardCommands } from "../../src/modules/store/service";
import { prepareSalesChannelDeletionLinks } from "../../src/links/sales-channel-deletion";
import { prepareSalesChannelDeletionWorkflow, SalesChannelDeletionInput } from "../../src/workflows/sales-channel/delete";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalSalesChannelLocation } from "./logical-sales-channel-location-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalProductSalesChannelLinkHost } from "./logical-product-sales-channel-link-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
type Pair = readonly [string, string, Readonly<{ id: string }>];
type StoreSeed = Readonly<{ id: string; defaultSalesChannelId: string }>;
const deletion = Result.getOrThrow(deleteSalesChannelsWorkflow.prepare());
function nativeCompensator(name: string) {
  const node = deletion.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing retained native deletion compensator " + name);
  return node.compensate;
}
const restoreChannels = nativeCompensator("delete-sales-channels"), restoreLinks = nativeCompensator("remove-remote-links");

/** Native endpoint creation and both genuine Link families share the existing
 * source/initialization owners. Only Store uses canonical initial data, because
 * this read-only guard profile deliberately grants no Store mutation method. */
export async function prepareLogicalSalesChannelDeletion(
  driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }>;
    stores?: readonly StoreSeed[] }>,
) {
  const configuration = { includeProduct: true, includeSalesChannel: true, includeStockLocation: true,
    includeProductSalesChannelLink: true, includeSalesChannelLocationLink: true, includeStore: true };
  const fixture = await logicalCurrencyFixture(driver, close, options === undefined ? configuration : { ...configuration,
    resource: options.resource, fixtureIdentity: options.fixtureIdentity });
  const location = await prepareLogicalSalesChannelLocation(fixture, close);
  const product = await prepareLogicalProductHost(fixture);
  close(() => Effect.runPromise(product.host.close));
  await Effect.runPromise(product.host.initialize([]));
  const salesLinks = await prepareLogicalProductSalesChannelLinkHost(fixture);
  close(() => Effect.runPromise(salesLinks.host.close));
  await Effect.runPromise(salesLinks.host.initialize([]));
  const links = await Effect.runPromise(prepareSalesChannelDeletionLinks());
  const store = await Effect.runPromise(makeStoreGuardCommands());
  const storeDefinition = fixture.storeDefinition, stockDefinition = fixture.stockLocationDefinition;
  if (storeDefinition === undefined || stockDefinition === undefined) throw new Error("Missing Store/Stock Location sources");
  const dataset = async (rows: Json) => Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
    { invalidInput: () => new Error("Invalid deletion seed"), hashFailure: cause => new Error("Deletion seed hash", { cause }) }));
  const empty = await dataset([]);
  const sourceInput = (sourceKey: string, definition: typeof storeDefinition, commands: LogicalCommerceHostInput<unknown>["commands"]) => ({
    ...fixture.hostInput, identityAndAccessPolicy: { profile: sourceKey + ".sales-channel-deletion-test" }, commands,
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey, writeProfile: sourceKey, schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: sourceKey.toLowerCase() + ".empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } },
  } satisfies LogicalCommerceHostInput<unknown>);
  const stores = (options?.stores ?? []).map(value => ({ id: value.id, name: "Guard " + value.id,
    default_sales_channel_id: value.defaultSalesChannelId, default_region_id: null, default_location_id: null,
    metadata: null, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null }));
  const storeRows = stores.map(row => ({ table: "store", row }));
  const storeSeed = await dataset(storeRows);
  const baseStore = sourceInput("medusa.store", storeDefinition, store.commands);
  const storeInput = { ...baseStore, logicalStorage: { ...baseStore.logicalStorage,
    initialization: { stepId: "store-sales-channel-guard-initial", datasetSha256: storeSeed.sha256Hex, expectedRowCount: stores.length } } };
  const storeHost = await Effect.runPromise(makeCommerceHost(storeInput));
  try { await Effect.runPromise(storeHost.initialize(storeRows)); } finally { await Effect.runPromise(storeHost.close); }
  const stockInput = sourceInput("medusa.stockLocation", stockDefinition, location.stock.commands);
  const stockReader = await Effect.runPromise(makeCommerceHost(stockInput));
  close(() => Effect.runPromise(stockReader.close));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules: Parameters<typeof prepareSalesChannelDeletionWorkflow>[0]["modules"] = {
    store: { module: store.workflow, logicalStorage: storeInput.logicalStorage },
    sales_channel: { module: location.sales.runtime.deleteWorkflow, logicalStorage: location.sales.hostInput.logicalStorage },
    product_sales_channel_links: { module: links.sales.workflow, logicalStorage: salesLinks.hostInput.logicalStorage },
    sales_channel_location_links: { module: links.location.workflow, logicalStorage: location.linkInput.logicalStorage },
  };
  const workflowOptions = { execution, modules, link: links.resource,
    revision: revision("native-sales-channel-deletion-112"), subscribers: [{ id: "native-sales-channel-deletion", revision: "a".repeat(64) }] };
  const prepare = async (selectedRevision = workflowOptions.revision) => {
    const host = await Effect.runPromise(prepareSalesChannelDeletionWorkflow({ ...workflowOptions, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  // Test-only execution of the retained native compensators against genuine
  // borrowed module contexts. This is a fresh atomic probe, not independently
  // durable compensation or an additional production workflow admission.
  const prepareRestore = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      store: { module: modules.store.module, methods: ["listStores"], graph: false },
      sales_channel: { module: modules.sales_channel.module, methods: ["softDeleteSalesChannels", "restoreSalesChannels"], graph: false },
      product_sales_channel_links: { module: modules.product_sales_channel_links.module, methods: ["softDelete", "restore"], graph: false, expose: false },
      sales_channel_location_links: { module: modules.sales_channel_location_links.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    }, true, { link: links.resource }));
    const restore = createStep("invoke-retained-sales-channel-compensators", resources.callback(async (input: typeof SalesChannelDeletionInput.Type, context) => {
      await restoreChannels([...input.ids], context);
      await restoreLinks({ sales_channel: { sales_channel_id: [...input.ids] } }, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe-retained-sales-channel-compensation", (input: WorkflowData<typeof SalesChannelDeletionInput.Type>) =>
      new WorkflowResponse(restore(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules, operationScheduling: "queued",
      revision: revision("retained-sales-channel-compensation-probe"), subscribers: [{ id: "retained-sales-channel-compensation-probe", revision: "d".repeat(64) }],
      workflow: { name: "probeRetainedSalesChannelCompensation", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: SalesChannelDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };

  const participants = { sales: defineAtomicCommerceParticipant("productLinks"), location: defineAtomicCommerceParticipant("locationLinks") };
  const entries = [
    { participant: participants.sales, logicalStorage: salesLinks.hostInput.logicalStorage, native: links.nativeServices.sales, policy: links.sales.logicalEventPolicy() },
    { participant: participants.location, logicalStorage: location.linkInput.logicalStorage, native: links.nativeServices.location, policy: links.location.logicalEventPolicy() },
  ];
  const contracts = entries.flatMap(entry => {
    const method = workflowMethodDefinition(entry.native.createMethod);
    if (method === undefined) throw new Error("Missing native Link creation token");
    return method.moduleEvents.map(name => ({ name, token: defineCommerceEventContract({ name, revision: revision("deletion-link-seeds"), internal: true, decode: entry.policy.capture }) }));
  });
  const seedLinks = defineAtomicCommerceCommand("seedSalesChannelDeletionLinks", (ctx, input) => Effect.gen(function* () {
    if (!isJsonObject(input) || !Array.isArray(input.sales) || !Array.isArray(input.location)) return yield* Effect.fail(commerceError("invalidInput"));
    yield* ctx.call(participants.sales, links.nativeServices.sales.create, input.sales);
    yield* ctx.call(participants.location, links.nativeServices.location.create, input.location);
    return null;
  }));
  const linkSeedHost = await Effect.runPromise(execution.prepare({ identityAndAccessPolicy: { seed: "native-sales-channel-deletion-links" },
    participants: entries.map(entry => ({ participant: entry.participant, logicalStorage: entry.logicalStorage, commands: [entry.native.create],
      validateLogicalCall: entry.policy.validateLogicalCall, events: { contracts: contracts.map(contract => contract.token), select: message => {
        const selected = isJsonObject(message) ? contracts.find(contract => contract.name === message.name) : undefined;
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected.token);
      } } })), commands: [seedLinks], events: { producerRevision: revision("deletion-link-seeds"), contracts: contracts.map(contract => contract.token),
      subscribers: [{ id: "deletion-link-seeds", revision: "b".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  close(() => Effect.runPromise(linkSeedHost.close));
  const attach = async (sales: readonly Pair[], locations: readonly Pair[]) => {
    for (let offset = 0; offset < Math.max(sales.length, locations.length); offset += 8)
      await Effect.runPromise(linkSeedHost.run(linkSeedHost.newRequestKey(), seedLinks, {
        sales: sales.slice(offset, offset + 8).map(([left, right, extra]) => [left, right, { ...extra }]),
        location: locations.slice(offset, offset + 8).map(([left, right, extra]) => [left, right, { ...extra }]),
      }));
  };
  const seed = async (prefix: string, channelCount = 1, productsPerChannel = 1, locationsPerChannel = 1) => {
    const channels = Array.from({ length: channelCount }, (_, index) => prefix + "-channel-" + index);
    const products = Array.from({ length: productsPerChannel }, (_, index) => prefix + "-product-" + index);
    const locations = Array.from({ length: locationsPerChannel }, (_, index) => prefix + "-location-" + index);
    for (let offset = 0; offset < Math.max(channels.length, locations.length); offset += 4)
      await Effect.runPromise(location.seed.run(location.seed.newRequestKey(), {
        channels: channels.slice(offset, offset + 4).map(id => ({ id, name: id })),
        locations: locations.slice(offset, offset + 4).map(id => ({ id, name: id })),
      }));
    for (let offset = 0; offset < products.length; offset += 4)
      await Effect.runPromise(product.host.run(product.host.newRequestKey(), product.runtime.commands.internalProductCreate,
        products.slice(offset, offset + 4).map(id => ({ id, title: id, handle: id }))));
    const sales: Pair[] = channels.flatMap(channel => products.map(id => [id, channel, { id: prefix + "-product-link-" + channel + "-" + id }]));
    const stock: Pair[] = channels.flatMap(channel => locations.map(id => [channel, id, { id: prefix + "-location-link-" + channel + "-" + id }]));
    await attach(sales, stock);
    return { channels, products, locations, productLinks: sales.map(([, , extra]) => extra.id), locationLinks: stock.map(([, , extra]) => extra.id) };
  };
  const readChannels = (ids: readonly string[], withDeleted = false) => Effect.runPromise(location.sales.host.read(location.sales.runtime.list,
    { filters: { id: [...ids] }, config: { withDeleted, take: 256, order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows)));
  const readProductLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(salesLinks.host.read(salesLinks.runtime.list,
    { filters: { sales_channel_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readLocationLinks = (ids: readonly string[], withDeleted = false) => Effect.runPromise(location.reader.read(location.link.list,
    { filters: { sales_channel_id: [...ids] }, config: { withDeleted, take: 256 } }).pipe(Effect.flatMap(decodeRows)));
  const readProducts = (ids: readonly string[]) => Effect.runPromise(product.host.read(product.runtime.commands.internalProductList,
    { filters: { id: [...ids] }, config: { take: 256, withDeleted: true } }).pipe(Effect.flatMap(decodeRows)));
  const readLocations = (ids: readonly string[]) => Effect.runPromise(stockReader.read(location.stock.count,
    { filters: { id: [...ids] }, config: { take: 256 } }).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]))(value)), Effect.map(([rows]) => rows)));
  return { fixture, links,
    prepare, prepareRestore, seed, attach, readChannels, readProductLinks, readLocationLinks, readProducts, readLocations };
}
