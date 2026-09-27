import { createHash } from "node:crypto";
import { Effect } from "effect";
import { expect } from "vitest";
import { isJsonObject, commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant,
  type CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../../persistence-postgres/src/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import type { logicalCurrencyFixture } from "./logical-currency-fixture";
import type { prepareLogicalProductHost } from "./logical-product-fixture";
import { productAttemptSeed } from "./product-attempt-seed";

type Currency = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type Product = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
type Entity = Readonly<{ createdEvent: string }>;

async function runNativeProductCommand(currency: Currency, product: Product, suffix: string,
  command: CommerceCommand, input: Json, entities: readonly Entity[], label: string) {
  const revision = createHash("sha256").update(`mixed-product-seed-${suffix}-${label}`).digest("hex");
  const named = entities.map(entity => ({ name: entity.createdEvent,
    contract: defineCommerceEventContract({ name: entity.createdEvent, revision, internal: true,
      decode: product.runtime.logicalPolicy.capture }) }));
  const contracts = named.map(entry => entry.contract);
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand(`mixedProductSeed${label}`, (ctx, args) => ctx.call(participant, command, args));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
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
  suffix: string, input: Json) {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  return runNativeProductCommand(currency, product, suffix, product.runtime.commands.update,
    input, [{ createdEvent: catalog.product.updatedEvent }], "Update");
}

/** Seed the actual pinned Product service graph with independently committed
 * native commands, then retain a populated read for relation comparisons. */
export async function seedNativeProductAttemptGraph(currency: Currency, product: Product, suffix: string) {
  const seed = productAttemptSeed(suffix);
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
      options: [{ values: expect.arrayContaining([expect.objectContaining({ value: "Small" }),
        expect.objectContaining({ value: "Large" })]) }],
      tags: [{ id: seed.tagId }], categories: [{ id: seed.categoryId }],
      variants: [{ id: seed.variantId }], images: [{ id: seed.imageId }] });
    if (!isJsonObject(baseline)) throw new Error("Expected native Product document");
    return { seed, baseline, catalog };
  } finally { await Effect.runPromise(read.close); }
}
