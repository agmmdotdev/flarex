import { createHash, randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { getCommerceCommand, type CommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { capturePricingMetadata, compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compilePriceListCreationContracts } from "../../src/modules/pricing/list-input";
import { pricingListCreationPolicy } from "../../src/modules/pricing/list-creation-receipt";
import { compileInventoryCoreDefinition } from "../../src/modules/inventory/schema";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileShippingProfileCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalShippingProfileCommands } from "../../src/modules/fulfillment/shipping-profile-service";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { compileVariantLinksCoreDefinition } from "../../src/links/variant-definition";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { prepareProductShippingProfileWorkflow } from "../../src/workflows/product/shipping-profile";
import { prepareProductNativeLinkResource } from "../../src/links/product-resource";
import { workflowModuleDefinition } from "../../src/workflow/module";
import type { prepareProductCreationWorkflow } from "../../src/workflows/product/creation";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowFixture,
  type CoreNativeWorkflowFixtureOptions, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

export const creationRevision = (name: string) => createHash("sha256").update(name).digest("hex");
export interface CoreProductCreationFixtureOptions extends Pick<CoreNativeWorkflowFixtureOptions,
  "physical" | "wrapPersistence" | "extraSources" | "programs" | "maximumRequests"> {
  readonly target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
}

/** Read capabilities come from the installed source and its real command owner. */
export async function openCoreProductReadHost(fixture: CoreNativeWorkflowFixture, name: string,
  commands: readonly CommerceCommand[]) {
  return fixture.run(fixture.openReadHost(name, commands.filter(command => getCommerceCommand(command)?.mode === "read")));
}

/** All eight business sources share one genuine Core installation, application
 * owner and private event source. Native services supply every seed operation. */
export async function makeCoreProductCreationFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: CoreProductCreationFixtureOptions = {}) {
  const target = Object.freeze({ scopeUuid: options.target?.scopeUuid ?? randomUUID(), epochUuid: options.target?.epochUuid ?? randomUUID() });
  const productRuntime = await Effect.runPromise(makeLocalProductCommands());
  const pricingRuntime = await Effect.runPromise(makeLocalPricingCommands());
  const inventoryRuntime = await Effect.runPromise(makeLocalInventoryCommands());
  const stockRuntime = await Effect.runPromise(makeStockLocationCommands());
  const salesRuntime = await Effect.runPromise(makeLocalSalesChannelCommands());
  const shippingRuntime = await Effect.runPromise(makeLocalShippingProfileCommands());
  const productLinksRuntime = await Effect.runPromise(prepareLocalProductLinks());
  const variantLinksRuntime = await Effect.runPromise(prepareLocalVariantLinks());
  const productDefinition = await Effect.runPromise(compileProductCoreDefinition(target));
  const pricingDefinition = await Effect.runPromise(compilePricingCoreDefinition(target));
  const inventoryDefinition = await Effect.runPromise(compileInventoryCoreDefinition(target));
  const stockDefinition = await Effect.runPromise(compileStockLocationCoreDefinition(target));
  const salesDefinition = await Effect.runPromise(compileSalesChannelCoreDefinition(target));
  const shippingDefinition = await Effect.runPromise(compileShippingProfileCoreDefinition(target));
  const productLinksDefinition = await Effect.runPromise(compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true }));
  const variantLinksDefinition = await Effect.runPromise(compileVariantLinksCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const sources: readonly CoreNativeWorkflowSource[] = [
    { name: "product", definition: productDefinition, initialCommands: Object.values(productRuntime.commands), rows: [] },
    { name: "pricing", definition: pricingDefinition, initialCommands: pricingRuntime.commands, rows: [] },
    { name: "inventory", definition: inventoryDefinition, initialCommands: inventoryRuntime.commands, rows: [] },
    { name: "stock_location", definition: stockDefinition, initialCommands: stockRuntime.commands, rows: [] },
    { name: "sales_channel", definition: salesDefinition, initialCommands: salesRuntime.commands, rows: [] },
    { name: "fulfillment", definition: shippingDefinition, initialCommands: shippingRuntime.commands, rows: [] },
    { name: "product_links", definition: productLinksDefinition, initialCommands: productLinksRuntime.commands, rows: [] },
    { name: "variant_links", definition: variantLinksDefinition, initialCommands: variantLinksRuntime.commands, rows: [] },
  ];
  const physical = options.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(options.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources, eventDefinition,
    ...(physical === undefined ? {} : { physical }),
    ...(options.wrapPersistence === undefined ? {} : { wrapPersistence: options.wrapPersistence }),
    ...(options.extraSources === undefined ? {} : { extraSources: options.extraSources }),
    ...(options.programs === undefined ? {} : { programs: options.programs }),
    ...(options.maximumRequests === undefined ? {} : { maximumRequests: options.maximumRequests }) });
  close(fixture.close);
  const productReads = await openCoreProductReadHost(fixture, "product", Object.values(productRuntime.commands));
  const pricingReads = await openCoreProductReadHost(fixture, "pricing", pricingRuntime.commands);
  const inventoryReads = await openCoreProductReadHost(fixture, "inventory", inventoryRuntime.commands);
  const stockReads = await openCoreProductReadHost(fixture, "stock_location", stockRuntime.commands);
  const salesReads = await openCoreProductReadHost(fixture, "sales_channel", salesRuntime.commands);
  const shippingReads = await openCoreProductReadHost(fixture, "fulfillment", shippingRuntime.commands);
  const productLinksReads = await openCoreProductReadHost(fixture, "product_links", productLinksRuntime.commands);
  const variantLinksReads = await openCoreProductReadHost(fixture, "variant_links", variantLinksRuntime.commands);
  for (const reads of [productReads, pricingReads, inventoryReads, stockReads, salesReads, shippingReads, productLinksReads, variantLinksReads])
    close(() => Effect.runPromise(reads.close));
  const product = { definition: productDefinition, runtime: productRuntime, source: fixture.source("product"), reads: productReads, host: productReads };
  const pricing = { definition: pricingDefinition, runtime: pricingRuntime, source: fixture.source("pricing"), reads: pricingReads, host: pricingReads };
  const sales = { definition: salesDefinition, runtime: salesRuntime, source: fixture.source("sales_channel"), reads: salesReads, host: salesReads };
  const shipping = { definition: shippingDefinition, runtime: shippingRuntime, source: fixture.source("fulfillment"), reads: shippingReads, host: shippingReads };
  const productLinks = { definition: productLinksDefinition, runtime: productLinksRuntime, source: fixture.source("product_links"), reads: productLinksReads, host: productLinksReads };
  const inventory = {
    inventory: { definition: inventoryDefinition, runtime: inventoryRuntime, source: fixture.source("inventory"), reads: inventoryReads, host: inventoryReads },
    stockLocation: { definition: stockDefinition, runtime: stockRuntime, source: fixture.source("stock_location"), reads: stockReads, host: stockReads },
    link: { definition: variantLinksDefinition, runtime: variantLinksRuntime, source: fixture.source("variant_links"), reads: variantLinksReads, host: variantLinksReads },
  };
  const link = Result.getOrThrow(prepareProductNativeLinkResource([productLinksRuntime.nativeServices.sales,
    productLinksRuntime.nativeServices.shipping, variantLinksRuntime.nativeServices.inventory, variantLinksRuntime.nativeServices.pricing]));
  const readTable = async (sourceName: string, tableName?: string): Promise<readonly JsonObject[]> => {
    const source = sources.find(source => source.name === (tableName === undefined ? "product" : sourceName));
    const table = source?.definition.tables.find(table => (table.localName ?? table.name) === (tableName ?? sourceName));
    if (table === undefined) throw new Error("Unknown admitted native fixture table: " + sourceName + "/" + (tableName ?? sourceName));
    return (await fixture.inventory()).rows.filter(row => row.table === table.name)
      .map(row => structuredClone(Result.getOrThrow(coreNativeRelationalRow(row.value))));
  };
  return { fixture, target, product, pricing, sales, shipping, productLinks, inventory, link, readTable,
    execution: fixture.execution, snapshot: fixture.snapshot };
}
export type CoreProductCreationFixture = Awaited<ReturnType<typeof makeCoreProductCreationFixture>>;
export type CoreProductPricingFixture = Pick<CoreProductCreationFixture["pricing"], "definition" | "runtime" | "source">;
export const productCreationModules = (value: CoreProductCreationFixture) => ({
  product: { module: value.product.runtime.workflow, nativeStorage: value.product.source },
  pricing: { module: value.pricing.runtime.workflow, nativeStorage: value.pricing.source },
  inventory: { module: value.inventory.inventory.runtime.workflow, nativeStorage: value.inventory.inventory.source },
  stock_location: { module: value.inventory.stockLocation.runtime.workflow, nativeStorage: value.inventory.stockLocation.source },
  sales_channel: { module: value.sales.runtime.workflow, nativeStorage: value.sales.source },
  fulfillment: { module: value.shipping.runtime.workflow, nativeStorage: value.shipping.source },
  product_links: { module: value.productLinks.runtime.workflow, nativeStorage: value.productLinks.source },
  variant_links: { module: value.inventory.link.runtime.workflow, nativeStorage: value.inventory.link.source },
});
export const productCreationExecution = (value: CoreProductCreationFixture) => value.fixture.execution;
export const productCreationOptions = (value: CoreProductCreationFixture): Omit<Parameters<typeof prepareProductCreationWorkflow>[0], "hooks" | "modules"> & {
  readonly modules: ReturnType<typeof productCreationModules>;
} => ({ execution: productCreationExecution(value), modules: productCreationModules(value), link: value.link,
  revision: creationRevision("native-product-root"), subscribers: [{ id: "native-product-root", revision: "a".repeat(64) }] });

