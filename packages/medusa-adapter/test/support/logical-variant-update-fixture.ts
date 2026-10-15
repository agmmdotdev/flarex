import { createHash } from "node:crypto";
import { Effect } from "effect";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareProductCreateWorkflow } from "../../src/workflows/product/create";
import { prepareProductVariantInventoryWorkflow } from "../../src/workflows/product/variant-inventory";
import { prepareProductVariantUpdateWorkflow, type ProductVariantUpdateHooks } from "../../src/workflows/product/variant-update";
import type { AtomicWorkflowExecution, AtomicWorkflowHostComposition } from "../../src/workflow/host";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { prepareLogicalProductHost } from "./logical-product-fixture";
import { prepareLogicalPricingHost } from "./logical-pricing-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./logical-inventory-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
export interface LogicalVariantUpdateFixture {
  readonly fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  readonly product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  readonly pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
  readonly inventory: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>>;
  readonly execution: AtomicWorkflowExecution;
  readonly modules: Parameters<typeof prepareProductVariantUpdateWorkflow>[0]["modules"];
  readonly prepare: (hooks?: ProductVariantUpdateHooks, execution?: AtomicWorkflowExecution, revision?: string) =>
    Promise<Effect.Success<ReturnType<typeof prepareProductVariantUpdateWorkflow>>>;
  readonly seed: (prefix: string, count?: number, inventoryLinks?: 1 | 2) =>
    Promise<Effect.Success<ReturnType<Effect.Success<ReturnType<typeof prepareProductVariantInventoryWorkflow>>["run"]>>>;
}
export async function prepareLogicalVariantUpdate(fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>,
  registerCleanup: (close: () => Promise<void>) => void): Promise<LogicalVariantUpdateFixture> {
  const product = await prepareLogicalProductHost(fixture);
  registerCleanup(() => Effect.runPromise(product.host.close));
  const pricing = await prepareLogicalPricingHost(fixture, "variant-updates");
  registerCleanup(() => Effect.runPromise(pricing.host.close));
  for (const member of [product, pricing]) await Effect.runPromise(member.host.initialize([]));
  const inventory = await prepareLogicalInventoryHosts(fixture, { variantLinks: "variant-updates" });
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const modules = {
    product: { module: product.runtime.variantUpdateWorkflow, logicalStorage: product.hostInput.logicalStorage },
    pricing: { module: pricing.runtime.workflow, logicalStorage: pricing.hostInput.logicalStorage },
    variant_links: { module: inventory.link.runtime.workflow, logicalStorage: inventory.link.hostInput.logicalStorage },
  };
  const prepare = (hooks: ProductVariantUpdateHooks = {}, selectedExecution = execution, selectedRevision = revision("native-variant-update")) =>
    Effect.runPromise(prepareProductVariantUpdateWorkflow({ execution: selectedExecution, modules,
      nativeLinks: inventory.link.runtime.nativeServices, hooks, revision: selectedRevision,
      subscribers: [{ id: "variant-update-test", revision: "a".repeat(64) }] }));
  const seed = async (prefix: string, count = 4, inventoryLinks: 1 | 2 = 1) => {
    if (inventoryLinks === 2) {
      const items = await prepareInventoryCreateHost(fixture, inventory.inventory);
      try {
        for (let offset = 0; offset < count * 2; offset += 4) await Effect.runPromise(items.host.run(items.host.newRequestKey(), items.create,
          Array.from({ length: Math.min(4, count * 2 - offset) }, (_, index) => ({ id: prefix + "-inventory-" + (offset + index), sku: prefix + "-item-" + (offset + index) }))));
      } finally { await Effect.runPromise(items.host.close); }
    }
    const productRoot = await Effect.runPromise(prepareProductCreateWorkflow({ execution,
      modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
      revision: revision("variant-update-product-seed"), subscribers: [{ id: "variant-update-seed", revision: "b".repeat(64) }] }));
    const variantRoot = await Effect.runPromise(prepareProductVariantInventoryWorkflow({ execution, modules: {
      product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage }, pricing: modules.pricing,
      inventory: { module: inventory.inventory.runtime.workflow, logicalStorage: inventory.inventory.hostInput.logicalStorage },
      stock_location: { module: inventory.stockLocation.runtime.workflow, logicalStorage: inventory.stockLocation.hostInput.logicalStorage },
      link: { module: inventory.link.runtime.workflow, logicalStorage: inventory.link.hostInput.logicalStorage },
    }, revision: revision("variant-update-variant-seed"), subscribers: [{ id: "variant-update-seed", revision: "b".repeat(64) }] }));
    try {
      await Effect.runPromise(productRoot.run(productRoot.newRequestKey(), { products: [{ id: prefix + "-product", title: prefix,
        options: [{ title: "Size", values: ["0", "1", "2", "3"] }] }] }));
      return await Effect.runPromise(variantRoot.run(variantRoot.newRequestKey(), { product_variants: Array.from({ length: count }, (_, index) => ({
        id: prefix + "-variant-" + index, product_id: prefix + "-product", title: prefix + index, sku: prefix + "-sku-" + index,
        options: { Size: String(index) }, prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "old" } },
          { currency_code: "EUR", amount: 200, rules: { region_id: "removed" } }],
        ...(inventoryLinks === 1 ? {} : { inventory_items: [{ inventory_item_id: prefix + "-inventory-" + index * 2, required_quantity: 2 },
          { inventory_item_id: prefix + "-inventory-" + (index * 2 + 1), required_quantity: 3 }] }),
      })) }));
    } finally { await Effect.runPromise(variantRoot.close); await Effect.runPromise(productRoot.close); }
  };
  return { fixture, product, pricing, inventory, execution, modules, prepare, seed };
}
