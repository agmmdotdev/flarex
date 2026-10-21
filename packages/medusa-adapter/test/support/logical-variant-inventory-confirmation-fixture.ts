import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { prepareVariantInventoryConfirmationWorkflow } from "../../src/workflows/cart/variant-inventory-confirmation";
import { prepareStockAdjustmentsWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { makeInventoryConfirmationCommands } from "../../src/modules/inventory/confirmation-service";
import { makeInventoryItemDeletionCommands } from "../../src/modules/inventory/delete-item-service";
import { InventoryItemDeletionInput, InventoryItemDeletionOutput } from "../../src/modules/inventory/delete-item-input";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { InventoryConfirmationLocations } from "../../src/modules/inventory/confirmation-input";
import { VariantInventoryLinkRows } from "../../src/links/variant-service";
import { ScalarId } from "../../src/repository/scalar-id-read";
import { prepareInventoryCreateHost } from "./logical-inventory-fixture";
import { prepareLogicalVariantItemPricing } from "./logical-variant-item-pricing-fixture";
import { creationRevision } from "./logical-product-creation-fixture";

const LinkTuples = Schema.Array(Schema.Tuple([ScalarId, ScalarId, Schema.Struct({ required_quantity: Schema.Literal(1) })]));
const VariantFlags = Schema.Struct({ id: ScalarId, allow_backorder: Schema.optionalKey(Schema.Boolean), manage_inventory: Schema.optionalKey(Schema.Boolean) });
const DirectInput = Schema.Struct({ inventory_item_id: ScalarId, location_ids: InventoryConfirmationLocations, quantity: Schema.String });

/** Reuse 159's actual native Product, Pricing, Inventory, Location and Link
 * setup. Every stock change below is another genuine admitted native workflow. */
export async function prepareLogicalVariantInventoryConfirmation(driver: "pglite" | "postgres",
  close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalVariantItemPricing(driver, close);
  const prepare = async (requestCallLimit?: number, execution: AtomicWorkflowExecution = base.execution) => {
    // Candidate/default witnesses alter only the trusted test host seam. The
    // public workflow factory always selects its named allowance internally.
    const selectedExecution: AtomicWorkflowExecution = requestCallLimit === undefined ? execution : {
      ...execution, prepare: composition => {
        const { requestCallLimit: _selectedAllowance, ...retained } = composition;
        return execution.prepare({ ...retained, requestCallLimit });
      },
    };
    const host = await Effect.runPromise(prepareVariantInventoryConfirmationWorkflow({ execution: selectedExecution,
      modules: { ...base.creationModules,
        pricing: { module: base.pricingRead.workflow, logicalStorage: base.creationModules.pricing.logicalStorage },
        inventory: { module: base.inventoryRead.workflow, logicalStorage: base.creationModules.inventory.logicalStorage },
        sales_channel_locations: { module: base.channelLocations.link.workflow,
          logicalStorage: base.channelLocations.linkInput.logicalStorage } },
      revision: creationRevision("native-variant-inventory-confirmation"),
    }));
    return host;
  };
  const adjust = async (input: Parameters<Effect.Success<ReturnType<typeof prepareStockAdjustmentsWorkflow>>["run"]>[1]) => {
    const host = await Effect.runPromise(prepareStockAdjustmentsWorkflow({ execution: base.execution,
      inventory: { module: base.stockInventory.workflow, logicalStorage: base.creationModules.inventory.logicalStorage },
      revision: creationRevision("variant-confirmation-stock-setup"),
      subscribers: [{ id: "variant-confirmation-stock-setup", revision: creationRevision("variant-confirmation-stock-subscriber") }],
    }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), input)); }
    finally { await Effect.runPromise(host.close); }
  };
  const attachInventory = async (input: typeof LinkTuples.Type) => {
    const module = base.creation.inventory.link.runtime.workflow;
    const resources = Result.getOrThrow(prepareWorkflowResources({ variant_links: { module, methods: ["inventoryNativeCreate"], graph: false } }, true));
    // These extra Links intentionally use the native DML default of one.
    // Omit the optional extras instead of widening its metadata-erased type.
    const call = createStep("seed-confirmation-native-inventory-link", resources.callback((rows: typeof LinkTuples.Type, { resources }) =>
      resources.variant_links.inventoryNativeCreate(rows.map((row): [string, string] => [row[0], row[1]]))));
    const flow = createWorkflow("seed-confirmation-inventory-links", (input: WorkflowData<typeof LinkTuples.Type>) => new WorkflowResponse(call(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { variant_links: base.creationModules.variant_links },
      revision: creationRevision("confirmation-inventory-links-setup"), subscribers: [{ id: "confirmation-links", revision: creationRevision("confirmation-links-subscriber") }],
      workflow: { name: "seedConfirmationInventoryLinks", resources, prepared: Result.getOrThrow(flow.prepare()), input: LinkTuples,
        output: VariantInventoryLinkRows.check(Schema.makeFilter(rows => rows.every(row => row.required_quantity === 1))),
        events: internalModuleWorkflowEvents } }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), input)); }
    finally { await Effect.runPromise(host.close); }
  };
  const updateVariant = async (input: typeof VariantFlags.Type) => {
    const module = base.creation.product.runtime.variantUpdateWorkflow;
    const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module, methods: ["updateProductVariants"], graph: false } }, true));
    const call = createStep("seed-confirmation-native-variant-flags", resources.callback((value: typeof VariantFlags.Type, { resources }) => {
      const { id, ...update } = value;
      return resources.product.updateProductVariants({ id }, update);
    }));
    const flow = createWorkflow("seed-confirmation-variant-flags", (input: WorkflowData<typeof VariantFlags.Type>) => new WorkflowResponse(call(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution, modules: { product: { ...base.creationModules.product, module } },
      revision: creationRevision("confirmation-variant-flags-setup"), subscribers: [{ id: "confirmation-flags", revision: creationRevision("confirmation-flags-subscriber") }],
      workflow: { name: "seedConfirmationVariantFlags", resources, prepared: Result.getOrThrow(flow.prepare()), input: VariantFlags,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), input)); }
    finally { await Effect.runPromise(host.close); }
  };
  const createItem = async (id: string) => {
    const writer = await prepareInventoryCreateHost(base.fixture, base.creation.inventory.inventory);
    try { return await Effect.runPromise(writer.host.run(writer.host.newRequestKey(), writer.create, { id, sku: id, requires_shipping: false })); }
    finally { await Effect.runPromise(writer.host.close); }
  };
  const prepareDirect = async () => {
    const confirmation = await Effect.runPromise(makeInventoryConfirmationCommands());
    const resources = Result.getOrThrow(prepareWorkflowResources({ inventory_commands: {
      module: confirmation.workflow, methods: ["confirmInventory"], graph: false, expose: false,
    } }, false, { inventory: confirmation.resource }));
    const call = createStep("native-direct-inventory-confirmation", resources.callback((value: typeof DirectInput.Type, { resources }) =>
      resources.inventory.confirmInventory(value.inventory_item_id, value.location_ids, value.quantity)));
    const flow = createWorkflow("native-direct-inventory-confirmation-root", (input: WorkflowData<typeof DirectInput.Type>) => new WorkflowResponse(call(input)));
    return await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { inventory_commands: { module: confirmation.workflow, logicalStorage: base.creationModules.inventory.logicalStorage } },
      revision: creationRevision("direct-confirmation"),
      workflow: { name: "nativeDirectInventoryConfirmation", resources, prepared: Result.getOrThrow(flow.prepare()), input: DirectInput, output: Schema.Boolean } }));
  };
  const softDeleteItemPreservingLinks = async (id: string) => {
    const deletion = await Effect.runPromise(makeInventoryItemDeletionCommands());
    const resources = Result.getOrThrow(prepareWorkflowResources({ inventory: {
      module: deletion.workflow, methods: ["softDeleteInventoryItems"], graph: false,
    } }, true));
    const call = createStep("seed-confirmation-native-item-soft-delete", resources.callback((ids: typeof InventoryItemDeletionInput.Type, { resources }) =>
      resources.inventory.softDeleteInventoryItems(ids)));
    const flow = createWorkflow("seed-confirmation-item-soft-delete", (ids: WorkflowData<typeof InventoryItemDeletionInput.Type>) => new WorkflowResponse(call(ids)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: base.execution,
      modules: { inventory: { module: deletion.workflow, logicalStorage: base.creationModules.inventory.logicalStorage } },
      revision: creationRevision("confirmation-item-soft-delete-setup"),
      subscribers: [{ id: "confirmation-soft-delete", revision: creationRevision("confirmation-soft-delete-subscriber") }],
      workflow: { name: "seedConfirmationItemSoftDelete", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: InventoryItemDeletionInput, output: InventoryItemDeletionOutput, events: internalModuleWorkflowEvents } }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), [id])); }
    finally { await Effect.runPromise(host.close); }
  };
  const readInventoryLinks = async (variantId: string) => {
    const link = base.creation.inventory.link;
    const reader = await Effect.runPromise(makeCommerceHost({ ...link.hostInput, commands: [link.runtime.countInventory] }));
    try {
      const result = await Effect.runPromise(reader.read(link.runtime.countInventory, { filters: { variant_id: variantId },
        config: { select: ["id", "variant_id", "inventory_item_id", "required_quantity", "deleted_at"], relations: [],
          withDeleted: true, take: 8, skip: 0, order: { variant_id: "ASC" } } }));
      return Schema.decodeUnknownSync(Schema.Tuple([VariantInventoryLinkRows, Schema.Number]))(result);
    } finally { await Effect.runPromise(reader.close); }
  };
  const seedCompletePricing = async (prefix: string, layout: "split-sets" | "one-set-bands" | "two-sets") => {
    const regionId = prefix + "-region", groupId = prefix + "-group", customerId = prefix + "-customer";
    const seed = await base.seed(prefix, { variantCount: 4, prices: [
      { currency_code: "usd", amount: 10 },
      { currency_code: "usd", amount: 8, min_quantity: 2, max_quantity: 10, rules: { is_custom_price: "false" } },
    ] });
    const selected = seed.priceSetLinks.find(link => link.variant_id === seed.variants[0]?.id);
    if (selected === undefined) throw new Error("Missing genuine first Variant Price Set");
    // This is explicit native fixture data, not a second selection algorithm.
    // Split Sets reproduces 159's complete combined maximum. Other layouts
    // keep all four Lists relevant to one Set through two quantity bands, or
    // to each of two Sets with one Price per Set.
    const listInput = [0, 1, 2, 3].map((index): Parameters<typeof base.seedPriceLists>[0][number] => ({
      id: prefix + "-list-" + index, title: "Combined confirmation List " + index, description: "Complete native Pricing and Inventory cohort",
      status: "active", type: index < 2 ? "sale" : "override",
      rules: { "customer.groups.id": [groupId], custom_segment159: ["vip159"] },
      prices: layout === "split-sets"
        ? seed.priceSetLinks.slice((index % 2) * 2, (index % 2) * 2 + 2).map(link => ({
          price_set_id: link.price_set_id, currency_code: "usd", amount: index < 2 ? 7 : 15,
          rules: { region_id: regionId, is_custom_price: "false" },
        }))
        : layout === "two-sets"
          ? seed.priceSetLinks.filter(link => seed.variants.slice(0, 2).some(variant => variant.id === link.variant_id)).map(link => ({
            price_set_id: link.price_set_id, currency_code: "usd", amount: index === 0 ? 7 : index === 1 ? 9 : 15,
            rules: { region_id: regionId, is_custom_price: "false" },
          }))
          : [0, 1].map(band => ({ price_set_id: selected.price_set_id, currency_code: "usd",
          amount: index === 0 ? 7 : index === 1 ? 9 : 15,
          min_quantity: band === 0 ? 1 : 2, max_quantity: band === 0 ? 1 : 4,
          rules: { region_id: regionId, is_custom_price: "false" },
        })),
    }));
    const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
    const lists = objects(await base.seedPriceLists(listInput));
    const listPrices = lists.flatMap(list => objects(list.prices).map(price => ({ list, price })));
    const preferences = await base.seedContextPreferences([
      { attribute: "region_id", value: regionId, is_tax_inclusive: true },
      { attribute: "currency_code", value: "usd", is_tax_inclusive: false },
    ]);
    const cart = { id: prefix + "-cart", currency_code: "usd", region_id: regionId, customer_id: customerId,
      customer: { id: customerId, groups: [{ id: groupId }] },
      region: { id: regionId, currency_code: "usd", name: "Combined confirmation region" } };
    return { seed, lists, listPrices, preferences, cart, setPricingContextResult: { custom_segment159: "vip159" } };
  };
  return { ...base, prepare, adjust, attachInventory, updateVariant, createItem, prepareDirect, softDeleteItemPreservingLinks, readInventoryLinks, seedCompletePricing };
}
