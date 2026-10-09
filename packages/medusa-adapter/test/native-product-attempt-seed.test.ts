import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { isJsonObject, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from
  "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { seedNativeProductAttemptGraph } from "./support/native-product-attempt-seed";

describe("native Product graph seed for mixed attempts", () => {
  const cleanup: Array<() => Promise<void>> = [];
  let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  beforeAll(async () => {
    currency = await logicalCurrencyFixture("pglite", close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    for (const close of cleanup.reverse()) await close();
  }, 120_000);
  it("persists options, values, tags, variants, images and categories through native commands", async () => {
    const { seed, baseline, catalog } = await seedNativeProductAttemptGraph(currency, product, "fixture");
    expect(baseline).toMatchObject({ id: seed.productId, title: "Mixed draft fixture" });

    const revision = createHash("sha256").update("mixed-product-scalar-update").digest("hex");
    const updated = defineCommerceEventContract({ name: catalog.product.updatedEvent,
      revision, internal: true, decode: product.runtime.logicalPolicy.capture });
    const participant = defineAtomicCommerceParticipant("product");
    const command = defineAtomicCommerceCommand("mixedProductScalarUpdate", (ctx, args) =>
      ctx.call(participant, product.runtime.commands.update, args));
    let observedActivity: Parameters<typeof product.runtime.logicalPolicy.validateLogicalCall>[1] | undefined;
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
      identityAndAccessPolicy: { profile: "mixed-product-scalar-update" },
      participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
        commands: [product.runtime.commands.update],
        validateLogicalCall: (...args) => {
          observedActivity = args[1];
          return product.runtime.logicalPolicy.validateLogicalCall(...args);
        },
        events: { contracts: [updated], select: event => isJsonObject(event) &&
          event.name === catalog.product.updatedEvent ? Effect.succeed(updated)
            : Effect.fail(commerceError("unadmittedEvent")) } }],
      commands: [command], events: { producerRevision: revision, contracts: [updated],
        subscribers: [{ id: "mixed-product-scalar-update", revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), command, seed.updateInput)))
        .toMatchObject({ id: seed.productId, title: seed.newTitle, handle: seed.newHandle,
          status: "published" });
    } finally { await Effect.runPromise(host.close); }
    expect(observedActivity).toBeDefined();
    expect(observedActivity?.lifecycle).toHaveLength(0);
    expect(observedActivity?.setNull).toHaveLength(0);
    expect(observedActivity?.referenceReplacements).toHaveLength(0);
    expect(observedActivity?.mutations).toHaveLength(1);
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve] }));
    try {
      const after = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      expect(after).toMatchObject({ id: seed.productId, handle: seed.newHandle,
        options: baseline.options, tags: baseline.tags, variants: baseline.variants,
        images: baseline.images, categories: baseline.categories });
    } finally { await Effect.runPromise(read.close); }
  }, 120_000);
});
