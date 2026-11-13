import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storeCartHttpSourcePairs, verifyStoreCartHttpSelection, verifyStoreCartHttpSource, verifyStoreCartHttpSharedSources } from "./check-medusa-store-cart-source.mjs";
import { admitsCurrencyImport } from "./check-medusa-currency-promotion.mjs";

describe("native Store Cart HTTP source preservation", () => {
  it("confines the Category native list ABI proof to its authenticated producer", () => {
    const file = "packages/medusa-adapter/test/product-request-category-reads.test.ts";
    const specifier = "../../medusa-framework/src/http/utils/get-query-config";
    const target = "packages/medusa-framework/src/http/utils/get-query-config.ts";
    const source = "third_party/medusa/upstream/packages/core/framework/src/http/utils/get-query-config.ts";
    const promotion = { sourceCommit: "test", files: [{ target: file, classification: "authored", targetSha256: "test" },
      { target, source, classification: "frameworkHttpFork", targetSha256: "test", sourceSha256: "test" }],
      packages: [], buildFiles: [], testAliases: [] };
    expect(admitsCurrencyImport(promotion, file, specifier)).toBe(true);
    expect(admitsCurrencyImport(promotion, file.replace("category-reads", "category-adjacent"), specifier)).toBe(false);
    expect(admitsCurrencyImport(promotion, file, specifier + "/adjacent")).toBe(false);
    expect(admitsCurrencyImport({ ...promotion, files: promotion.files.filter(entry => entry.target !== target) }, file, specifier)).toBe(false);
    expect(admitsCurrencyImport({ ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, source: source + ".adjacent" } : entry) }, file, specifier)).toBe(false);
  });
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
    /** @type {import("./check-medusa-currency-promotion.mjs").Promotion} */
    const manifest = JSON.parse(readFileSync("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", "utf8"));
    verifyStoreCartHttpSelection(manifest.files);
    for (const pair of storeCartHttpSourcePairs) verifyStoreCartHttpSource(readFileSync(pair.source, "utf8"), readFileSync(pair.target, "utf8"), pair.target);
    verifyStoreCartHttpSharedSources(process.cwd());
  });
  it("confines the completion projection proof to the pinned Order query configuration", () => {
    const file = "packages/medusa-adapter/test/store-cart-completion-contracts.test.ts";
    const specifier = "../../medusa-http/src/api/store/orders/query-config";
    const target = "packages/medusa-http/src/api/store/orders/query-config.ts";
    const source = "third_party/medusa/upstream/packages/medusa/src/api/store/orders/query-config.ts";
    const promotion = { sourceCommit: "test", files: [{ target: file, classification: "authored", targetSha256: "test" },
      { target, source, classification: "unchanged", targetSha256: "test", sourceSha256: "test" }], packages: [], buildFiles: [], testAliases: [] };
    expect(admitsCurrencyImport(promotion, file, specifier)).toBe(true);
    expect(admitsCurrencyImport(promotion, file + ".adjacent", specifier)).toBe(false);
    expect(admitsCurrencyImport(promotion, file, specifier + "/adjacent")).toBe(false);
    expect(admitsCurrencyImport({ ...promotion, files: promotion.files.filter(entry => entry.target !== target) }, file, specifier)).toBe(false);
    expect(admitsCurrencyImport({ ...promotion, files: promotion.files.map(entry => entry.target === target ? { ...entry, source: source + ".adjacent" } : entry) }, file, specifier)).toBe(false);
  });
  it("uses the existing package exports for genuine mutation projection fields", () => {
    /** @type {import("./check-medusa-currency-promotion.mjs").Promotion} */
    const manifest = JSON.parse(readFileSync("roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", "utf8"));
    const file = "packages/medusa-adapter/test/store-cart-projection.test.ts";
    for (const specifier of ["@medusajs/core-flows/cart/variant-pricing-fields", "@medusajs/core-flows/cart/prepare-confirm-inventory-input"]) {
      expect(admitsCurrencyImport(manifest, file, specifier)).toBe(true);
      expect(admitsCurrencyImport(manifest, file, specifier + "/adjacent")).toBe(false);
      expect(admitsCurrencyImport({ ...manifest, packages: manifest.packages.map(pkg => pkg.name !== "@medusajs/core-flows" ? pkg :
        { ...pkg, exports: pkg.exports.filter(exported => exported !== "." + specifier.slice(pkg.name.length)) }) }, file, specifier)).toBe(false);
    }
  });
  it("rejects changes to native workflow selection, field defaults, validation and channel policy", () => {
    for (const [suffix, before, after] of [["store/carts/route.ts", '"create-cart"', '"update-cart"'],
      ["store/carts/[id]/route.ts", '"update-cart"', '"create-cart"'],
      ["store/carts/[id]/line-items/route.ts", '"add-to-cart"', '"create-cart"'],
      ["store/carts/[id]/line-items/[line_id]/route.ts", '"delete-line-items"', '"delete-cart"'],
      ["store/carts/[id]/line-items/[line_id]/route.ts", '"update-line-item-in-cart"', '"update-line-items"'],
      ["store/carts/[id]/promotions/route.ts", '"update-cart-promotions"', '"update-cart"'],
      ["store/carts/[id]/promotions/route.ts", "payload.promo_codes.length > 0", "payload.promo_codes.length >= 0"],
      ["store/carts/[id]/promotions/route.ts", "force_refresh_payment_collection: true", "force_refresh_payment_collection: false"],
      ["store/carts/[id]/promotions/route.ts", "action: PromotionActions.REMOVE", "action: PromotionActions.REPLACE"],
      ["store/carts/[id]/taxes/route.ts", '"update-tax-lines"', '"upsert-tax-lines"'],
      ["store/carts/[id]/taxes/route.ts", "force_tax_calculation: true", "force_tax_calculation: false"],
      ["store/carts/[id]/taxes/route.ts", "cart_id: req.params.id", "cart_id: req.validatedBody.cart_id"],
      ["store/carts/[id]/complete/route.ts", '"complete-cart"', '"create-cart"'],
      ["store/carts/[id]/complete/route.ts", "throwOnError: false,", "throwOnError: true,"],
      ["store/carts/[id]/complete/route.ts", "!transaction.hasFinished()", "transaction.hasFinished()"],
      ["store/carts/[id]/complete/route.ts", "MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR,", "MedusaError.Types.NOT_ALLOWED,"],
      ["store/carts/[id]/complete/route.ts", 'type: "order"', 'type: "cart"'],
      ["store/orders/query-config.ts", '"*items.detail"', '"*items.wrapper"'],
      ["store/orders/validators.ts", "StoreGetOrderParams = createSelectParams()", "StoreGetOrderParams = createSelectParams().strict()"],
      ["store/carts/[id]/shipping-methods/route.ts", '"add-shipping-method-to-cart"', '"refresh-cart-items"'],
      ["store/carts/[id]/shipping-methods/route.ts", "cart_id: req.params.id", "cart_id: payload.option_id"],
      ["store/shipping-options/route.ts", '"list-shipping-options-for-cart"', '"list-shipping-options-for-cart-with-pricing"'],
      ["store/shipping-options/route.ts", "is_return: !!is_return", "is_return: false"],
      ["store/shipping-options/query-config.ts", "defaultLimit: 20", "defaultLimit: 200"],
      ["store/shipping-options/validators.ts", "cart_id: z.string()", "cart_id: z.string().optional()"],
      ["store/payment-collections/route.ts", "if (!paymentCollection)", "if (paymentCollection)"],
      ["store/payment-collections/route.ts", '"create-payment-collection-for-cart"', '"refresh-payment-collection-for-cart"'],
      ["store/payment-collections/route.ts", "`payment_collection.${f}`", "`${f}`"],
      ["store/payment-collections/[id]/payment-sessions/route.ts", '"create-payment-sessions"', '"delete-payment-sessions"'],
      ["store/payment-collections/[id]/payment-sessions/route.ts", "customer_id: req.auth_context?.actor_id", "customer_id: req.body.customer_id"],
      ["store/payment-collections/[id]/payment-sessions/route.ts", "await workflowEngine.run(createPaymentSessionsWorkflowId, {", "await createPaymentSessionsWorkflow(req.scope).run({"],
      ["store/payment-collections/helpers.ts", 'entity: "payment_collection"', 'entity: "cart"'],
      ["store/payment-collections/query-config.ts", '"*payment_sessions"', '"payment_sessions.id"'],
      ["store/payment-collections/middlewares.ts", "validateAndTransformBody(StoreCreatePaymentSession)", "validateAndTransformBody(StoreCreatePaymentCollection)"],
      ["store/payment-collections/validators.ts", ".strict()", ".passthrough()"],
      ["store/carts/query-config.ts", '"item_total"', '"unsupported_total"'],
      ["store/carts/validators.ts", ".gt(0)", ".gte(0)"],
      ["store/carts/validators.ts", ".gte(0)", ".gt(0)"],
      ["store/carts/validators.ts", "StoreCalculateCartTaxes = createSelectParams()", "StoreCalculateCartTaxes = createSelectParams().strict()"],
      ["store/carts/middlewares.ts", 'matcher: "/store/carts/:id/line-items"', 'matcher: "/store/carts/:id/promotions"'],
      ["store/carts/middlewares.ts", "validateAndTransformBody(StoreCalculateCartTaxes)", "validateAndTransformBody(StoreUpdateCart)"],
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
