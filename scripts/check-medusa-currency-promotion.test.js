// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { admitsCurrencyImport, verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";
import { analyzeMedusaSourceIslandBoundary } from "./check-medusa-source-island-boundary.mjs";

const root = process.cwd();
const promotion = verifyCurrencyPromotion(root);
const source = "packages/medusa-currency/src/models/currency.ts";

describe("exact Currency promotion", () => {
  it("authenticates source, transformed inputs, package exports, and available build outputs", () => {
    expect(promotion.packages).toHaveLength(10);
    expect(promotion.files.some((file) => file.target === source && file.classification === "unchanged")).toBe(true);
  });
  it.each([
    ["changed target", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, targetSha256: "0".repeat(64) } : file) }],
    ["changed source", { ...promotion, files: promotion.files.map((file) => file.target === source ? { ...file, sourceSha256: "0".repeat(64) } : file) }],
    ["missing input", { ...promotion, files: promotion.files.filter((file) => file.target !== source) }],
    ["unapproved owner", { ...promotion, packages: promotion.packages.map((pkg) => ({ ...pkg, path: "packages/executor" })) }],
    ["unapproved transform", { ...promotion, files: promotion.files.map((file) => ({ ...file, classification: "anything" })) }],
  ])("rejects %s", (_name, input) => {
    expect(() => verifyCurrencyPromotion(root, input)).toThrow();
  });
  it.skipIf(!promotion.buildFiles.some((file) => existsSync(file.target)))("rejects changed available build outputs", () => {
    expect(() => verifyCurrencyPromotion(root, { ...promotion,
      buildFiles: promotion.buildFiles.map((file) => ({ ...file, targetSha256: "0".repeat(64) })),
    })).toThrow("Changed build target");
  });

  it("admits only a listed importer, dependency edge, and exact export", () => {
    expect(admitsCurrencyImport(promotion, source, "@medusajs/utils/dml/model")).toBe(true);
    expect(admitsCurrencyImport(promotion, source, "@medusajs/utils/private")).toBe(false);
    expect(admitsCurrencyImport(promotion, source, "@medusajs/test-utils/pglite-module-test-persistence-adapter")).toBe(false);
    expect(admitsCurrencyImport(promotion, "packages/medusa-currency/src/unlisted.ts", "@medusajs/utils/dml/model")).toBe(false);
    expect(admitsCurrencyImport(promotion, "packages/executor/src/index.ts", "@medusajs/utils/dml/model")).toBe(false);
  });

  it.each([
    "@medusajs/currency/models",
    "@medusajs/product/models",
    "@medusajs/drizzle/schema",
    "@flarex/medusa-adapter/internal/product-schema",
    "@flarex/medusa-adapter/internal/currency-schema",
    "../../medusa-currency/src/models/currency",
    "../../Medusa-Currency/dist/models/index.js",
    "file:///workspace/packages/medusa-currency/dist/models/currency.js",
    "file:///workspace/PACKAGES/Medusa-Currency/dist/models/currency.js",
    "C:/workspace/PACKAGES/Medusa-Currency/dist/models/currency.js",
  ])("keeps kernel imports forbidden: %s", (specifier) => {
    const result = analyzeMedusaSourceIslandBoundary({
      currencyPromotion: promotion,
      rootManifests: [], islandManifests: [], islandSources: [],
      rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n", rootScripts: {},
      rootSources: [{ relativePath: "packages/executor/src/index.ts", text: `import value from ${JSON.stringify(specifier)};` }],
    });
    expect(result.errors).toHaveLength(1);
  });

  it("retains byte-identical original compatibility assertions", () => {
    const tests = promotion.files.filter((file) => file.classification === "unchangedTest");
    expect(tests).toHaveLength(10);
    for (const file of tests) {
      if (!file.source) throw new Error("Missing original test source");
      expect(readFileSync(file.target)).toEqual(readFileSync(file.source));
    }
  });
  it("admits only the verified Product wrappers across the test package boundary", () => {
    const wrapper = "packages/medusa-adapter/test/product-upstream.test.ts";
    const specifier = "../../medusa-product/integration-tests/__tests__/product-module-service/events.spec";
    /** @param {string} file @param {string} imported @param {import("./check-medusa-currency-promotion.mjs").Promotion} manifest */
    const check = (file, imported, manifest = promotion) => analyzeMedusaSourceIslandBoundary({
      currencyPromotion: manifest, rootManifests: [], islandManifests: [], islandSources: [],
      rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n", rootScripts: {},
      rootSources: [{ relativePath: file, text: `import ${JSON.stringify(imported)};` }],
    }).errors;
    expect(check(wrapper, specifier)).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "products.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-types.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-tags.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-collections.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-options.spec"))).toEqual([]);
    expect(check(wrapper, specifier.replace("events.spec", "product-variants.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-variants-upstream.test.ts", specifier.replace("events.spec", "product-variants.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-variants-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-options-upstream.test.ts", specifier.replace("events.spec", "product-options.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-options-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-collections-upstream.test.ts", specifier.replace("events.spec", "product-collections.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-collections-upstream.test.ts", specifier)).toHaveLength(1);
    expect(check("packages/medusa-adapter/test/product-tags-upstream.test.ts", specifier.replace("events.spec", "product-tags.spec"))).toEqual([]);
    expect(check("packages/medusa-adapter/test/product-types-upstream.test.ts", specifier.replace("events.spec", "product-types.spec"))).toEqual([]);
    for (const [file, imported] of [["packages/medusa-adapter/test/product-types-upstream.test.ts", specifier], ["packages/medusa-adapter/test/product-query.test.ts", specifier], ["packages/medusa-adapter/src/product-service.ts", specifier],
      [wrapper, specifier.replace("events.spec", "variants.spec")], [wrapper, specifier + ".ts"]]) {
      expect(check(file, imported)).toHaveLength(1);
    }
    expect(check(wrapper, specifier, { ...promotion, files: promotion.files.filter(file => file.target !== wrapper) })).toHaveLength(1);
    expect(check(wrapper, specifier, { ...promotion, files: promotion.files.filter(file => file.target !== "packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts") })).toHaveLength(1);
    expect(check(wrapper, specifier, { ...promotion, testAliases: [] })).toHaveLength(1);
  });
});
