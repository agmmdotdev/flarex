import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductVariantsStep } from "@medusajs/core-flows/product/create-product-variants-step";
import { updatePricePreferencesAsArrayStep } from "@medusajs/core-flows/pricing/update-price-preferences-as-array-step";
import { makeLocalInventoryCommands, InventoryItemsOutput } from "../../src/modules/inventory/service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { BasePriceInput, PriceListsInput, PricePreferencesInput } from "../../src/modules/pricing/input";
import { InventoryLevelsOutput } from "../../src/modules/inventory/level-input";
import { StorePreferencePair } from "../../src/modules/pricing/preference-input";
import { prepareProductCreationWorkflow, ProductCreationOutput } from "../../src/workflows/product/creation";
import { prepareInventoryStockingWorkflow } from "../../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../../src/workflows/inventory/adjust-and-reserve";
import { prepareCreatePricePreferencesWorkflow } from "../../src/workflows/pricing/create-price-preferences";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { connectProductCreation, creationRevision, productCreationExecution, productCreationModules,
  productCreationOptions, seedCreationEndpoints, seedCreationReferences } from "./logical-product-creation-fixture";
import { prepareInventoryCreateHost } from "./logical-inventory-fixture";
import { prepareLogicalSalesChannelLocation } from "./logical-sales-channel-location-fixture";
import { prepareLogicalPricingHost, seedLogicalPricingLists } from "./logical-pricing-fixture";

const PriceSetLinks = Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String, price_set_id: Schema.String }));
const InventoryLinks = Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String,
  inventory_item_id: Schema.String, required_quantity: Schema.Number }));
const UnpricedVariants = Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String,
  title: Schema.String, options: Schema.Record(Schema.String, Schema.String) })).pipe(Schema.mutable).check(Schema.isMaxLength(1));
const unpricedVariantWorkflow = createWorkflow("seed-native-unpriced-variant159", (input: WorkflowData<typeof UnpricedVariants.Type>) =>
  new WorkflowResponse(createProductVariantsStep(input)));
