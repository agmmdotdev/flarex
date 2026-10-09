import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { PostgresFixtureEndpoints } from "../../../persistence-postgres/test/postgresHelpers";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/atomicCommerce/host";
import { prepareProductLaunchWorkflow } from "../../src/product-launch-workflow";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { productVariantPricingResources } from "../../src/workflow/policy";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./logical-variant-pricing-link-fixture";
import { prepareNativeProductAttemptSeeder } from "./native-product-attempt-seed";

const revision = (value: string) => createHash("sha256").update(value).digest("hex");

/** The selected independently settling host, prepared once for a measured series.
 * Seeding and output checks belong outside each invocation interval. */
export async function prepareStandaloneProductLaunchPerformanceSeries(input?: Readonly<{
  driver?: "postgres" | "pglite"; postgresEndpoints?: PostgresFixtureEndpoints;
}>) {
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
    const currency = await logicalCurrencyFixture(input?.driver ?? "postgres", close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
      ...((input?.driver ?? "postgres") === "postgres" ? { protectedRuntime: true, managedRead: true } : {}),
      ...(input?.postgresEndpoints === undefined ? {} : { postgresEndpoints: input.postgresEndpoints }),
    });
    const product = await prepareLogicalProductHost(currency);
    const pricing = await prepareLogicalPricingHost(currency);
    const link = await prepareLogicalVariantPricingLinkHost(currency);
    for (const member of [product, pricing, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
    const runtimeStarted = performance.now();
    const seeder = await prepareNativeProductAttemptSeeder(currency, product, "selected-product-launch-performance");
    cleanup.push(seeder.close);
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
      prepareSeed: (suffix: string) => seeder.seed(suffix, "launch"),
      retireLaunchedTag: seeder.retireLaunchedTag,
      run: (seed: Awaited<ReturnType<typeof seeder.seed>>["seed"],
        decorateEffect?: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>) => {
        const work = host.run(host.newRequestKey(), {
          product_id: seed.productId, tag_id: seed.tagId,
          variant_title: "Launch variant", usd_amount: 50,
        });
        return Effect.runPromise(decorateEffect === undefined ? work : decorateEffect(work));
      },
      readCommittedProduct: seeder.readCommittedProduct,
      close: closeAll,
    });
  } catch (cause) {
    try { await closeAll(); }
    catch (cleanupCause) { throw new AggregateError([cause, cleanupCause],
      "Standalone Product launch preparation and cleanup failed"); }
    throw cause;
  }
}
