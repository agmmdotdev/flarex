import { Effect, Result } from "effect";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { prepareProductDeletionLinkResource } from "../../src/links/product-deletion-resource";
import { prepareProductDeletionWorkflow, prepareProductVariantDeletionWorkflow,
  type ProductDeletionHooks, type ProductVariantDeletionHooks } from "../../src/workflows/product/deletion";
import { prepareLogicalProductUpdate } from "./logical-product-update-fixture";
import { creationRevision } from "./logical-product-creation-fixture";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { workflowMethodDefinition } from "../../src/workflow/module";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";

type Connected = Awaited<ReturnType<typeof prepareLogicalProductUpdate>>;
type ProductOptions = Omit<Parameters<typeof prepareProductDeletionWorkflow>[0], "hooks">;
export interface LogicalProductDeletionFixture extends Omit<Connected, "modules" | "link" | "options"> {
  readonly inventoryDeletion: Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>;
  readonly productDeletionLinks: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
  readonly variantDeletionLinks: Effect.Success<ReturnType<typeof prepareLocalVariantLinks>>;
  readonly modules: ProductOptions["modules"];
  readonly link: ProductOptions["link"];
  readonly options: ProductOptions;
  readonly prepareProduct: (hooks?: ProductDeletionHooks, execution?: AtomicWorkflowExecution) => Promise<Effect.Success<ReturnType<typeof prepareProductDeletionWorkflow>>>;
  readonly prepareVariant: (hooks?: ProductVariantDeletionHooks, execution?: AtomicWorkflowExecution) => Promise<Effect.Success<ReturnType<typeof prepareProductVariantDeletionWorkflow>>>;
  readonly seedStock: (prefix: string, itemIds: readonly string[], quantity?: number, levelsPerItem?: number) => Promise<void>;
  readonly attachInventory: (variantId: string, itemId: string) => Promise<void>;
  readonly dismissInventory: (variantId: string, itemId: string) => Promise<void>;
}

/** Actual creation/update fixtures seed the graph; only the deletion facade
 * selects deletion capabilities. There is no fixture reconciliation algorithm. */
export async function prepareLogicalProductDeletion(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalProductUpdate>[2]): Promise<LogicalProductDeletionFixture> {
  const connected = await prepareLogicalProductUpdate(driver, registerCleanup, shared);
  const inventory = await Effect.runPromise(makeLocalInventoryCommands("product-deletions"));
  const productLinks = await Effect.runPromise(prepareLocalProductLinks("product-deletions"));
  const variantLinks = await Effect.runPromise(prepareLocalVariantLinks("product-deletions"));
  const modules: ProductOptions["modules"] = {
    product: { module: connected.creation.product.runtime.productDeletionWorkflow, logicalStorage: connected.creation.product.hostInput.logicalStorage },
    inventory: { module: inventory.workflow, logicalStorage: connected.creation.inventory.inventory.hostInput.logicalStorage },
    pricing: { module: connected.pricing.runtime.workflow, logicalStorage: connected.pricing.hostInput.logicalStorage },
    product_links: { module: productLinks.workflow, logicalStorage: connected.productLinks.hostInput.logicalStorage },
    variant_links: { module: variantLinks.workflow, logicalStorage: connected.inventory.link.hostInput.logicalStorage },
  };
  const link = Result.getOrThrow(prepareProductDeletionLinkResource({ sales: productLinks.nativeServices.sales,
    shipping: productLinks.nativeServices.shipping, inventory: variantLinks.nativeServices.inventory,
    pricing: variantLinks.nativeServices.pricing }, connected.pricing.runtime.workflow));
  const options: ProductOptions = { execution: connected.execution, modules, link, revision: creationRevision("native-product-deletion"),
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
      participants: [{ participant, logicalStorage: modules.inventory.logicalStorage, commands: [stock.createLevels, stock.reserve],
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
      participants: [{ participant, logicalStorage: modules.variant_links.logicalStorage, commands: [selectedCommand], validateLogicalCall: policy.validateLogicalCall,
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
