import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeCartHttpSourcePairs, verifyStoreCartHttpSelection, verifyStoreCartHttpSource, verifyStoreCartHttpSharedSources } from "./check-medusa-store-cart-source.mjs";
import { admitsCurrencyImport } from "./check-medusa-currency-promotion.mjs";

describe("native Store Cart HTTP source preservation", () => {
  it("confines the default-projection preflight to its two authenticated native references", () => {
    const file = "packages/medusa-adapter/test/store-cart-projection.test.ts";
    const references = [
      ["../../medusa-framework/src/http/utils/get-query-config", "packages/medusa-framework/src/http/utils/get-query-config.ts", "third_party/medusa/upstream/packages/core/framework/src/http/utils/get-query-config.ts"],
      ["../../medusa-http/src/api/store/carts/query-config", "packages/medusa-http/src/api/store/carts/query-config.ts", "third_party/medusa/upstream/packages/medusa/src/api/store/carts/query-config.ts"],
    ];
    const promotion = { sourceCommit: "test", files: [{ target: file, classification: "authored", targetSha256: "test" },
      ...references.map(([, target, source]) => ({ target, source, classification: "storeHttpFork", targetSha256: "test", sourceSha256: "test" }))],
      packages: [], buildFiles: [], testAliases: [] };
    for (const [specifier, target] of references) {
      expect(admitsCurrencyImport(promotion, file, specifier)).toBe(true);
      expect(admitsCurrencyImport(promotion, file.replace("projection", "adjacent"), specifier)).toBe(false);
      expect(admitsCurrencyImport(promotion, file, specifier + "/adjacent")).toBe(false);
      expect(admitsCurrencyImport({ ...promotion, files: promotion.files.filter(entry => entry.target !== target) }, file, specifier)).toBe(false);
    }
  });
  it("authenticates every selected handler, middleware, validator and native refusal", () => {
    const manifest = JSON.parse(readFileSync("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", "utf8"));
    verifyStoreCartHttpSelection(manifest.files);
    for (const pair of storeCartHttpSourcePairs) verifyStoreCartHttpSource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8"), pair.target);
    verifyStoreCartHttpSharedSources(process.cwd());
  });
  it("rejects changes to native workflow selection, field defaults, validation and channel policy", () => {
    for (const [suffix, before, after] of [["store/carts/route.ts", '"create-cart"', '"update-cart"'],
      ["store/carts/query-config.ts", '"item_total"', '"unsupported_total"'],
      ["store/carts/validators.ts", ".gt(0)", ".gte(0)"],
      ["utils/middlewares/common/ensure-pub-key-sales-channel-match.ts", "pubKeySalesChannels.length > 1", "pubKeySalesChannels.length > 2"]]) {
      const pair = storeCartHttpSourcePairs.find(pair => pair.target.endsWith(suffix));
      if (!pair) throw new Error("Missing Cart mutation witness");
      const target = readFileSync(pair.target, "utf8");
      expect(target).toContain(before);
      expect(() => verifyStoreCartHttpSource(readFileSync(pair.source, "utf8"), target.replace(before, after), pair.target)).toThrow("Changed native Store Cart behavior");
    }
    expect(() => verifyStoreCartHttpSelection(storeCartHttpSourcePairs.slice(1))).toThrow("Unpinned Store Cart HTTP selection");
  });
});
