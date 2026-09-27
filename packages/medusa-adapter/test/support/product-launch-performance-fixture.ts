import { createHash } from "node:crypto";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { prepareProductLaunchWorkflow } from "../../src/product-launch-workflow";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { productVariantPricingResources } from "../../src/workflow/policy";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./logical-variant-pricing-link-fixture";
import { runNativeStandaloneProductMutation, seedNativeProductAttemptGraph } from "./native-product-attempt-seed";

const revision = (value: string) => createHash("sha256").update(value).digest("hex");

/** The selected independently settling host, prepared once for a measured series.
 * Seeding and output checks belong outside each invocation interval. */
export async function prepareStandaloneProductLaunchPerformanceSeries() {
  const started = performance.now();
  const cleanup: Array<() => Promise<void>> = [];
  let closed = false;
  const closeAll = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const close of cleanup.toReversed()) {
      try { await close(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length > 0) throw new AggregateError(failures,
      "Standalone Product launch performance fixture cleanup failed");
  };
  try {
    const currency = await logicalCurrencyFixture("postgres", close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    const product = await prepareLogicalProductHost(currency);
    const pricing = await prepareLogicalPricingHost(currency);
    const link = await prepareLogicalVariantPricingLinkHost(currency);
    for (const member of [product, pricing, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const runtimeStarted = performance.now();
    const modules = {
      product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage },
      pricing: { module: pricing.runtime.workflow, logicalStorage: pricing.hostInput.logicalStorage },
      link: { module: link.runtime.workflow, logicalStorage: link.hostInput.logicalStorage },
    };
    const prepared = await Effect.runPromise(prepareProductLaunchWorkflow({ modules }));
    const profileRevision = revision("selected-product-launch-performance");
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
      modules, workflow: prepared.workflow, revision: profileRevision,
      requestCallLimit: productVariantPricingResources.calls,
      subscribers: [{ id: "selected-product-launch-performance",
        revision: revision("selected-product-launch-performance-subscriber") }],
    }));
    const runtimeConstructionMs = performance.now() - runtimeStarted;
    cleanup.push(() => Effect.runPromise(host.close));
    return Object.freeze({
      currency,
      profileRevision,
      resourceCalls: productVariantPricingResources.calls,
      provisioningAndInstallationMs: runtimeStarted - started,
      runtimeConstructionMs,
      prepareSeed: (suffix: string) => seedNativeProductAttemptGraph(currency, product, suffix, "launch"),
      retireLaunchedTag: (seed: Awaited<ReturnType<typeof seedNativeProductAttemptGraph>>["seed"],
        suffix: string) => runNativeStandaloneProductMutation(currency, product,
          `performance-retire-${suffix}`, "updateTag", { selector: { id: seed.tagId },
            update: { value: `launched-${suffix}` } }),
      run: (seed: Awaited<ReturnType<typeof seedNativeProductAttemptGraph>>["seed"]) =>
        Effect.runPromise(host.run(host.newRequestKey(), {
          product_id: seed.productId, tag_id: seed.tagId,
          variant_title: "Launch variant", usd_amount: 50,
        })),
      close: closeAll,
    });
  } catch (cause) {
    try { await closeAll(); }
    catch (cleanupCause) { throw new AggregateError([cause, cleanupCause],
      "Standalone Product launch preparation and cleanup failed"); }
    throw cause;
  }
}
