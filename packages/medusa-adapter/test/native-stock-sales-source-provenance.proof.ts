import { describe, expect, inject, it } from "vitest";
import { Schema } from "effect";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { SalesChannelModuleService } from "@medusajs/sales-channel/services";
import { StoreModuleService } from "@medusajs/store/services";
import { ProductModuleService } from "@medusajs/product/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";

import { NativeSourceEvidenceSchema, nativeSourceTargets } from "./support/native-stock-sales-source-provenance";

const decodeEvidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema);

/** Explicit Source-config proof; its suffix keeps it out of default discovery.
 * Assert configured test-environment resolution and implementation hashes. */
describe("Stock/Sales native Source execution provenance", () => {
  it.each([
    { name: "Stock Location", resolved: StockLocationModuleService },
    { name: "Sales Channel", resolved: SalesChannelModuleService },
    { name: "Store guard", resolved: StoreModuleService },
    { name: "Product", resolved: ProductModuleService },
    { name: "Pricing", resolved: PricingModuleService },
    { name: "Inventory", resolved: InventoryModuleService },
    { name: "Fulfillment", resolved: FulfillmentModuleService },
    { name: "Fulfillment provider service", resolved: FulfillmentProviderService },
  ])("loads the promoted $name implementation through the package export", ({ name, resolved }) => {
    const evidence = decodeEvidence(inject("nativeStockSalesSource"));
    const target = nativeSourceTargets.find(target => target.name === name);
    if (target === undefined) throw new Error("Missing native Source proof target");
    expect(evidence.entries).toHaveLength(nativeSourceTargets.length);
    expect(evidence.entries.filter(entry => entry.name === name)).toMatchObject([{
      specifier: `@medusajs/${target.package}/services`,
      entry: `packages/medusa-${target.package}/src/services/index.ts`,
      leaf: `packages/medusa-${target.package}/src/services/${target.leaf}.ts`,
      external: false,
    }]);
    expect(typeof resolved).toBe("function");
  });
});
