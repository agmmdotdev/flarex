import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { createPaymentCollectionForCartWorkflow, createPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { refreshPaymentCollectionForCartWorkflow, refreshPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows/cart/refresh-payment-collection";
import { createPaymentSessionsWorkflow, createPaymentSessionsWorkflowId } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { deletePaymentSessionsWorkflow, deletePaymentSessionsWorkflowId } from "@medusajs/core-flows/payment-collection/delete-payment-sessions";
import { createPaymentSessionStep, createPaymentSessionStepId } from "@medusajs/core-flows/payment-collection/create-payment-session-step";
import { updatePaymentCollectionStep, updatePaymentCollectionStepId } from "@medusajs/core-flows/payment-collection/update-payment-collection-step";
import { CartPaymentCollection } from "@medusajs/link-modules";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { paymentModuleExports, paymentModuleModels, paymentStaticResources } from "@medusajs/payment/static-manifest";
import { compileCartPaymentCollectionLinkCoreDefinition, compileCartPaymentCollectionLinkDefinition } from "../src/links/cart-payment-collection-schema";
import { compilePaymentCoreDefinition, compilePaymentDefinition, paymentModels } from "../src/modules/payment/schema";
import { nativeCartPaymentCollectionSourceTargets } from "./support/native-cart-payment-collection-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };

it("resolves the promoted Payment, Link and genuine Cart collection lifecycle source", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeCartPaymentCollectionSource"));
  expect(evidence.entries).toHaveLength(nativeCartPaymentCollectionSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
  expect(paymentModuleExports.service).toBe(PaymentModuleService);
  expect(paymentStaticResources.models).toBe(paymentModuleModels);
  expect(paymentModuleModels).toEqual(paymentModels);
  expect(SystemPaymentProvider.prototype.deletePayment).toBeTypeOf("function");
  expect(CartPaymentCollection.databaseConfig).toMatchObject({ tableName: "cart_payment_collection", idPrefix: "capaycol" });
  expect(createPaymentCollectionForCartWorkflowId).toBe("create-payment-collection-for-cart");
  expect(refreshPaymentCollectionForCartWorkflowId).toBe("refresh-payment-collection-for-cart");
  expect(createPaymentSessionsWorkflowId).toBe("create-payment-sessions");
  expect(deletePaymentSessionsWorkflowId).toBe("delete-payment-sessions");
  expect(createPaymentSessionStepId).toBe("create-payment-session");
  expect(updatePaymentCollectionStepId).toBe("update-payment-collection");
  for (const declaration of [createPaymentCollectionForCartWorkflow, refreshPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow,
    deletePaymentSessionsWorkflow, createPaymentSessionStep, updatePaymentCollectionStep]) expect(declaration).toBeTypeOf("function");
});

it("authenticates the complete Payment source and the mandatory Payment to Session key", async () => {
  const [native, compiled] = await Effect.runPromise(Effect.all([compilePaymentCoreDefinition(target), compilePaymentDefinition()]));
  const sourceKey = "medusa.payment";
  const localNames = ["account_holder", "capture", "payment", "payment_collection", "payment_collection_payment_providers", "payment_provider",
    "payment_session", "refund", "refund_reason"];
  expect(native.identity).toMatchObject({ ...target, sourceKey });
  expect(native.source).toMatchObject({ key: sourceKey, writeProfile: sourceKey, owner: "medusa",
    evidence: { provenance: compiled.provenance, profile: sourceKey } });
  expect(native.source.definition).toEqual({ kind: "relational", schema: compiled.schema });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings.toSorted((left, right) => left.localName.localeCompare(right.localName))).toEqual(localNames.map(localName => ({
    kind: "definition", localName, table: { namespace: "medusa", logicalName: `commerce.payment/${localName}` },
  })));
  expect(native.tables.map(table => table.localName).toSorted()).toEqual(localNames);
  expect(compiled.schema.capabilities.find(capability => capability.identity.capabilityId === "payment_collection.amount.exact-number"))
    .toMatchObject({ kind: "exactNumericCompanion", numericColumn: { tableId: "payment_collection", columnId: "amount" },
      rawColumn: { tableId: "payment_collection", columnId: "raw_amount" } });
  const payment = native.tables.find(table => table.localName === "payment");
  const session = native.tables.find(table => table.localName === "payment_session");
  if (payment === undefined || session === undefined) throw new Error("Missing authenticated Payment and Session");
  expect(compiled.schema.tables.find(table => table.identity.tableId === "payment")?.columns
    .find(column => column.identity.columnId === "payment_session_id")).toMatchObject({ type: "text", nullable: false });
  const foreignKey = payment.foreignKeys?.find(key => key.descriptor === "payment_payment_session_id_foreign");
  expect(foreignKey).toMatchObject({ sourceTable: payment.name, sourceFields: ["payment_session_id"], targetTable: session.name,
    targetFields: ["id"], targetIndexName: session.rowKey?.indexName, onDelete: "noAction", onUpdate: "noAction" });
  expect(payment.indexes).toContainEqual(expect.objectContaining({ indexName: foreignKey?.sourceIndexName, fields: ["payment_session_id"] }));
  expect(session.indexes).toContainEqual(expect.objectContaining({ nativeId: "IDX_payment_session_payment_collection_id",
    fields: ["deleted_at", "payment_collection_id"], requiredPrefix: { field: "deleted_at", value: null } }));
});

it("authenticates the full Link source and its native endpoint indexes", async () => {
  const [native, compiled] = await Effect.runPromise(Effect.all([compileCartPaymentCollectionLinkCoreDefinition(target),
    compileCartPaymentCollectionLinkDefinition()]));
  const sourceKey = "medusa.link.cartPaymentCollection", localName = "cart_payment_collection";
  expect(native.identity).toMatchObject({ ...target, sourceKey });
  expect(native.source).toMatchObject({ key: sourceKey, writeProfile: sourceKey, owner: "medusa",
    evidence: { provenance: compiled.provenance, profile: sourceKey } });
  expect(native.source.definition).toEqual({ kind: "relational", schema: compiled.schema });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings).toEqual([{ kind: "definition", localName,
    table: { namespace: "medusa", logicalName: "commerce.link.cart-payment-collection/cart_payment_collection" } }]);
  expect(native.tables.map(table => table.localName)).toEqual([localName]);
  const [link] = native.tables;
  if (link === undefined) throw new Error("Missing authenticated Cart PaymentCollection Link");
  expect(link.rowKey?.fields).toEqual(["cart_id", "payment_collection_id"]);
  expect(link.foreignKeys).toBeUndefined();
  const eligibility = { field: "deleted_at", value: null };
  expect(link.indexes).toContainEqual(expect.objectContaining({ fields: ["deleted_at", "cart_id"], requiredPrefix: eligibility }));
  expect(link.uniqueConstraints).toContainEqual(expect.objectContaining({ fields: ["payment_collection_id"], eligibility }));
});
