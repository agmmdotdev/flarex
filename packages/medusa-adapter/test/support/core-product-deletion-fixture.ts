import { Effect, Result } from "effect";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { prepareProductDeletionLinkResource } from "../../src/links/product-deletion-resource";
import { prepareProductDeletionWorkflow, prepareProductVariantDeletionWorkflow,
  type ProductDeletionHooks, type ProductVariantDeletionHooks } from "../../src/workflows/product/deletion";
import { prepareCoreProductUpdate } from "./core-product-update-fixture";
import { creationRevision } from "./core-product-creation-fixture";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { workflowMethodDefinition } from "../../src/workflow/module";

/** Actual creation/update fixtures seed the graph; only the deletion facade
 * selects deletion capabilities. There is no fixture reconciliation algorithm. */
export async function prepareCoreProductDeletion(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareCoreProductUpdate>[2]) {
  const connected = await prepareCoreProductUpdate(driver, registerCleanup, shared);
  const inventory = await Effect.runPromise(makeLocalInventoryCommands("product-deletions"));
  const productLinks = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
  const variantLinks = await Effect.runPromise(prepareLocalVariantLinks("product-deletions"));
  const modules = {
    product: { module: connected.creation.product.runtime.productDeletionWorkflow, nativeStorage: connected.creation.product.source },
    inventory: { module: inventory.workflow, nativeStorage: connected.creation.inventory.inventory.source },
    pricing: { module: connected.pricing.runtime.workflow, nativeStorage: connected.pricing.source },
    product_links: { module: productLinks.workflow, nativeStorage: connected.productLinks.source },
    variant_links: { module: variantLinks.workflow, nativeStorage: connected.inventory.link.source },
  } satisfies Parameters<typeof prepareProductDeletionWorkflow>[0]["modules"];
  const link = Result.getOrThrow(prepareProductDeletionLinkResource({ sales: productLinks.nativeServices.sales,
    shipping: productLinks.nativeServices.shipping, inventory: variantLinks.nativeServices.inventory,
    pricing: variantLinks.nativeServices.pricing }, connected.pricing.runtime.workflow));
  const options = { execution: connected.execution, modules, link, revision: creationRevision("native-product-deletion"),
    subscribers: [{ id: "native-product-deletion", revision: "b".repeat(64) }] };
  const prepareProduct = async (hooks: ProductDeletionHooks = {}, execution = options.execution) => {
    const host = await Effect.runPromise(prepareProductDeletionWorkflow({ ...options, execution, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareVariant = async (hooks: ProductVariantDeletionHooks = {}, execution = options.execution) => {
    const host = await Effect.runPromise(prepareProductVariantDeletionWorkflow({ ...options, execution, hooks }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const seedStock = async (prefix: string, itemIds: readonly string[], quantity = 0, levelsPerItem = 2) => {
    const stock = await Effect.runPromise(makeLocalInventoryCommands("stock"));
    const participant = defineAtomicCommerceParticipant("inventory"), policy = stock.logicalEventPolicy();
    const names = ["inventory.inventory-level.created", "inventory.inventory-level.updated", "inventory.reservation-item.created"];
    const contracts = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
    const levels = defineAtomicCommerceCommand("productDeletionSeedLevels", (ctx, input) => ctx.call(participant, stock.createLevels, input));
    const reserve = defineAtomicCommerceCommand("productDeletionSeedReservation", (ctx, input) => ctx.call(participant, stock.reserve, input));
    const host = await Effect.runPromise(options.execution.prepare({ identityAndAccessPolicy: { seed: "product-deletion-stock" },
      participants: [{ participant, nativeStorage: connected.creation.inventory.inventory.source, commands: [stock.createLevels, stock.reserve],
        validateLogicalCall: policy.validateLogicalCall, events: { contracts: contracts.map(contract => contract.token), select: message => {
          const selected = isJsonObject(message) ? contracts.find(contract => contract.name === message.name) : undefined;
          return selected ? Effect.succeed(selected.token) : Effect.fail(commerceError("unadmittedEvent"));
        } } }], commands: [levels, reserve], events: { producerRevision: "a".repeat(64), contracts: contracts.map(contract => contract.token),
        subscribers: [{ id: "product-deletion-stock", revision: "b".repeat(64) }], validate: messages => messages.every(message => message.internal) ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) } }));
    try {
      const input = itemIds.flatMap(inventory_item_id => Array.from({ length: levelsPerItem }, (_, index) => ({ inventory_item_id,
        location_id: prefix + "-location-" + index, stocked_quantity: 100, incoming_quantity: 0 })));
      for (let offset = 0; offset < input.length; offset += 8) await Effect.runPromise(host.run(host.newRequestKey(), levels, input.slice(offset, offset + 8)));
      for (const inventory_item_id of itemIds) await Effect.runPromise(host.run(host.newRequestKey(), reserve,
        [{ inventory_item_id, location_id: prefix + "-location-0", quantity }]));
    } finally { await Effect.runPromise(host.close); }
  };
  const seedInventoryLink = async (variantId: string, itemId: string, operation: "attach" | "dismiss") => {
    const runtime = connected.inventory.link.runtime, policy = runtime.logicalEventPolicy(), participant = defineAtomicCommerceParticipant("variant_links");
    const selectedCommand = operation === "attach" ? runtime.create : runtime.nativeServices.inventory.dismiss;
    const selectedMethod = operation === "attach" ? runtime.workflow.methods.create : runtime.workflow.methods.inventoryNativeDismiss;
    if (selectedCommand === undefined || selectedMethod === undefined) throw new Error("Missing authentic Variant Link seed method");
    const method = workflowMethodDefinition(selectedMethod);
    if (method === undefined) throw new Error("Missing authentic Variant Link seed definition");
    const contracts = method.moduleEvents.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "a".repeat(64), internal: true, decode: policy.capture }) }));
    const command = defineAtomicCommerceCommand("productDeletionSeedInventoryLink", (ctx, input) => ctx.call(participant, selectedCommand, input));
    const host = await Effect.runPromise(options.execution.prepare({ identityAndAccessPolicy: { seed: "product-deletion-inventory-link", operation },
      participants: [{ participant, nativeStorage: connected.inventory.link.source, commands: [selectedCommand], validateLogicalCall: policy.validateLogicalCall,
        events: { contracts: contracts.map(contract => contract.token), select: message => {
          const selected = isJsonObject(message) ? contracts.find(contract => contract.name === message.name) : undefined;
          return selected ? Effect.succeed(selected.token) : Effect.fail(commerceError("unadmittedEvent"));
        } } }], commands: [command], events: { producerRevision: "a".repeat(64), contracts: contracts.map(contract => contract.token),
        subscribers: [{ id: "product-deletion-inventory-link", revision: "b".repeat(64) }], validate: messages => messages.every(message => message.internal) ? Effect.void : Effect.fail(commerceError("unadmittedEvent")) } }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), command, operation === "attach"
      ? [{ product: { variant_id: variantId }, inventory: { inventory_item_id: itemId }, data: { required_quantity: 1 } }]
      : [[variantId, itemId]])); }
    finally { await Effect.runPromise(host.close); }
  };
  const attachInventory = (variantId: string, itemId: string) => seedInventoryLink(variantId, itemId, "attach");
  const dismissInventory = (variantId: string, itemId: string) => seedInventoryLink(variantId, itemId, "dismiss");
  return { ...connected, inventoryDeletion: inventory, productDeletionLinks: productLinks, variantDeletionLinks: variantLinks,
    modules, link, options, prepareProduct, prepareVariant, seedStock, attachInventory, dismissInventory };
}
export type CoreProductDeletionFixture = Awaited<ReturnType<typeof prepareCoreProductDeletion>>;
