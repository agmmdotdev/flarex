import { createHash } from "node:crypto";
import { Effect } from "effect";
import { expect } from "vitest";
import { isJsonObject, commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { RelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import type { logicalCurrencyFixture } from "./logical-currency-fixture";
import type { prepareLogicalProductHost } from "./logical-product-fixture";
import type { prepareLogicalVariantPricingLinkHost } from "./logical-variant-pricing-link-fixture";
import { productAttemptSeed } from "./product-attempt-seed";

type Currency = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type Product = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
type VariantPricingLink = Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
type Entity = Readonly<{ createdEvent: string }>;

async function runNativeProductCommand(currency: Currency, product: Product, suffix: string,
  command: CommerceCommand, input: Json, entities: readonly Entity[], label: string,
  session?: RelationalSession) {
  const revision = createHash("sha256").update(`mixed-product-seed-${suffix}-${label}`).digest("hex");
  const named = entities.map(entity => ({ name: entity.createdEvent,
    contract: defineCommerceEventContract({ name: entity.createdEvent, revision, internal: true,
      decode: product.runtime.logicalPolicy.capture }) }));
  const contracts = named.map(entry => entry.contract);
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand(`mixedProductSeed${label}`, (ctx, args) => ctx.call(participant, command, args));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    ...(session === undefined ? {} : { session }),
    identityAndAccessPolicy: { profile: "mixed-product-seed" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [command], validateLogicalCall: product.runtime.logicalPolicy.validateLogicalCall,
      events: { contracts, select: event => {
        const matched = isJsonObject(event) && typeof event.name === "string"
          ? named.find(entry => entry.name === event.name)?.contract : undefined;
        return matched === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(matched);
      } } }], commands: [root], events: { producerRevision: revision, contracts,
      subscribers: [{ id: `mixed-product-seed-${label}`, revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  try { return await Effect.runPromise(host.run(host.newRequestKey(), root, input)); }
  finally { await Effect.runPromise(host.close); }
}

/** A separate, independently committed native Product command for OCC proofs. */
export async function runNativeStandaloneProductUpdate(currency: Currency, product: Product,
  suffix: string, input: Json, session?: RelationalSession) {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  return runNativeProductCommand(currency, product, suffix, product.runtime.commands.update,
    input, [{ createdEvent: catalog.product.updatedEvent }], "Update", session);
}

/** Independently committed native Product writers used to race the launch
 * workflow's exact option, variant, tag, and membership dependencies. */
export async function runNativeStandaloneProductMutation(currency: Currency, product: Product,
  suffix: string, kind: "replaceOptionValues" | "createVariant" | "updateTag" | "createTag" | "removeProductTag",
  input: Json, session?: RelationalSession) {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  const selected = kind === "replaceOptionValues"
    ? { command: product.runtime.commands.update, label: "ReplaceOptionValues",
      events: [catalog.product.updatedEvent, catalog.option.createdEvent, catalog.option.updatedEvent,
        catalog.option.deletedEvent, catalog.value.createdEvent, catalog.value.updatedEvent,
        catalog.value.deletedEvent] }
    : kind === "createVariant"
      ? { command: product.runtime.commands.createVariants, label: "CreateVariant",
        events: [catalog.variant.createdEvent] }
      : kind === "updateTag"
        ? { command: product.runtime.commands.updateTagsBySelector, label: "UpdateTag",
          events: [catalog.tag.updatedEvent] }
        : kind === "createTag"
          ? { command: product.runtime.commands.createTags, label: "CreateTag",
            events: [catalog.tag.createdEvent] }
        : { command: product.runtime.commands.update, label: "RemoveProductTag",
          events: [catalog.product.updatedEvent] };
  return runNativeProductCommand(currency, product, suffix, selected.command, input,
    selected.events.map(createdEvent => ({ createdEvent })), selected.label, session);
}

/** A separate native Link attachment, with its active pair claim and module
 * event checked by the same logical policy as the workflow participant. */
export async function runNativeStandaloneLinkCreate(currency: Currency, link: VariantPricingLink,
  suffix: string, input: Json, session?: RelationalSession) {
  const revision = createHash("sha256").update(`mixed-link-standalone-${suffix}`).digest("hex");
  const policy = link.runtime.logicalEventPolicy();
  const attached = defineCommerceEventContract({ name: "LinkProductVariantPriceSet.attached",
    revision, internal: true, decode: policy.capture });
  const participant = defineAtomicCommerceParticipant("link");
  const command = defineAtomicCommerceCommand("mixedLinkStandaloneCreate", (ctx, args) =>
    ctx.call(participant, link.runtime.create, args));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    ...(session === undefined ? {} : { session }),
    identityAndAccessPolicy: { profile: "mixed-link-standalone" },
    participants: [{ participant, logicalStorage: link.hostInput.logicalStorage,
      commands: [link.runtime.create], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: [attached], select: event => isJsonObject(event) &&
        event.name === "LinkProductVariantPriceSet.attached"
        ? Effect.succeed(attached) : Effect.fail(commerceError("unadmittedEvent")) } }],
    commands: [command], events: { producerRevision: revision, contracts: [attached],
      subscribers: [{ id: "mixed-link-standalone", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  try { return await Effect.runPromise(host.run(host.newRequestKey(), command, input)); }
  finally { await Effect.runPromise(host.close); }
}

/** Seed the actual pinned Product service graph with independently committed
 * native commands, then retain a populated read for relation comparisons. */
export async function seedNativeProductAttemptGraph(currency: Currency, product: Product, suffix: string,
  profile: "existing" | "launch" = "existing") {
  const seed = productAttemptSeed(suffix, profile);
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  await runNativeProductCommand(currency, product, suffix, product.runtime.commands.createTags,
    seed.tagInput, [catalog.tag], "Tag");
  await runNativeProductCommand(currency, product, suffix, product.runtime.commands.createCategories,
    seed.categoryInput, [catalog.category], "Category");
  await runNativeProductCommand(currency, product, suffix, product.runtime.commands.create,
    seed.createInput.products[0]!,
    [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image], "Product");
  const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
    commands: [product.runtime.commands.retrieve] }));
  try {
    const baseline = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
      id: seed.productId, config: { relations: ["options.values", "tags", "variants.options", "images", "categories"] },
    }));
    expect(baseline).toMatchObject({ id: seed.productId,
      options: [{ values: expect.arrayContaining(profile === "launch"
        ? [expect.objectContaining({ value: "0" })]
        : [expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Large" })]) }],
      tags: [{ id: seed.tagId, ...(profile === "launch" ? { value: "preview" } : {}) }], categories: [{ id: seed.categoryId }],
      ...(profile === "launch" ? { variants: [] } : { variants: [{ id: seed.variantId }] }),
      images: [{ id: seed.imageId }] });
    if (!isJsonObject(baseline)) throw new Error("Expected native Product document");
    return { seed, baseline, catalog };
  } finally { await Effect.runPromise(read.close); }
}
