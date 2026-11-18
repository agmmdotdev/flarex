import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { checkoutCoreDefinitions } from "./support/checkout-core-definitions";
import { nativeCheckoutSourceTargets } from "./support/native-checkout-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  sourceCommit: Schema.String,
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));
const promotionManifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };
const active = { field: "deleted_at", value: null };

it("resolves the promoted checkout, payment, and generated Link implementations", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeCheckoutSource"));
  expect(evidence.entries).toHaveLength(nativeCheckoutSourceTargets.length);
  const { files } = decodeManifest(JSON.parse(readFileSync(promotionManifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
});

it("authenticates each exact checkout Link source with native tuple identity and endpoint access", async () => {
  const repository = "https://github.com/agmmdotdev/medusa-fork.git";
  const { sourceCommit: revision } = decodeManifest(JSON.parse(readFileSync(promotionManifest, "utf8")));
  const definitions = await Effect.runPromise(checkoutCoreDefinitions(target, true));
  const links = [
    { name: "order_cart_links", profile: "orderCart", lineage: "order-cart", table: "order_cart",
      endpoints: ["order_id", "cart_id"], activeUnique: [["order_id"]] },
    { name: "order_payment_collection_links", profile: "orderPaymentCollection", lineage: "order-payment-collection", table: "order_payment_collection",
      endpoints: ["order_id", "payment_collection_id"], activeUnique: [["payment_collection_id"]] },
    { name: "cart_promotion_links", profile: "cartPromotion", lineage: "cart-promotion", table: "cart_promotion",
      endpoints: ["cart_id", "promotion_id"], activeUnique: [] },
    { name: "customer_account_holder_links", profile: "customerAccountHolder", lineage: "customer-account-holder", table: "customer_account_holder",
      endpoints: ["customer_id", "account_holder_id"], activeUnique: [["account_holder_id"]] },
  ] as const;
  for (const selected of links) {
    const definition = definitions[selected.name];
    if (definition === undefined) throw new Error("Missing authenticated Link source " + selected.name);
    const sourceKey = `medusa.link.${selected.profile}`;
    expect(definition.identity).toMatchObject({ ...target, sourceKey });
    expect(definition.source).toMatchObject({ owner: "medusa", key: sourceKey, writeProfile: sourceKey,
      evidence: { profile: sourceKey, provenance: { kind: "sourceSnapshot", repository, revision, paths: [
        `packages/modules/link-modules/src/definitions/${selected.lineage}.ts`,
        "packages/modules/link-modules/src/utils/generate-entity.ts",
      ] } } });
    expect(definition.source.bindings).toEqual([{ kind: "definition", localName: selected.table,
      table: { namespace: "medusa", logicalName: `commerce.link.${selected.lineage}/${selected.table}` } }]);
    expect(definition.applicationRead).toBe(false);
    expect(definition.commands).toEqual([]);
    expect(definition.tables.map(table => table.localName)).toEqual([selected.table]);
    const [table] = definition.tables;
    if (table === undefined) throw new Error("Missing authenticated Link table " + selected.table);
    expect(table.rowKey?.fields).toEqual(selected.endpoints);
    expect(table.foreignKeys).toBeUndefined();
    for (const endpoint of selected.endpoints) {
      expect(table.indexes).toContainEqual(expect.objectContaining({ fields: ["deleted_at", endpoint], requiredPrefix: active }));
    }
    const activeUnique = table.uniqueConstraints.filter(constraint => constraint.eligibility !== undefined);
    expect(activeUnique.map(constraint => constraint.fields)).toEqual(selected.activeUnique);
    for (const constraint of activeUnique) expect(constraint.eligibility).toEqual(active);
  }
});
