import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../src/links/order-payment-collection-schema";
import { compileOrderCoreDefinition } from "../src/modules/order/schema";
import { compilePaymentCoreDefinition } from "../src/modules/payment/schema";
import { nativePaymentFinanceSourceTargets } from "./support/native-payment-finance-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));
const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };

it("executes the promoted Payment, Order finance and retained callback source", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativePaymentFinanceSource"));
  expect(evidence.entries).toHaveLength(nativePaymentFinanceSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
});

it("issues the complete private finance sources with the generated Action ordering", async () => {
  const [payment, order, preserved, link] = await Effect.runPromise(Effect.all([
    compilePaymentCoreDefinition(target), compileOrderCoreDefinition(target, "generate"), compileOrderCoreDefinition(target),
    compileOrderPaymentCollectionLinkCoreDefinition(target),
  ]));
  expect([payment.identity.sourceKey, order.identity.sourceKey, link.identity.sourceKey])
    .toEqual(["medusa.payment", "medusa.order", "medusa.link.orderPaymentCollection"]);
  expect([payment.tables.length, order.tables.length, link.tables.length]).toEqual([9, 23, 1]);
  expect([payment.applicationRead, order.applicationRead, link.applicationRead]).toEqual([false, false, false]);
  expect(order.identity.definitionHash).not.toBe(preserved.identity.definitionHash);
  const definition = order.source.definition;
  if (definition.kind !== "relational") throw new Error("Missing generated Order source");
  const action = definition.schema.tables.find(table => table.identity.tableId === "order_change_action");
  expect(action?.columns.find(column => column.identity.columnId === "ordering")?.default.kind).toBe("serialNext");
  expect(link.tables[0]?.rowKey?.fields).toEqual(["order_id", "payment_collection_id"]);
});
