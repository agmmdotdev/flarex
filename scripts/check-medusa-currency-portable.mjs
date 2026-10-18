// @ts-check
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const admitted = new Set(promotion.files.map((file) => path.resolve(root, file.target).replaceAll("\\", "/")));
const inputs = new Set();
for (const entry of [
  "packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-options.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/create-shipping-options.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-option-create-service.ts",
  "packages/medusa-adapter/src/modules/region/service.ts",
  "packages/medusa-adapter/src/links/location-fulfillment-provider-service.ts",
  "packages/medusa-adapter/src/links/shipping-option-price-set-service.ts",
  "packages/medusa-fulfillment-manual/src/services/manual-fulfillment.ts",
  "packages/medusa-core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts",
  "packages/medusa-core-flows/src/fulfillment/steps/create-fulfillment-set.ts",
  "packages/medusa-core-flows/src/stock-location/steps/associate-locations-with-fulfillment-sets.ts",
  "packages/medusa-link-modules/src/definitions/fulfillment-set-location.ts",
  "packages/medusa-adapter/src/workflows/stock-location/create-location-fulfillment-set.ts",
  "packages/medusa-adapter/src/modules/fulfillment/fulfillment-set-create-service.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/batch-shipping-option-rules.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-option-rule-service.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-profiles.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/create-shipping-profiles.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-profile-create-service.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/delete-fulfillment-sets.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/delete-fulfillment-sets.ts",
  "packages/medusa-adapter/src/modules/fulfillment/fulfillment-set-delete-service.ts",
  "packages/medusa-adapter/src/links/fulfillment-set-deletion.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/update-service-zones.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/update-service-zones.ts",
  "packages/medusa-adapter/src/modules/fulfillment/service-zone-update-service.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/delete-service-zones.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/delete-service-zones.ts",
  "packages/medusa-adapter/src/modules/fulfillment/service-zone-delete-service.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/create-service-zones.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/create-service-zones.ts",
  "packages/medusa-adapter/src/modules/fulfillment/service-zone-create-service.ts",
  "packages/medusa-core-flows/src/shipping-options/workflows/delete-shipping-option-types.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/delete-shipping-option-types.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-option-type-delete-service.ts",
  "packages/medusa-adapter/src/links/shipping-option-type-deletion.ts",
  "packages/medusa-core-flows/src/shipping-options/workflows/update-shipping-option-types.ts",
  "packages/medusa-core-flows/src/shipping-options/workflows/create-shipping-option-types.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/create-shipping-option-types.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-option-type-service.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/update-shipping-option-types.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-option-type-update-service.ts",
  "packages/medusa-core-flows/src/shipping-profile/workflows/delete-shipping-profile.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/delete-shipping-profile.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-profile-delete-service.ts",
  "packages/medusa-adapter/src/links/shipping-profile-deletion.ts",
  "packages/medusa-core-flows/src/fulfillment/workflows/update-shipping-profiles.ts",
  "packages/medusa-adapter/src/workflows/fulfillment/update-shipping-profiles.ts",
  "packages/medusa-adapter/src/modules/fulfillment/shipping-profile-update-service.ts",
  "packages/medusa-core-flows/src/reservation/workflows/delete-reservations-by-line-items.ts",
  "packages/medusa-adapter/src/workflows/inventory/reservation-line-items.ts",
  "packages/medusa-adapter/src/modules/inventory/reservation-line-item-service.ts",
  "packages/medusa-core-flows/src/store/workflows/create-stores.ts",
  "packages/medusa-adapter/src/workflows/store/create.ts",
  "packages/medusa-core-flows/src/store/workflows/update-stores.ts",
  "packages/medusa-adapter/src/workflows/store/update.ts",
  "packages/medusa-adapter/src/modules/store/update-service.ts",
  "packages/medusa-adapter/src/modules/store/create-service.ts",
  "packages/medusa-core-flows/src/store/workflows/delete-stores.ts",
  "packages/medusa-adapter/src/workflows/store/delete.ts",
  "packages/medusa-adapter/src/modules/store/delete-service.ts",
  "packages/medusa-adapter/src/links/store-deletion.ts",
  "packages/medusa-adapter/src/workflows/inventory/create-levels.ts",
  "packages/medusa-adapter/src/workflows/inventory/create-items.ts",
  "packages/medusa-core-flows/src/inventory/workflows/batch-inventory-item-levels.ts",
  "packages/medusa-adapter/src/workflows/inventory/batch-levels.ts",
  "packages/medusa-core-flows/src/inventory/workflows/delete-inventory-items.ts",
  "packages/medusa-adapter/src/workflows/inventory/delete-items.ts",
  "packages/medusa-core-flows/src/inventory/workflows/delete-inventory-levels.ts",
  "packages/medusa-adapter/src/workflows/inventory/delete-levels.ts",
  "packages/medusa-core-flows/src/inventory/workflows/update-inventory-levels.ts",
  "packages/medusa-adapter/src/workflows/inventory/update-levels.ts",
  "packages/medusa-core-flows/src/inventory/workflows/update-inventory-items.ts",
  "packages/medusa-adapter/src/workflows/inventory/update-items.ts",
  "packages/medusa-core-flows/src/stock-location/workflows/delete-stock-locations.ts",
  "packages/medusa-adapter/src/workflows/stock-location/delete.ts",
  "packages/medusa-core-flows/src/stock-location/workflows/update-stock-locations.ts",
  "packages/medusa-adapter/src/workflows/stock-location/update.ts",
  "packages/medusa-core-flows/src/durable/product/workflows/import-products.ts",
  "packages/medusa-core-flows/src/sales-channel/workflows/create-sales-channels.ts",
  "packages/medusa-adapter/src/workflows/sales-channel/create.ts",
  "packages/medusa-core-flows/src/sales-channel/workflows/update-sales-channels.ts",
  "packages/medusa-adapter/src/workflows/sales-channel/update.ts",
  "packages/medusa-core-flows/src/sales-channel/workflows/delete-sales-channels.ts",
  "packages/medusa-adapter/src/workflows/sales-channel/delete.ts",
  "packages/medusa-store/src/static-manifest.ts",
  "packages/medusa-adapter/src/modules/store/service.ts",
  "packages/medusa-adapter/src/links/sales-channel-deletion.ts",
  "packages/medusa-workflows-sdk/src/durable/index.ts",
  "packages/medusa-workflows-sdk/src/durable/engine/index.ts",
  "packages/medusa-core-flows/src/product/steps/normalize-products.ts",
  "packages/medusa-notification/src/services/notification-delivery.ts",
  "packages/medusa-notification-local/src/services/local.ts",
  "packages/medusa-core-flows/src/product/workflows/batch-image-variants.ts",
  "packages/medusa-adapter/src/workflows/product/category-workflows.ts",
  "packages/medusa-adapter/src/workflows/product/option-workflows.ts",
  "packages/medusa-core-flows/src/product/workflows/create-product-options.ts",
  "packages/medusa-core-flows/src/product/workflows/update-product-options.ts",
  "packages/medusa-core-flows/src/product/workflows/delete-product-options.ts",
  "packages/medusa-core-flows/src/product-category/workflows/create-product-categories.ts",
  "packages/medusa-core-flows/src/product-category/workflows/update-product-categories.ts",
  "packages/medusa-core-flows/src/product-category/workflows/delete-product-categories.ts",
  "packages/medusa-adapter/src/workflows/product/collection-workflows.ts",
  "packages/medusa-adapter/src/workflows/product/type.ts",
  "packages/medusa-adapter/src/workflows/product/batch.ts",
  "packages/medusa-adapter/src/workflows/product/deletion.ts",
  "packages/medusa-adapter/src/workflows/product/update.ts", "packages/medusa-core-flows/src/product/workflows/update-products.ts", "packages/medusa-core-flows/src/product/workflows/upsert-variant-prices.ts", "packages/medusa-adapter/src/workflows/product/variant-update.ts", "packages/medusa-core-flows/src/product/workflows/update-product-variants.ts", "packages/medusa-adapter/src/workflows/stock-location/sales-channels.ts", "packages/medusa-adapter/src/links/sales-channel-location-service.ts", "packages/medusa-core-flows/src/stock-location/workflows/link-sales-channels-to-stock-location.ts", "packages/medusa-adapter/src/workflows/inventory/stock.ts", "packages/medusa-adapter/src/workflows/product/creation.ts", "packages/medusa-core-flows/src/product/workflows/create-products.ts", "packages/medusa-inventory/src/static-manifest.ts", "packages/medusa-stock-location/src/static-manifest.ts", "packages/medusa-adapter/src/modules/inventory/service.ts", "packages/medusa-adapter/src/modules/stock-location/service.ts", "packages/medusa-adapter/src/workflows/product/variant-inventory.ts", "packages/medusa-pricing/src/static-manifest.ts", "packages/medusa-adapter/src/modules/pricing/service.ts", "packages/medusa-adapter/src/workflows/product/variant-pricing.ts", "packages/medusa-fulfillment/src/static-manifest.ts", "packages/medusa-adapter/src/modules/fulfillment/shipping-profile-service.ts", "packages/medusa-adapter/src/workflows/product/shipping-profile.ts", "packages/medusa-link-modules/src/index.ts", "packages/medusa-modules-sdk/src/link.ts", "packages/medusa-adapter/src/links/product-sales-channel-service.ts", "packages/medusa-sales-channel/src/static-manifest.ts", "packages/medusa-adapter/src/modules/sales-channel/schema.ts", "packages/medusa-adapter/src/modules/sales-channel/service.ts", "packages/medusa-currency/src/static-manifest.ts", "packages/medusa-adapter/src/modules/currency/service.ts", "packages/medusa-adapter/src/modules/product/schema.ts", "packages/medusa-adapter/src/modules/product/service.ts", "packages/medusa-core-flows/src/product/workflows/create-product-tags.ts", "packages/medusa-core-flows/src/product/workflows/update-product-tags.ts", "packages/medusa-core-flows/src/product/workflows/delete-product-tags.ts", "packages/medusa-workflows-sdk/src/runtime.ts", "packages/medusa-adapter/src/workflows/product/tag.ts", "packages/medusa-adapter/src/workflows/product/tag-update.ts", "packages/medusa-adapter/src/workflows/product/tag-delete.ts", "packages/medusa-core-flows/src/product/workflows/batch-variant-images.ts", "packages/medusa-adapter/src/workflows/product/variant-images.ts", "packages/medusa-adapter/src/workflows/product/tag-composition.ts", "packages/medusa-adapter/src/workflows/product/relationships.ts", "packages/medusa-adapter/src/workflows/product/sales-channel.ts"]) {
await build({
  configFile: false,
  logLevel: "silent",
  resolve: { conditions: ["source", "browser"] },
  plugins: [{
    name: "currency-portable-boundary",
    resolveId(source) {
      if (source.startsWith("node:") || builtinModules.includes(source)) throw new Error(`Node import in Currency portable graph: ${source}`);
    },
    load(id) {
      const file = id.replaceAll("\\", "/");
      // The pinned subscriber factory has ORM types only; its retained function
      // name is not an ORM dependency. Every actual dependency is still checked.
      const subscriberFactory = file === path.resolve(root, "packages/medusa-utils/src/modules-sdk/create-medusa-mikro-orm-event-subscriber.ts").replaceAll("\\", "/");
      const parserSchemaFacade = file === path.resolve(root, "packages/medusa-deps/src/zod.ts").replaceAll("\\", "/");
      if (file.includes("third_party/medusa") || (!subscriberFactory && !parserSchemaFacade && /mikro-orm|pglite|medusa-test-utils|medusa-deps|awilix/.test(file))) {
        throw new Error(`Comparison dependency in Currency portable graph: ${file}`);
      }
      if (file.includes("/packages/medusa-") && !admitted.has(file)) throw new Error(`Unlisted portable input: ${file}`);
      inputs.add(file);
    },
  }],
  build: {
    write: false,
    minify: false,
    lib: { entry: path.join(root, entry), formats: ["es"] },
  },
});
}
console.log(`Verified Currency, Product and native workflow browser bundles across ${inputs.size} inputs; no Node, ORM, database, or island runtime imports.`);
