import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { makeCoreProductCreationFixture, productCreationOptions, seedCreationEndpoints,
  seedCreationReferences } from "../../../medusa-adapter/test/support/core-product-creation-fixture";
import { productCreationInput } from "../../../medusa-adapter/test/support/core-product-creation-input";
import { prepareProductCreationWorkflow, ProductCreationOutput } from "../../../medusa-adapter/src/workflows/product/creation";
import type { CorePerformanceScenario } from "../../test/performance/support/scenario";

const decodeOutput = Schema.decodeUnknownSync(ProductCreationOutput);
const decodeProducts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String,
  handle: Schema.String, status: Schema.String, images: Schema.Array(Schema.Struct({ url: Schema.String })),
  variants: Schema.Array(Schema.Struct({ id: Schema.String, sku: Schema.String, manage_inventory: Schema.Boolean })),
})));

/** The complete pinned createProductsWorkflow, through the current eight-source
 * Core fixture. Only preparation and committed observation live in this harness. */
export async function prepareProductWorkflowScenario(productsPerRequest: 1 | 4): Promise<CorePerformanceScenario & {
  verifyPublications(): Promise<void>;
}> {
  const cleanup: Array<() => Promise<void>> = [];
  const started = performance.now();
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const failures: unknown[] = [];
    for (const close of [...cleanup].reverse()) try { await close(); } catch (cause) { failures.push(cause); }
    if (failures.length > 0) throw new AggregateError(failures, "Product workflow benchmark cleanup failed");
  };
  try {
    const fixture = await makeCoreProductCreationFixture("postgres", close => cleanup.push(close));
    const installed = performance.now();
    await seedCreationEndpoints(fixture);
    await seedCreationReferences(fixture);
    const seeded = performance.now();
    const host = await Effect.runPromise(prepareProductCreationWorkflow(productCreationOptions(fixture)));
    cleanup.push(() => Effect.runPromise(host.close));
    const prepared = performance.now();
    const before = await fixture.snapshot();
    let verifiedRequests = 0;
    return { dispose,
      workload: { flow: "createProductsWorkflow", cardinality: { products: productsPerRequest, variants: productsPerRequest,
        images: 2 * productsPerRequest, optionValues: 4 * productsPerRequest, prices: 2 * productsPerRequest,
        salesChannelLinks: 2 * productsPerRequest, shippingLinks: productsPerRequest, inventoryLinks: productsPerRequest,
        pricingLinks: productsPerRequest, tagMemberships: 4 * productsPerRequest, categoryMemberships: 4 * productsPerRequest },
        limitations: ["Actual admitted native workflow; HTTP ingress and external hook effects are excluded."] },
      timings: { provisionAndPrepareMs: installed - started, initialSeedMs: seeded - installed, runtimeConstructionMs: prepared - seeded },
      async prepareSample(id) {
        const input = productCreationInput(id, productsPerRequest), key = host.newRequestKey();
        let invoked = false;
        return {
          async run(observation) {
            assert.equal(observation, undefined);
            assert.equal(invoked, false, "Workflow sample already invoked"); invoked = true;
            return Effect.runPromise(host.run(key, input));
          },
          async verify(value) {
            const result = decodeOutput(value);
            assert.deepEqual(result.map(row => row.id), input.products.map(row => row.id));
            for (const [index, product] of result.entries()) {
              const expected = input.products[index]; assert(expected !== undefined);
              assert.equal(product.title, expected.title);
              assert.equal(product.variants.length, 1); assert.equal(product.variants[0]?.id, expected.variants[0]?.id);
            }
            const committed = decodeProducts(await Effect.runPromise(fixture.product.reads.read(fixture.product.runtime.commands.list,
              { filters: { id: input.products.map(row => row.id) }, config: { take: 4, relations: ["images", "variants"] } })));
            for (const expected of input.products) {
              const actual = committed.find(row => row.id === expected.id); assert(actual !== undefined);
              assert.equal(actual.title, expected.title); assert.equal(actual.handle, expected.handle); assert.equal(actual.status, "published");
              assert.deepEqual(actual.images.map(row => row.url).sort(), expected.images.map(row => row.url).sort());
              assert.deepEqual(actual.variants.map(row => ({ id: row.id, sku: row.sku, manage_inventory: row.manage_inventory })),
                [{ id: expected.variants[0]?.id, sku: expected.variants[0]?.sku, manage_inventory: true }]);
            }
            verifiedRequests++;
          },
          async cleanup() {},
        };
      },
      async verifyPublications() {
        assert(verifiedRequests > 0);
        const after = await fixture.snapshot(), events = after.events.slice(before.events.length);
        // Observe the real owner once for the entire series. Each individual
        // timestamp must still prove its complete one-root atomic publication.
        const rows = 29 * productsPerRequest;
        assert.equal(after.rows.length - before.rows.length, rows * verifiedRequests);
        assert.equal(after.outcomes.length - before.outcomes.length, verifiedRequests);
        assert.equal(after.families.length - before.families.length, verifiedRequests);
        const timestamps = new Set(events.map(event => event.timestamp));
        assert.equal(timestamps.size, verifiedRequests);
        for (const timestamp of timestamps) {
          const messages = events.filter(event => event.timestamp === timestamp);
          assert.equal(after.revisions.filter(row => row.timestamp === timestamp).length, rows);
          assert.equal(after.outcomes.filter(row => row.timestamp === timestamp).length, 1);
          assert.equal(after.families.filter(row => row.timestamp === timestamp).length, 1);
          assert.deepEqual(messages.filter(event => ["product-variant.created", "product.created"].includes(event.envelope.contract))
            .map(event => event.envelope.contract), [...Array.from({ length: productsPerRequest }, () => "product-variant.created"),
              ...Array.from({ length: productsPerRequest }, () => "product.created")]);
          for (const contract of ["LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached",
            "LinkProductVariantInventoryItem.attached", "LinkProductVariantPriceSet.attached"])
            assert(messages.some(event => event.envelope.contract === contract));
        }
      },
    };
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Product workflow preparation and cleanup failed"); }
    throw cause;
  }
}
