// @ts-check
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const admitted = new Set(promotion.files.map((file) => path.resolve(root, file.target).replaceAll("\\", "/")));
const inputs = new Set();
for (const entry of ["packages/medusa-link-modules/src/index.ts", "packages/medusa-modules-sdk/src/link.ts", "packages/medusa-adapter/src/product-sales-channel-link-service.ts", "packages/medusa-sales-channel/src/static-manifest.ts", "packages/medusa-adapter/src/sales-channel-schema.ts", "packages/medusa-adapter/src/sales-channel-service.ts", "packages/medusa-currency/src/static-manifest.ts", "packages/medusa-adapter/src/currency-service.ts", "packages/medusa-adapter/src/product-schema.ts", "packages/medusa-adapter/src/product-service.ts", "packages/medusa-core-flows/src/product/workflows/create-product-tags.ts", "packages/medusa-core-flows/src/product/workflows/update-product-tags.ts", "packages/medusa-core-flows/src/product/workflows/delete-product-tags.ts", "packages/medusa-workflows-sdk/src/runtime.ts", "packages/medusa-adapter/src/product-tag-workflow.ts", "packages/medusa-adapter/src/product-tag-update-workflow.ts", "packages/medusa-adapter/src/product-tag-delete-workflow.ts", "packages/medusa-core-flows/src/product/workflows/batch-variant-images.ts", "packages/medusa-adapter/src/product-variant-images-workflow.ts", "packages/medusa-adapter/src/product-tag-composition.ts", "packages/medusa-adapter/src/product-relationships-workflow.ts"]) {
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
      if (file.includes("third_party/medusa") || (!subscriberFactory && /mikro-orm|pglite|medusa-test-utils|medusa-deps|awilix/.test(file))) {
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
