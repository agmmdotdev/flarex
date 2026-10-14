import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";
import { prepareLogicalSalesChannelHost } from "./logical-sales-channel-fixture";
import { prepareLogicalShippingProfileHost } from "./logical-shipping-profile-fixture";
import { prepareLogicalProductLinksHost } from "./logical-product-links-fixture";
import { prepareLogicalInventoryHosts } from "./logical-inventory-fixture";
import { prepareProductShippingProfileWorkflow } from "../../src/product-shipping-profile-workflow";
import { prepareProductNativeLinkResource } from "../../src/product-native-link-resource";
import type { AtomicWorkflowHostComposition, AtomicWorkflowExecution } from "../../src/workflow/host";
import type { prepareProductCreationWorkflow } from "../../src/product-creation-workflow";

export const creationRevision = (name: string) => createHash("sha256").update(name).digest("hex");
export interface ProductCreationFixture {
  readonly fixture: LogicalCurrencyFixture;
  readonly product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  readonly pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
  readonly sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
  readonly shipping: Awaited<ReturnType<typeof prepareLogicalShippingProfileHost>>;
  readonly productLinks: Awaited<ReturnType<typeof prepareLogicalProductLinksHost>>;
  readonly inventory: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>>;
  readonly link: Result.Result.Success<ReturnType<typeof prepareProductNativeLinkResource>>;
}
export async function connectProductCreation(fixture: LogicalCurrencyFixture): Promise<ProductCreationFixture> {
  const product = await prepareLogicalProductHost(fixture), pricing = await prepareLogicalPricingHost(fixture);
  const sales = await prepareLogicalSalesChannelHost(fixture), shipping = await prepareLogicalShippingProfileHost(fixture);
  const productLinks = await prepareLogicalProductLinksHost(fixture);
  for (const member of [product, pricing, sales, shipping, productLinks]) {
    try { await Effect.runPromise(member.host.initialize([])); } finally { await Effect.runPromise(member.host.close); }
  }
  const inventory = await prepareLogicalInventoryHosts(fixture);
  const link = await Effect.runPromise(Effect.fromResult(prepareProductNativeLinkResource([
    productLinks.runtime.nativeServices.sales, productLinks.runtime.nativeServices.shipping,
    inventory.link.runtime.nativeServices.inventory, inventory.link.runtime.nativeServices.pricing,
  ])));
  return { fixture, product, pricing, sales, shipping, productLinks, inventory, link };
}
export const productCreationModules = (value: ProductCreationFixture): Parameters<typeof prepareProductCreationWorkflow>[0]["modules"] => ({
  product: { module: value.product.runtime.workflow, logicalStorage: value.product.hostInput.logicalStorage },
  pricing: { module: value.pricing.runtime.workflow, logicalStorage: value.pricing.hostInput.logicalStorage },
  inventory: { module: value.inventory.inventory.runtime.workflow, logicalStorage: value.inventory.inventory.hostInput.logicalStorage },
  stock_location: { module: value.inventory.stockLocation.runtime.workflow, logicalStorage: value.inventory.stockLocation.hostInput.logicalStorage },
  sales_channel: { module: value.sales.runtime.workflow, logicalStorage: value.sales.hostInput.logicalStorage },
  fulfillment: { module: value.shipping.runtime.workflow, logicalStorage: value.shipping.hostInput.logicalStorage },
  product_links: { module: value.productLinks.runtime.workflow, logicalStorage: value.productLinks.hostInput.logicalStorage },
  variant_links: { module: value.inventory.link.runtime.workflow, logicalStorage: value.inventory.link.hostInput.logicalStorage },
});
export const productCreationExecution = (value: ProductCreationFixture, session: LogicalCurrencyFixture["session"] = value.fixture.session): AtomicWorkflowExecution => ({
  identityAndAccessPolicy: value.fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...value.fixture.hostInput, session, ...composition }),
});
export const productCreationOptions = (value: ProductCreationFixture): Omit<Parameters<typeof prepareProductCreationWorkflow>[0], "hooks"> => ({ execution: productCreationExecution(value),
  modules: productCreationModules(value), link: value.link, revision: creationRevision("native-product-root"),
  subscribers: [{ id: "native-product-root", revision: "a".repeat(64) }],
});
export async function seedCreationEndpoints(value: ProductCreationFixture) {
  const modules = productCreationModules(value);
  const host = await Effect.runPromise(prepareProductShippingProfileWorkflow({ execution: productCreationExecution(value),
    modules: { product: modules.product, sales_channel: modules.sales_channel, fulfillment: modules.fulfillment,
      link: { module: value.productLinks.runtime.workflow, logicalStorage: value.productLinks.hostInput.logicalStorage } },
    revision: creationRevision("product-root-endpoint-setup"), subscribers: [{ id: "product-root-endpoint-setup", revision: "b".repeat(64) }],
  }));
  try {
    for (const index of [0, 1]) await Effect.runPromise(host.run(host.newRequestKey(), {
      shippingProfile: { id: "root-profile-" + index, name: "Root profile " + index, type: "default" },
      salesChannel: { id: "root-channel-" + index, name: "Root channel " + index },
      products: [{ id: "endpoint-seed-product-" + index, title: "Endpoint seed " + index }],
    }));
  } finally { await Effect.runPromise(host.close); }
}
export async function seedCreationReferences(value: ProductCreationFixture) {
  const { commands, metadata, logicalPolicy } = value.product.runtime;
  const entries = [
    [commands.createTypes, metadata.type.createdEvent, [{ id: "root-type", value: "Root type" }]],
    [commands.createCollections, metadata.collection.createdEvent, [{ id: "root-collection", title: "Root collection" }]],
    [commands.createTags, metadata.tag.createdEvent, Array.from({ length: 4 }, (_, index) => ({ id: "root-tag-" + index, value: "Root tag " + index }))],
    [commands.createCategories, metadata.category.createdEvent, Array.from({ length: 4 }, (_, index) => ({ id: "root-category-" + index, name: "Root category " + index }))],
  ] as const;
  const participant = defineAtomicCommerceParticipant("product");
  const contracts = entries.map(([, name]) => defineCommerceEventContract({ name, revision: "c".repeat(64), internal: true, decode: logicalPolicy.capture }));
  const contractsByName = new Map(entries.flatMap(([, name], index) => {
    const contract = contracts[index]; return contract ? [[name, contract] as const] : [];
  }));
  const roots = entries.map(([command], index) => defineAtomicCommerceCommand("seedProductReference" + index, (ctx, input) => ctx.call(participant, command, input)));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...value.fixture.hostInput, requestCallLimit: 128,
    participants: [{ participant, logicalStorage: value.product.hostInput.logicalStorage, commands: entries.map(([command]) => command),
      validateLogicalCall: logicalPolicy.validateLogicalCall, events: { contracts, select: message => {
        const contract = isJsonObject(message) && typeof message.name === "string" ? contractsByName.get(message.name) : undefined;
        return contract ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent"));
      } } }], commands: roots,
    events: { producerRevision: "c".repeat(64), contracts, subscribers: [{ id: "product-root-reference-seed", revision: "c".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  try {
    for (const [index, [, , data]] of entries.entries()) {
      const root = roots[index]; if (!root) throw new Error("Missing reference seed root");
      await Effect.runPromise(host.run(host.newRequestKey(), root, data));
    }
  } finally { await Effect.runPromise(host.close); }
}
export async function makeProductCreationFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options?: { readonly resource: LogicalCurrencyFixture["resource"]; readonly fixtureIdentity: { deploymentId: string; projectId: string; uuidOffset: number } }): Promise<ProductCreationFixture> {
  const configuration = { includeProduct: true, includePricing: true,
    includeVariantInventory: true, includeSalesChannel: true, includeShippingProfile: true,
    includeProductSalesChannelLink: true, includeProductShippingProfileLink: true };
  return connectProductCreation(await (options === undefined ? logicalCurrencyFixture(driver, close, configuration)
    : logicalCurrencyFixture(driver, close, { ...configuration, ...options })));
}
