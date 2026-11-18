import { createHash, randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteSalesChannelsWorkflow } from "@medusajs/core-flows/sales-channel/delete-sales-channels";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { workflowMethodDefinition } from "../../src/workflow/module";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { prepareProductSalesChannelLink } from "../../src/links/product-sales-channel-service";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { makeStoreGuardCommands } from "../../src/modules/store/service";
import { prepareSalesChannelDeletionLinks } from "../../src/links/sales-channel-deletion";
import { prepareSalesChannelDeletionWorkflow, SalesChannelDeletionInput } from "../../src/workflows/sales-channel/delete";
import { attachCoreSalesChannelLocation, prepareCoreSalesChannelLocationSources } from "./core-sales-channel-location-fixture";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";

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

/** The full native deletion graph uses one Core installation. Store receives
 * its actual read guard and initial data, without a Store mutation facade. */
export async function prepareCoreSalesChannelDeletion(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void,
  options: Readonly<{ physical?: CorePersistenceFixture; stores?: readonly StoreSeed[] }> = {}) {
  const target = Object.freeze({ scopeUuid: randomUUID(), epochUuid: randomUUID() });
  const selected = await Effect.runPromise(prepareCoreSalesChannelLocationSources(target));
  const productRuntime = await Effect.runPromise(makeLocalProductCommands());
  const productDefinition = await Effect.runPromise(compileProductCoreDefinition(target));
  const salesLinksRuntime = await Effect.runPromise(prepareProductSalesChannelLink());
  const productLinksDefinition = await Effect.runPromise(compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: false }));
  const store = await Effect.runPromise(makeStoreGuardCommands());
  const storeDefinition = await Effect.runPromise(compileStoreCoreDefinition(target));
  const stores = (options.stores ?? []).map(value => ({ id: value.id, name: "Guard " + value.id,
    default_sales_channel_id: value.defaultSalesChannelId, default_region_id: null, default_location_id: null,
    metadata: null, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null }));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    ...selected.sources,
    { name: "product", definition: productDefinition, initialCommands: Object.values(productRuntime.commands), rows: [] },
    { name: "product_sales_channel_links", definition: productLinksDefinition, initialCommands: salesLinksRuntime.commands, rows: [] },
    { name: "store", definition: storeDefinition, initialCommands: store.commands, rows: stores.map(row => ({ table: "store", row })) },
  ], ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const location = await attachCoreSalesChannelLocation(fixture, selected, close);
  const productHost = await fixture.run(fixture.openReadHost("product", [productRuntime.commands.internalProductList]));
  const salesLinkHost = await fixture.run(fixture.openReadHost("product_sales_channel_links", [salesLinksRuntime.list]));
  for (const host of [productHost, salesLinkHost]) close(() => Effect.runPromise(host.close));
  const product = { runtime: productRuntime, source: fixture.source("product"), host: productHost };
  const salesLinks = { runtime: salesLinksRuntime, source: fixture.source("product_sales_channel_links"), host: salesLinkHost };
  const links = await Effect.runPromise(prepareSalesChannelDeletionLinks());
  const storeSource = fixture.source("store"), stockReader = location.stockReader;
  const execution = fixture.execution;
  const productParticipant = defineAtomicCommerceParticipant("productSeed");
  const createProducts = defineAtomicCommerceCommand("seedSalesChannelDeletionProducts", (ctx, input) =>
    ctx.call(productParticipant, productRuntime.commands.internalProductCreate, input));
  const productSeedHost = await Effect.runPromise(execution.prepare({
    identityAndAccessPolicy: { seed: "native-sales-channel-deletion-products" },
    participants: [{ participant: productParticipant, nativeStorage: product.source, commands: [productRuntime.commands.internalProductCreate] }],
    commands: [createProducts],
  }));
  close(() => Effect.runPromise(productSeedHost.close));
  const modules: Parameters<typeof prepareSalesChannelDeletionWorkflow>[0]["modules"] = {
    store: { module: store.workflow, nativeStorage: storeSource },
    sales_channel: { module: location.sales.runtime.deleteWorkflow, nativeStorage: location.sales.source },
    product_sales_channel_links: { module: links.sales.workflow, nativeStorage: salesLinks.source },
    sales_channel_location_links: { module: links.location.workflow, nativeStorage: location.linkSource },
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
    { participant: participants.sales, nativeStorage: salesLinks.source, native: links.nativeServices.sales, policy: links.sales.logicalEventPolicy() },
    { participant: participants.location, nativeStorage: location.linkSource, native: links.nativeServices.location, policy: links.location.logicalEventPolicy() },
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
    participants: entries.map(entry => ({ participant: entry.participant, nativeStorage: entry.nativeStorage, commands: [entry.native.create],
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
      await Effect.runPromise(productSeedHost.run(productSeedHost.newRequestKey(), createProducts,
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
  return { fixture, target, location, links,
    prepare, prepareRestore, seed, attach, readChannels, readProductLinks, readLocationLinks, readProducts, readLocations };
}
