import { Effect, Result } from "effect";
import { productVariantsFields } from "@medusajs/core-flows/cart/variant-pricing-fields";
import { InventoryLevelStockLocation, ProductShippingProfile, ProductVariantInventoryItem,
  ProductVariantPriceSet, SalesChannelLocation } from "@medusajs/link-modules";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { nativeLinkGraphDirectPaths, localGraphDirectPath } from "../../local-graph/direct-paths";
import { nativeLinkGraphPaths } from "../../local-graph/links";
import { relationPaths } from "../../local-graph/module";
import type { GraphModuleDefinition, GraphReadDefinition } from "../../local-graph/model";
import { captureInventoryMetadata } from "../../modules/inventory/schema";
import { captureProductSchema } from "../../modules/product/schema";
import { productRuntimeMetadata } from "../../modules/product/runtime-metadata";
import { makeReadCatalog } from "../../query/catalog";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../../workflow/host";
import { defineWorkflowModule, workflowModuleDefinition, workflowMethodDefinition, type WorkflowMethod } from "../../workflow/module";

const names = ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment",
  "product_links", "variant_links", "sales_channel_locations"] as const;

/** Select original commands/storage and derive only the finite native read
 * graph. Canonical DML and native Link owners supply every endpoint key. */
export const prepareVariantItemPricingModules = Effect.fn("MedusaWorkflow.prepareVariantItemPricingModules")(function* (
  input: Readonly<Record<string, InstalledWorkflowModule>>,
) {
  const record = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(record).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(record, names));
  const definition = (name: typeof names[number]) => {
    const current = workflowModuleDefinition(installed[name].module);
    return current === undefined ? Result.fail(commerceError("invalidAuthority")) : Result.succeed(current);
  };
  const product = yield* Effect.fromResult(definition("product"));
  const pricing = yield* Effect.fromResult(definition("pricing"));
  const inventory = yield* Effect.fromResult(definition("inventory"));
  const productLinks = yield* Effect.fromResult(definition("product_links"));
  const variantLinks = yield* Effect.fromResult(definition("variant_links"));
  const channelLocations = yield* Effect.fromResult(definition("sales_channel_locations"));
  if (product.source.name !== "flarex-product-local" ||
    pricing.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-variant-item-pricing" ||
    inventory.source.name !== "flarex-inventory-local" || inventory.source.profile !== "inventory-variant-price-calculation")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const calculatePrices = installed.pricing.module.methods.calculatePrices;
  if (calculatePrices === undefined || workflowMethodDefinition(calculatePrices) === undefined)
    return yield* Effect.fail(commerceError("invalidAuthority"));

  const capturedProduct = yield* captureProductSchema("product-runtime-contract")
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const productMetadata = yield* productRuntimeMetadata(capturedProduct.metadata.frame);
  const root = productMetadata.variant.model;
  const productReads: GraphReadDefinition[] = [];
  for (const read of product.graph.reads) {
    if (read.model !== root && read.model !== productMetadata.product.model) {
      continue;
    }
    const paths = yield* Effect.fromResult(relationPaths(productMetadata.readCatalog, read.table.name,
      read.paths.map(path => path.path), { nativeFields: true }));
    // Only remote descendants retain local edge keys in the graph planner.
    // Type and Collection selections keep their native exact field projection.
    productReads.push({ ...read, paths, nativeFields: true,
      ...(read.model === root ? { optionalFields: productVariantsFields.filter(field =>
        !field.includes(".") && !read.table.columns.includes(field)) } : {}) });
  }
  if (productReads.filter(read => read.model === root).length !== 1 ||
    productReads.filter(read => read.model === productMetadata.product.model).length !== 1)
    return yield* Effect.fail(commerceError("unsupportedProfile"));

  const capturedInventory = yield* captureInventoryMetadata();
  const inventoryTables = capturedInventory.frame.tables;
  const item = inventoryTables.find(table => table.name === "inventory_item");
  const level = inventoryTables.find(table => table.name === "inventory_level");
  const itemRead = inventory.graph.reads.find(read => read.table.name === item?.name);
  const levelRead = inventory.graph.reads.find(read => read.table.name === level?.name);
  if (item === undefined || level === undefined || itemRead === undefined || levelRead === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const itemLevels = describeToManyRelation(item, "location_levels", inventoryTables);
  if (itemLevels === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const inventoryCatalog = yield* Effect.fromResult(makeReadCatalog(inventoryTables.map(table => ({
    name: table.name, columns: table.columns.map(column => column.name),
    primaryKeys: table.columns.filter(column => column.primaryKey).map(column => column.name),
    foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {},
  })), new Map([[item.name, new Map([[itemLevels.name, itemLevels]])]])));

  const productRemote = yield* Effect.fromResult(nativeLinkGraphPaths(ProductShippingProfile, [{ root,
    path: "product.shipping_profile", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1,
  }], productMetadata.product.model));
  const priceSetRemote = yield* Effect.fromResult(nativeLinkGraphPaths(ProductVariantPriceSet, [{ root,
    path: "price_set", maximumSources: 4, maximumLinks: 4, maximumTargets: 4, maximumPerSource: 1,
  }]));
  const richLinks = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem, [{ root,
    path: "inventory_items", maximumSources: 4, maximumTargets: 8, maximumPerSource: 8,
  }], root));
  const richModel = richLinks[0]?.targetModel;
  if (richModel === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const richInventory = yield* Effect.fromResult(nativeLinkGraphDirectPaths(ProductVariantInventoryItem, [{ root,
    path: "inventory_items.inventory", maximumSources: 8, maximumTargets: 4, maximumPerSource: 1,
  }], richModel));
  const inventoryLevels = yield* Effect.fromResult(localGraphDirectPath(inventoryCatalog, item.name,
    itemRead.model, levelRead.model, itemLevels.name, { root,
      path: "inventory_items.inventory.location_levels", maximumSources: 4, maximumTargets: 16, maximumPerSource: 16,
    }));
  const stockLocations = yield* Effect.fromResult(nativeLinkGraphDirectPaths(InventoryLevelStockLocation, [{ root,
    path: "inventory_items.inventory.location_levels.stock_locations", maximumSources: 16, maximumTargets: 4, maximumPerSource: 1,
  }], levelRead.model));
  const stockModel = stockLocations[0]?.targetModel;
  if (stockModel === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const salesChannels = yield* Effect.fromResult(nativeLinkGraphPaths(SalesChannelLocation, [{ root,
    path: "inventory_items.inventory.location_levels.stock_locations.sales_channels",
    maximumSources: 4, maximumLinks: 8, maximumTargets: 4, maximumPerSource: 4,
  }], stockModel));

  const clone = <const Methods extends Readonly<Record<string, WorkflowMethod>>>(
    name: typeof names[number], graph: GraphModuleDefinition, methods: Methods,
  ) => Result.gen(function* () {
    const original = yield* definition(name);
    const module = yield* defineWorkflowModule({ name: installed[name].module.name, source: original.source,
      methods, graph, ...(original.logical === undefined ? {} : { logical: original.logical }) });
    return { ...installed[name], module };
  });
  const unchanged = (name: typeof names[number]) => Result.gen(function* () {
    const original = yield* definition(name);
    return yield* clone(name, original.graph, {});
  });
  return {
    product: yield* Effect.fromResult(clone("product", { ...product.graph, reads: productReads,
      aliases: product.graph.aliases.filter(alias => productReads.some(read => read.model === alias.model)) }, {})),
    pricing: yield* Effect.fromResult(clone("pricing", pricing.graph, { calculatePrices })),
    inventory: yield* Effect.fromResult(clone("inventory", { ...inventory.graph,
      directPaths: [...inventory.graph.directPaths ?? [], inventoryLevels, ...stockLocations] }, {})),
    stock_location: yield* Effect.fromResult(unchanged("stock_location")),
    sales_channel: yield* Effect.fromResult(unchanged("sales_channel")),
    fulfillment: yield* Effect.fromResult(unchanged("fulfillment")),
    product_links: yield* Effect.fromResult(clone("product_links", { ...productLinks.graph,
      remotePaths: [...productLinks.graph.remotePaths ?? [], ...productRemote] }, {})),
    variant_links: yield* Effect.fromResult(clone("variant_links", { ...variantLinks.graph,
      remotePaths: [...variantLinks.graph.remotePaths ?? [], ...priceSetRemote],
      directPaths: [...variantLinks.graph.directPaths ?? [], ...richLinks, ...richInventory] }, {})),
    sales_channel_locations: yield* Effect.fromResult(clone("sales_channel_locations", { ...channelLocations.graph,
      remotePaths: [...channelLocations.graph.remotePaths ?? [], ...salesChannels] }, {})),
  };
});
