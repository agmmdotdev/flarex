import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareProductLaunchWorkflow } from "../src/product-launch-workflow";
import { productVariantPricingResources } from "../src/workflow/policy";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from "./support/logical-variant-pricing-link-fixture";
import { seedNativeProductAttemptGraph } from "./support/native-product-attempt-seed";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product launch test driver");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
let pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
let link: Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
const revision = (name: string) => createHash("sha256").update(name).digest("hex");

describe("selected native Product launch workflow", () => {
  beforeAll(async () => {
    connected = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantPricingLink: true,
    });
    product = await prepareLogicalProductHost(connected);
    pricing = await prepareLogicalPricingHost(connected);
    link = await prepareLogicalVariantPricingLinkHost(connected);
    for (const member of [product, pricing, link]) {
      await Effect.runPromise(member.host.initialize([]));
      await Effect.runPromise(member.host.close);
    }
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("runs both native children against pending graph state and retains one event publication", async () => {
    const { seed } = await seedNativeProductAttemptGraph(connected, product, "launch-native", "launch");
    const modules = {
      product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage },
      pricing: { module: pricing.runtime.workflow, logicalStorage: pricing.hostInput.logicalStorage },
      link: { module: link.runtime.workflow, logicalStorage: link.hostInput.logicalStorage },
    };
    const { workflow } = await Effect.runPromise(prepareProductLaunchWorkflow({ modules }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({
      execution: { identityAndAccessPolicy: connected.hostInput.identityAndAccessPolicy,
        prepare: composition => makeAtomicCommerceHost({ ...connected.hostInput, ...composition }) },
      modules, workflow, revision: revision("selected-product-launch"),
      requestCallLimit: productVariantPricingResources.calls,
      subscribers: [{ id: "selected-product-launch", revision: revision("selected-product-launch-subscriber") }],
    }));
    try {
      const key = host.newRequestKey();
      const input = { product_id: seed.productId, tag_id: seed.tagId,
        variant_title: "Launch Size 0", usd_amount: "12.5" };
      const beforeEvents = await connected.persistence.drizzle.select().from(fxSystemCommitEvents);
      const result = await Effect.runPromise(host.run(key, input));
      expect(result.pricing.variants).toHaveLength(1);
      expect(result.pricing.priceSets).toHaveLength(1);
      expect(result.pricing.priceSets[0]?.prices).toHaveLength(1);
      expect(result.pricing.priceSets[0]?.prices[0]?.currency_code).toBe("USD");
      expect(result.pricing.priceSets[0]?.prices[0]?.price_rules).toEqual([]);
      expect(result.pricing.links).toHaveLength(1);
      expect(result.tags).toMatchObject([{ id: seed.tagId, value: "launched" }]);
      expect(result.product.tags).toMatchObject([{ id: seed.tagId, value: "launched" }]);
      const afterRows = await connected.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await connected.persistence.drizzle.select().from(fxSystemCommitEvents);
      const emitted = afterEvents.slice(beforeEvents.length);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(emitted.map(event => event.envelope.contract)).toEqual(expect.arrayContaining([
        "product.product-variant.created", "pricing.price-set.created", "pricing.price.created",
        "LinkProductVariantPriceSet.attached", "product.product-tag.updated", "product-tag.updated",
      ]));
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
      expect(await connected.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await connected.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 150_000);
});