const ContextPreferences = Schema.Array(Schema.Struct({ ...StorePreferencePair.fields, is_tax_inclusive: Schema.Boolean }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(2));
const contextPreferencesWorkflow = createWorkflow("seed-native-context-preferences159", (input: WorkflowData<typeof ContextPreferences.Type>) =>
  new WorkflowResponse(updatePricePreferencesAsArrayStep(input)));

/** Genuine native roots seed every owner used by the default Variant projection.
 * Setup outputs retain native identities and exact numeric companions; expected
 * read results belong to the workflow tests, not to another fixture graph. */
export async function prepareLogicalVariantItemPricing(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: { readonly resource: LogicalCurrencyFixture["resource"];
    readonly fixtureIdentity: { readonly deploymentId: string; readonly projectId: string; readonly uuidOffset: number } }) {
  const configuration = { includeProduct: true, includePricing: true, includeVariantInventory: true,
    includeSalesChannel: true, includeShippingProfile: true, includeProductSalesChannelLink: true,
    includeProductShippingProfileLink: true, includeSalesChannelLocationLink: true };
  const fixture = await (shared === undefined ? logicalCurrencyFixture(driver, registerCleanup, configuration)
    : logicalCurrencyFixture(driver, registerCleanup, { ...configuration, ...shared }));
  const creation = await connectProductCreation(fixture);
  const creationModules = productCreationModules(creation);
  const execution = productCreationExecution(creation);
  const channelLocations = await prepareLogicalSalesChannelLocation(fixture, registerCleanup);
  const pricingRead = await Effect.runPromise(makeLocalPricingCommands("variant-item-pricing"));
  const inventoryRead = await Effect.runPromise(makeLocalInventoryCommands("variant-price-calculation"));
  const stockInventory = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  const subscribers = [{ id: "variant-item-pricing-setup", revision: creationRevision("variant-item-pricing-setup") }];
  const stocking = await Effect.runPromise(prepareInventoryStockingWorkflow({ execution,
    modules: { inventory: { module: stockInventory.workflow, logicalStorage: creationModules.inventory.logicalStorage },
      stock_location: { module: channelLocations.stock.workflow, logicalStorage: creationModules.stock_location.logicalStorage } },
    revision: creationRevision("variant-item-pricing-stocking"), subscribers }));
  registerCleanup(() => Effect.runPromise(stocking.close));
  const reservations = await Effect.runPromise(prepareCreateReservationWorkflow({ execution,
    inventory: { module: stockInventory.workflow, logicalStorage: creationModules.inventory.logicalStorage },
    revision: creationRevision("variant-item-pricing-reservation"), subscribers }));
  registerCleanup(() => Effect.runPromise(reservations.close));
  await seedCreationEndpoints(creation);
  await seedCreationReferences(creation);
  const seedPriceLists = async (data: typeof PriceListsInput.Type) => {
    const pricing = await prepareLogicalPricingHost(fixture, "product-updates");
    try { return (await seedLogicalPricingLists(fixture, pricing, data)).result; }
    finally { await Effect.runPromise(pricing.host.close); }
  };
  const seedPricePreferences = async (data: typeof PricePreferencesInput.Type) => {
    const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
    const host = await Effect.runPromise(prepareCreatePricePreferencesWorkflow({ execution,
      pricing: { module: pricing.workflow, logicalStorage: creationModules.pricing.logicalStorage },
      revision: creationRevision("variant-item-pricing-preferences-setup"), subscribers }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), data)); }
    finally { await Effect.runPromise(host.close); }
  };
  const seedContextPreferences = async (data: typeof ContextPreferences.Type) => {
    const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
    const resources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({ pricing: {
      module: pricing.workflow, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false,
    } }, true)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: { pricing: { module: pricing.workflow, logicalStorage: creationModules.pricing.logicalStorage } },
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      revision: creationRevision("variant-item-pricing-context-preferences-setup"), subscribers,
      workflow: { name: "seedNativeContextPreferences159", resources,
        prepared: await Effect.runPromise(Effect.fromResult(contextPreferencesWorkflow.prepare())),
        input: ContextPreferences, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), data)); }
    finally { await Effect.runPromise(host.close); }
  };
  const seedUnpricedVariant = async (productId: string, variantId: string) => {
    const resources = await Effect.runPromise(Effect.fromResult(prepareWorkflowResources({
      product: { module: creationModules.product.module, methods: ["createProductVariants"], graph: false },
    }, true)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution,
      modules: { product: creationModules.product }, revision: creationRevision("variant-item-pricing-unpriced-setup"), subscribers,
      workflow: { name: "seedNativeUnpricedVariant159", resources,
        prepared: await Effect.runPromise(Effect.fromResult(unpricedVariantWorkflow.prepare())),
        input: UnpricedVariants, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    try {
      return await Effect.runPromise(host.run(host.newRequestKey(), [{ id: variantId, product_id: productId,
        title: "Unpriced native Variant", options: { Size: "1" } }]));
    } finally { await Effect.runPromise(host.close); }
  };

  const seed = async (prefix: string, options: { readonly variantCount?: 1 | 4; readonly status?: "published" | "draft";
    readonly optionalRelations?: boolean; readonly prices?: ReadonlyArray<typeof BasePriceInput.Type> } = {}) => {
    const variantCount = options.variantCount ?? 1;
    const itemCount = variantCount === 4 ? 4 : 2;
    const locationCount = variantCount === 4 ? 4 : 2;
    const itemHost = await prepareInventoryCreateHost(fixture, creation.inventory.inventory);
    let items: typeof InventoryItemsOutput.Type;
    try {
      const created = await Effect.runPromise(itemHost.host.run(itemHost.host.newRequestKey(), itemHost.create,
        Array.from({ length: itemCount }, (_, index) => ({ id: prefix + "-inventory-" + index, sku: prefix + "-item-" + index,
          title: prefix + " inventory " + index, requires_shipping: index === 0, weight: index + 1,
          origin_country: "us", material: "cotton", metadata: { fixture159: index } }))));
      items = await Effect.runPromise(Schema.decodeUnknownEffect(InventoryItemsOutput)(created));
    } finally { await Effect.runPromise(itemHost.host.close); }

    let priceSetLinks: typeof PriceSetLinks.Type = [];
    let inventoryLinks: typeof InventoryLinks.Type = [];
    const productHost = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(creation), hooks: {
      productsCreated: async ({ products }, { resources }) => {
        const variantIds = products.flatMap(product => product.variants.map(variant => variant.id));
        const pricing = await resources.query.graph({ entity: "product_variant_price_set", fields: ["id", "variant_id", "price_set_id"],
          filters: { variant_id: variantIds }, pagination: { take: 4 } });
        priceSetLinks = [...priceSetLinks, ...await Effect.runPromise(Schema.decodeUnknownEffect(PriceSetLinks)(pricing.data))];
        const inventory = await resources.query.graph({ entity: "product_variant_inventory_item",
          fields: ["id", "variant_id", "inventory_item_id", "required_quantity"],
          filters: { variant_id: variantIds }, pagination: { take: 8 } });
        inventoryLinks = [...inventoryLinks, ...await Effect.runPromise(Schema.decodeUnknownEffect(InventoryLinks)(inventory.data))];
      },
    } }));
    let products: typeof ProductCreationOutput.Type = [];
    try {
      // Independent native setup roots keep their existing Product deadline.
      // The read under test still receives its complete four-Variant cohort.
      for (let index = 0; index < variantCount; index++) {
        const first = items[index % items.length], second = items[(index + 1) % items.length];
        if (first === undefined || second === undefined) throw new Error("Native Inventory setup omitted a required Item");
        const suffix = variantCount === 1 ? "" : "-" + index;
        const request = { products: [{
          id: prefix + "-product" + suffix, title: prefix + " Product" + (variantCount === 1 ? "" : " " + index),
          handle: prefix + "-handle" + suffix, status: options.status ?? "published",
          description: "Native Variant price calculation fixture", subtitle: "Native Product details", thumbnail: "https://example.test/159/thumbnail.png",
          ...(options.optionalRelations === false ? {} : { type_id: "root-type", collection_id: "root-collection" }),
          discountable: false, weight: 12, length: 2, height: 3, width: 4,
          origin_country: "us", material: "cotton", metadata: { fixture159: prefix },
          options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
          sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
          variants: [{ id: prefix + "-variant-" + index, title: prefix + " Variant " + index, sku: prefix + "-sku-" + index,
            options: { Size: String(index) }, manage_inventory: true, allow_backorder: false,
            inventory_items: [{ inventory_item_id: first.id, required_quantity: 2 }, { inventory_item_id: second.id, required_quantity: 3 }],
            prices: [...(options.prices ?? [{ currency_code: "usd", amount: 10 }])] }],
        }] };
        const created = await Effect.runPromise(productHost.run(productHost.newRequestKey(), request));
        const firstProduct = created[0];
        if (firstProduct === undefined || created.length !== 1 || firstProduct.variants.length !== 1)
          throw new Error("Native single-Product setup omitted its original Product or Variant output");
        products = [...products, firstProduct];
      }
    } finally { await Effect.runPromise(productHost.close); }
    const variants = products.flatMap(product => product.variants);
    if (priceSetLinks.length !== variants.length || inventoryLinks.length !== variants.length * 2)
      throw new Error("Native Product setup omitted its Pricing or rich Inventory Links");

    const firstStock = await Effect.runPromise(stocking.run(stocking.newRequestKey(), {
      locations: Array.from({ length: locationCount }, (_, index) => ({ id: prefix + "-location-" + index,
        name: prefix + " Location " + index, address: { address_1: index + " Native Street", country_code: "us", city: "Native City" },
        metadata: { fixture159: index } })),
      inventory_levels: items.slice(0, 2).flatMap(item => Array.from({ length: locationCount }, (_, index) => ({
        inventory_item_id: item.id, location_index: index, stocked_quantity: 20.5 + index, incoming_quantity: 1.25,
      }))),
    }));
    const levels: Array<(typeof InventoryLevelsOutput.Type)[number]> = [...firstStock.inventory_levels];
    if (items.length > 2) {
      const secondStock = await Effect.runPromise(stocking.run(stocking.newRequestKey(), { locations: [],
        inventory_levels: items.slice(2).flatMap(item => firstStock.locations.map((location, index) => ({
          inventory_item_id: item.id, location_id: location.id, stocked_quantity: 20.5 + index, incoming_quantity: 1.25,
        }))),
      }));
      levels.push(...secondStock.inventory_levels);
    }
    for (const location of firstStock.locations) await Effect.runPromise(channelLocations.workflow.run(channelLocations.workflow.newRequestKey(), {
      id: location.id, add: ["root-channel-0", "root-channel-1"],
    }));
    const firstItem = items[0], firstLocation = firstStock.locations[0];
    if (firstItem === undefined || firstLocation === undefined) throw new Error("Native Stocking setup omitted its endpoints");
    const reserved = await Effect.runPromise(reservations.run(reservations.newRequestKey(), {
      reservations: [{ inventory_item_id: firstItem.id, location_id: firstLocation.id, quantity: 0.125, metadata: { fixture159: prefix } }],
    }));
    return { products, variants, items, priceSetLinks, inventoryLinks, locations: firstStock.locations, levels, reservations: reserved };
  };
  return { fixture, creation, creationModules, execution, channelLocations, pricingRead, inventoryRead, stockInventory, stocking, reservations,
    seed, seedUnpricedVariant, seedPriceLists, seedPricePreferences, seedContextPreferences };
}
