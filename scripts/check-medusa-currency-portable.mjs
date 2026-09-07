// @ts-check
import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";
import { verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const admitted = new Set(promotion.files.map((file) => path.resolve(root, file.target).replaceAll("\\", "/")));
const inputs = new Set();
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
      if (file.includes("third_party/medusa") || /mikro-orm|pglite|medusa-test-utils|medusa-deps|awilix/.test(file)) {
        throw new Error(`Comparison dependency in Currency portable graph: ${file}`);
      }
      if (file.includes("/packages/medusa-") && !admitted.has(file)) throw new Error(`Unlisted portable input: ${file}`);
      inputs.add(file);
    },
  }],
  build: {
    write: false,
    minify: false,
    lib: { entry: path.join(root, "packages/medusa-currency/src/static-manifest.ts"), formats: ["es"] },
  },
});
console.log(`Verified Currency static-manifest browser bundle across ${inputs.size} inputs; no Node, ORM, database, or island runtime imports.`);