export async function seedCreationEndpoints(value: CoreProductCreationFixture, prefix = "root") {
  const modules = productCreationModules(value), label = prefix === "root" ? "Root" : prefix;
  const host = await Effect.runPromise(prepareProductShippingProfileWorkflow({ execution: productCreationExecution(value),
    modules: { product: modules.product, sales_channel: modules.sales_channel, fulfillment: modules.fulfillment,
      link: { module: value.productLinks.runtime.workflow, nativeStorage: value.productLinks.source } },
    revision: creationRevision("product-root-endpoint-setup"), subscribers: [{ id: "product-root-endpoint-setup", revision: "b".repeat(64) }] }));
  try {
    for (const index of [0, 1]) await Effect.runPromise(host.run(host.newRequestKey(), {
      shippingProfile: { id: prefix + "-profile-" + index, name: label + " profile " + index, type: "default" },
      salesChannel: { id: prefix + "-channel-" + index, name: label + " channel " + index },
      products: [{ id: (prefix === "root" ? "" : prefix + "-") + "endpoint-seed-product-" + index,
        title: (prefix === "root" ? "" : prefix + " ") + "Endpoint seed " + index }],
    }));
  } finally { await Effect.runPromise(host.close); }
}
export async function seedCreationReferences(value: CoreProductCreationFixture, prefix = "root") {
  const { commands, metadata, logicalPolicy } = value.product.runtime;
  const label = prefix === "root" ? "Root" : prefix;
  const entries = [
    [commands.createTypes, metadata.type.createdEvent, [{ id: prefix + "-type", value: label + " type" }]],
    [commands.createCollections, metadata.collection.createdEvent, [{ id: prefix + "-collection", title: label + " collection" }]],
    [commands.createTags, metadata.tag.createdEvent, Array.from({ length: 4 }, (_, index) => ({ id: prefix + "-tag-" + index, value: label + " tag " + index }))],
    [commands.createCategories, metadata.category.createdEvent, Array.from({ length: 4 }, (_, index) => ({ id: prefix + "-category-" + index, name: label + " category " + index }))],
  ] as const;
  const participant = defineAtomicCommerceParticipant("product");
  const contracts = entries.map(([, name]) => defineCommerceEventContract({ name, revision: "c".repeat(64), internal: true, decode: logicalPolicy.capture }));
  const contractsByName = new Map(entries.flatMap(([, name], index) => {
    const contract = contracts[index]; return contract ? [[name, contract] as const] : [];
  }));
  const roots = entries.map(([command], index) => defineAtomicCommerceCommand("seedProductReference" + index, (ctx, input) => ctx.call(participant, command, input)));
  const host = await Effect.runPromise(value.fixture.execution.prepare({ identityAndAccessPolicy: { seed: "product-references" }, requestCallLimit: 128,
    participants: [{ participant, nativeStorage: value.product.source, commands: entries.map(([command]) => command),
      validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: message => {
        const contract = isJsonObject(message) && typeof message.name === "string" ? contractsByName.get(message.name) : undefined;
        return contract ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent"));
      } } }], commands: roots,
    events: { producerRevision: "c".repeat(64), contracts, subscribers: [{ id: "product-root-reference-seed", revision: "c".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  try {
    for (const [index, [, , data]] of entries.entries()) {
      const root = roots[index]; if (!root) throw new Error("Missing reference seed root");
      await Effect.runPromise(host.run(host.newRequestKey(), root, data));
    }
  } finally { await Effect.runPromise(host.close); }
}

/** Genuine native Item/Level creation with its existing event and receipt policy. */
export async function prepareCoreInventoryCreateHost(fixture: CoreNativeWorkflowFixture,
  inventory: Pick<CoreProductCreationFixture["inventory"]["inventory"], "runtime" | "source">, kind: "items" | "levels" = "items") {
  const participant = defineAtomicCommerceParticipant("inventory"), policy = inventory.runtime.logicalEventPolicy();
  const name = kind === "levels" ? "inventory.inventory-level.created" : "inventory.inventory-item.created";
  const contract = defineCommerceEventContract({ name, revision: "1".repeat(64), internal: true, decode: policy.capture });
  const command = kind === "levels" ? inventory.runtime.createLevels : inventory.runtime.create;
  const create = defineAtomicCommerceCommand(kind === "levels" ? "nativeInventoryCreateLevels" : "nativeInventoryCreate", (ctx, input) => ctx.call(participant, command, input));
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: { seed: "inventory-" + kind },
    participants: [{ participant, nativeStorage: inventory.source, commands: inventory.runtime.commands,
      validateLogicalCall: policy.validateLogicalCall, events: { contracts: [contract], select: message =>
        isJsonObject(message) && message.name === name ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [create], events: { producerRevision: "1".repeat(64), contracts: [contract],
      subscribers: [{ id: "native-inventory-test", revision: "2".repeat(64) }], validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  return { host, create };
}

/** PriceList descendants are created by the real Pricing module, never SQL. */
export async function seedCorePricingLists(fixture: CoreNativeWorkflowFixture, pricing: CoreProductPricingFixture, input: Json): Promise<{
  result: Json; activity: Parameters<LogicalCommerceCallValidation>[1];
}> {
  if (workflowModuleDefinition(pricing.runtime.workflow)?.source.profile !== "pricing-product-updates")
    throw new Error("PriceList rule seeding requires the Product-update Pricing profile");
  const { frame } = await Effect.runPromise(capturePricingMetadata());
  const participant = defineAtomicCommerceParticipant("pricing"), policy = pricingListCreationPolicy(Result.getOrThrow(compilePriceListCreationContracts(frame)));
  const names = ["pricing.price-list.created", "pricing.price.created", "pricing.price-list-rule.created", "pricing.price-rule.created"];
  const contracts = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
  const command = defineAtomicCommerceCommand("pricingListSeed", (ctx, data) => ctx.call(participant, pricing.runtime.createList, data));
  let activity: Parameters<LogicalCommerceCallValidation>[1] | undefined;
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: { seed: "pricing-list" },
    participants: [{ participant, nativeStorage: pricing.source, commands: [pricing.runtime.createList],
      validateLogicalCall: (call, observed) => policy.validateLogicalCall(call, observed).pipe(Effect.tap(() => Effect.sync(() => { activity = observed; }))),
      events: { contracts: contracts.map(item => item.token), select: message => {
        const contract = isJsonObject(message) ? contracts.find(item => item.name === message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract.token);
      } } }], commands: [command], events: { producerRevision: "a".repeat(64), contracts: contracts.map(item => item.token),
      subscribers: [{ id: "pricing-list-seed", revision: "b".repeat(64) }], validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
  try {
    const result = await Effect.runPromise(host.run(host.newRequestKey(), command, input));
    if (activity === undefined) throw new Error("Missing native PriceList seed receipt");
    return { result, activity };
  } finally { await Effect.runPromise(host.close); }
}
