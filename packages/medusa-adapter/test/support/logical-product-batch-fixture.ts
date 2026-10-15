import { Effect, Result, Schema } from "effect";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { prepareProductBatchLinkResource } from "../../src/links/product-batch-resource";
import { prepareProductBatchWorkflow, prepareProductVariantBatchWorkflow } from "../../src/workflows/product/batch";
import { prepareLogicalProductDeletion } from "./logical-product-deletion-fixture";
import { creationRevision, productCreationModules, productCreationOptions } from "./logical-product-creation-fixture";
import { prepareProductCreationWorkflow } from "../../src/workflows/product/creation";
import { prepareInventoryCreateHost } from "./logical-inventory-fixture";
import { seedLogicalPricingLists } from "./logical-pricing-fixture";

/** Reuse genuine creation/update/deletion seed operations and their installed
 * sources. The batch facade supplies the only new execution root. */
export async function prepareLogicalProductBatch(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalProductDeletion>[2]) {
  const connected = await prepareLogicalProductDeletion(driver, registerCleanup, shared);
  const inventoryBatch = await Effect.runPromise(makeLocalInventoryCommands("product-batches"));
  const modules: Parameters<typeof prepareProductBatchWorkflow>[0]["modules"] = { ...productCreationModules(connected.creation),
    product: { module: connected.creation.product.runtime.productBatchWorkflow, logicalStorage: connected.creation.product.hostInput.logicalStorage },
    pricing: connected.modules.pricing,
    inventory: { module: inventoryBatch.workflow, logicalStorage: connected.creation.inventory.inventory.hostInput.logicalStorage },
    product_links: connected.modules.product_links, variant_links: connected.modules.variant_links,
  };
  const link = Result.getOrThrow(prepareProductBatchLinkResource({ ...connected.productDeletionLinks.nativeServices,
    ...connected.variantDeletionLinks.nativeServices }, connected.pricing.runtime.workflow));
  const options = { execution: connected.execution, modules, link, revision: creationRevision("native-product-batches"),
    subscribers: [{ id: "native-product-batches", revision: "b".repeat(64) }] };
  const prepareProduct = async (execution = options.execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductBatchWorkflow({ ...options, execution, revision }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const prepareVariant = async (execution = options.execution, revision = options.revision) => {
    const host = await Effect.runPromise(prepareProductVariantBatchWorkflow({ ...options, execution, revision }));
    registerCleanup(() => Effect.runPromise(host.close)); return host;
  };
  const seedGraph = async (prefix: string, variantsPerProduct: readonly number[]) => {
    const total = variantsPerProduct.reduce((sum, count) => sum + count, 0);
    if (total > 4) throw new Error("Seed graph exceeds the genuine creation profile");
    const itemIds = Array.from({ length: total * 2 }, (_, index) => prefix + "-inventory-" + index);
    const items = await prepareInventoryCreateHost(connected.fixture, connected.creation.inventory.inventory);
    try {
      for (let index = 0; index < itemIds.length; index += 4) await Effect.runPromise(items.host.run(items.host.newRequestKey(), items.create,
        itemIds.slice(index, index + 4).map(id => ({ id, sku: id }))));
    } finally { await Effect.runPromise(items.host.close); }
    const priceSets = new Map<string, string>(), id = Schema.decodeUnknownSync(Schema.String);
    const native = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(connected.creation), hooks: {
      productsCreated: async (value, context) => {
        const rows = await context.resources.query.graph({ entity: "product_variant_price_set", fields: ["variant_id", "price_set_id"],
          filters: { variant_id: value.products.flatMap(product => product.variants.map(variant => variant.id)) }, pagination: { take: 4 } });
        for (const row of rows.data) priceSets.set(id(row.variant_id), id(row.price_set_id));
      },
    } }));
    let ordinal = 0;
    try {
      const products = await Effect.runPromise(native.run(native.newRequestKey(), { products: variantsPerProduct.map((count, product) => ({
        id: prefix + "-product-" + product, title: prefix + product, handle: prefix + "-handle-" + product,
        images: [0, 1].map(index => ({ url: "https://example.test/" + prefix + "/" + product + "/" + index })),
        options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
        tag_ids: [0, 1, 2, 3].map(index => "root-tag-" + index), category_ids: [0, 1, 2, 3].map(index => "root-category-" + index),
        sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
        variants: Array.from({ length: count }, (_, index) => {
          const variant = ordinal++;
          return { id: prefix + "-variant-" + variant, title: "Old " + variant, sku: prefix + "-sku-" + variant, options: { Size: String(index) },
            inventory_items: [0, 1].map(item => ({ inventory_item_id: itemIds[variant * 2 + item]!, required_quantity: item + 1 })),
            prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "old" } },
              { currency_code: "EUR", amount: 200, rules: { region_id: "old" } }] };
        }),
      })) }));
      const priceLists = products.flatMap(product => product.variants.map(variant => ({
        id: prefix + "-list-" + variant.id, title: prefix + " sale " + variant.id, description: prefix, status: "active", type: "sale",
        prices: ["USD", "EUR"].map(currency_code => ({ id: prefix + "-sale-" + variant.id + "-" + currency_code,
          price_set_id: id(priceSets.get(variant.id)), currency_code, amount: 5, rules: { region_id: "sale" } })),
      })));
      if (priceLists.length > 0) await seedLogicalPricingLists(connected.fixture, connected.pricing, priceLists);
      return { products, itemIds, priceSets };
    } finally { await Effect.runPromise(native.close); }
  };
  const seedForeignOwners = async (prefix: string, itemIds: readonly string[]) => {
    if (itemIds.length !== 8) throw new Error("The inverse maximum seed requires eight existing Items");
    const native = await Effect.runPromise(prepareProductCreationWorkflow(productCreationOptions(connected.creation)));
    const products: Array<Effect.Success<ReturnType<typeof native.run>>[number]> = [];
    try {
      // Each ordinary creation call stays within its four-Variant admission.
      // Explicit existing Item inputs create one genuine Link per foreign owner.
      for (let offset = 0; offset < 24; offset += 4) {
        const product = {
          id: prefix + "-product-" + offset, title: prefix + offset, handle: prefix + "-handle-" + offset,
          options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
          variants: Array.from({ length: 4 }, (_, index) => ({
            id: prefix + "-variant-" + (offset + index), title: "Foreign " + (offset + index), sku: prefix + "-sku-" + (offset + index),
            options: { Size: String(index) }, inventory_items: [{ inventory_item_id: itemIds[Math.floor((offset + index) / 3)]!, required_quantity: 1 }], prices: [],
          })),
        };
        const result = await Effect.runPromise(native.run(native.newRequestKey(), { products: [product] }));
        products.push(...result);
      }
      return products;
    } finally { await Effect.runPromise(native.close); }
  };
  return { ...connected, inventoryBatch, modules, link, options, prepareProduct, prepareVariant, seedGraph, seedForeignOwners };
}
