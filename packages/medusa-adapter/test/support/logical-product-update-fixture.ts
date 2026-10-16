import { Effect, Result, Schema } from "effect";
import { prepareProductCreationWorkflow } from "../../src/workflows/product/creation";
import { prepareProductVariantInventoryWorkflow } from "../../src/workflows/product/variant-inventory";
import { prepareProductUpdateWorkflow, type ProductUpdateHooks } from "../../src/workflows/product/update";
import { prepareProductUpdateLinkResource } from "../../src/links/product-update-resource";
import { prepareLogicalPricingHost, seedLogicalPricingLists } from "./logical-pricing-fixture";
import { prepareLogicalProductLinksHost } from "./logical-product-links-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./logical-inventory-fixture";
import { connectProductCreation, creationRevision, productCreationExecution, productCreationOptions,
  seedCreationEndpoints, seedCreationReferences } from "./logical-product-creation-fixture";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Shared storage/schema and real native creation seed; the update root alone
 * selects its wider methods. No fixture reproduces reconciliation or cascade. */
export async function prepareLogicalProductUpdate(driver: "pglite" | "postgres", registerCleanup: (close: () => Promise<void>) => void,
  shared?: Pick<NonNullable<Parameters<typeof logicalCurrencyFixture>[2]>, "additionalSources"> & (
    { readonly resource: Awaited<ReturnType<typeof logicalCurrencyFixture>>["resource"];
      readonly fixtureIdentity: { readonly deploymentId: string; readonly projectId: string; readonly uuidOffset: number } }
    | { readonly resource?: never; readonly fixtureIdentity?: never })) {
  const configuration = { includeProduct: true, includePricing: true,
    includeVariantInventory: true, includeSalesChannel: true, includeShippingProfile: true,
    includeProductSalesChannelLink: true, includeProductShippingProfileLink: true };
  const fixture = await (shared === undefined ? logicalCurrencyFixture(driver, registerCleanup, configuration)
    : logicalCurrencyFixture(driver, registerCleanup, { ...configuration, ...shared }));
  const creation = await connectProductCreation(fixture);
  const pricing = await prepareLogicalPricingHost(fixture, "product-updates");
  const productLinks = await prepareLogicalProductLinksHost(fixture, "product-updates");
  for (const member of [pricing, productLinks]) {
    await Effect.runPromise(member.host.initialize([]));
    registerCleanup(() => Effect.runPromise(member.host.close));
  }
  const inventory = await prepareLogicalInventoryHosts(fixture, { variantLinks: "product-updates" });
  const modules: Parameters<typeof prepareProductUpdateWorkflow>[0]["modules"] = {
    product: { module: creation.product.runtime.productUpdateWorkflow, logicalStorage: creation.product.hostInput.logicalStorage },
    pricing: { module: pricing.runtime.workflow, logicalStorage: pricing.hostInput.logicalStorage },
    product_links: { module: productLinks.runtime.workflow, logicalStorage: productLinks.hostInput.logicalStorage },
    variant_links: { module: inventory.link.runtime.workflow, logicalStorage: inventory.link.hostInput.logicalStorage },
  };
  const link = Result.getOrThrow(prepareProductUpdateLinkResource({ sales: productLinks.runtime.nativeServices.sales,
    shipping: productLinks.runtime.nativeServices.shipping, inventory: inventory.link.runtime.nativeServices.inventory,
    pricing: inventory.link.runtime.nativeServices.pricing }, pricing.runtime.workflow));
  const execution = productCreationExecution(creation);
  const options = { execution, modules, link, revision: creationRevision("native-product-update"),
    subscribers: [{ id: "native-product-update", revision: "b".repeat(64) }] };
  const prepare = async (hooks: ProductUpdateHooks = {}, selectedExecution = execution) => {
    const host = await Effect.runPromise(prepareProductUpdateWorkflow({ ...options, execution: selectedExecution, hooks }));
    registerCleanup(() => Effect.runPromise(host.close));
    return host;
  };
  const seed = async (prefix: string, count = 1, inventoryLinks: 1 | 2 = 1, priceListPrices = false) => {
    if (inventoryLinks === 2) {
      const items = await prepareInventoryCreateHost(fixture, creation.inventory.inventory);
      try {
        for (let offset = 0; offset < count * 2; offset += 4)
          await Effect.runPromise(items.host.run(items.host.newRequestKey(), items.create,
            Array.from({ length: Math.min(4, count * 2 - offset) }, (_, index) => ({ id: prefix + "-inventory-" + (offset + index), sku: prefix + "-item-" + (offset + index) }))));
      } finally { await Effect.runPromise(items.host.close); }
    }
    const priceSetIds = new Map<string, string>();
    const readId = Schema.decodeUnknownSync(Schema.String);
    const host = await Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(creation), hooks: {
      productsCreated: async (value, context) => {
        const links = await context.resources.query.graph({ entity: "product_variant_price_set", fields: ["variant_id", "price_set_id"],
          filters: { variant_id: value.products.flatMap(product => product.variants.map(variant => variant.id)) }, pagination: { take: 4 } });
        for (const row of links.data) priceSetIds.set(readId(row.variant_id), readId(row.price_set_id));
      },
    } }));
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { products: Array.from({ length: count }, (_, index) => ({
        id: prefix + "-product-" + index, title: prefix + index, handle: prefix + "-handle-" + index,
        options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
        images: [{ url: "https://example.test/" + prefix + "/" + index + "/0" }, { url: "https://example.test/" + prefix + "/" + index + "/1" }],
        tag_ids: ["root-tag-0", "root-tag-1", "root-tag-2", "root-tag-3"],
        category_ids: ["root-category-0", "root-category-1", "root-category-2", "root-category-3"],
        sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
        variants: [{ id: prefix + "-variant-" + index, title: "Old " + index, sku: prefix + "-sku-" + index,
          options: { Size: "0" },
          ...(inventoryLinks === 2 ? { inventory_items: [{ inventory_item_id: prefix + "-inventory-" + index * 2, required_quantity: 2 },
            { inventory_item_id: prefix + "-inventory-" + (index * 2 + 1), required_quantity: 3 }] } : {}),
          prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "old" } },
            { currency_code: "EUR", amount: 200, rules: { region_id: "removed" } }] }],
      })) }));
      if (priceListPrices) await seedLogicalPricingLists(fixture, pricing, result.flatMap(product => product.variants.map(variant => ({
        id: prefix + "-price-list-" + variant.id, title: prefix + " sale " + variant.id, description: prefix, status: "active", type: "sale",
        prices: ["USD", "EUR"].map(currency_code => ({ id: prefix + "-sale-" + variant.id + "-" + currency_code,
          price_set_id: readId(priceSetIds.get(variant.id)), currency_code, amount: 5, rules: { region_id: "sale" } })),
      }))));
      return result.map(product => ({ ...product, variants: product.variants.map(variant => {
        const price_set_id = priceSetIds.get(variant.id);
        if (price_set_id === undefined) throw new Error("Native creation omitted its Variant Pricing Link");
        return { ...variant, price_set_id };
      }) }));
    } finally { await Effect.runPromise(host.close); }
  };
  const appendVariant = async (prefix: string, productId: string) => {
    const host = await Effect.runPromise(prepareProductVariantInventoryWorkflow({ execution, modules: {
      product: { module: creation.product.runtime.workflow, logicalStorage: creation.product.hostInput.logicalStorage },
      pricing: { module: creation.pricing.runtime.workflow, logicalStorage: creation.pricing.hostInput.logicalStorage },
      inventory: { module: creation.inventory.inventory.runtime.workflow, logicalStorage: creation.inventory.inventory.hostInput.logicalStorage },
      stock_location: { module: creation.inventory.stockLocation.runtime.workflow, logicalStorage: creation.inventory.stockLocation.hostInput.logicalStorage },
      link: { module: creation.inventory.link.runtime.workflow, logicalStorage: creation.inventory.link.hostInput.logicalStorage },
    }, revision: creationRevision("product-update-additional-variant"), subscribers: [{ id: "product-update-variant-seed", revision: "b".repeat(64) }] }));
    try {
      return await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: [{ id: prefix + "-variant", product_id: productId,
        title: prefix, sku: prefix + "-sku", options: { Size: "1" }, prices: [] }] }));
    } finally { await Effect.runPromise(host.close); }
  };
  const appendImage = async (prefix: string, productId: string) => {
    const product = creation.product.runtime, participant = defineAtomicCommerceParticipant("product");
    const contract = defineCommerceEventContract({ name: product.metadata.image.createdEvent, revision: "a".repeat(64),
      internal: true, decode: product.logicalPolicy.capture });
    const command = defineAtomicCommerceCommand("productImageSeed", (ctx, input) => Effect.gen(function* () {
      yield* ctx.call(participant, product.commands.createImages, input);
      return yield* ctx.call(participant, product.commands.internalProductRetrieve, { id: productId, config: { relations: ["images"] } });
    }));
    const host = await Effect.runPromise(execution.prepare({ identityAndAccessPolicy: { policy: execution.identityAndAccessPolicy, seed: "product-image" },
      participants: [{ participant, logicalStorage: creation.product.hostInput.logicalStorage,
        commands: [product.commands.createImages, product.commands.internalProductRetrieve],
        validateLogicalCall: product.logicalPolicy.validateLogicalCall, events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
      commands: [command], events: { producerRevision: "a".repeat(64), contracts: [contract], subscribers: [{ id: "product-update-image-seed", revision: "b".repeat(64) }],
        validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void } }));
    try { return await Effect.runPromise(host.run(host.newRequestKey(), command,
      [{ id: prefix + "-image", product_id: productId, url: "https://example.test/" + prefix + "/extra" }])); }
    finally { await Effect.runPromise(host.close); }
  };
  await seedCreationEndpoints(creation);
  await seedCreationEndpoints(creation, "replacement");
  await seedCreationReferences(creation);
  await seedCreationReferences(creation, "replacement");
  return { fixture, creation, pricing, productLinks, inventory, execution, modules, link, options, prepare, seed, appendVariant, appendImage };
}
