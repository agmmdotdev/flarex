import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { findOrCreateCustomerStep, findOrCreateCustomerStepId } from "@medusajs/core-flows/cart/find-or-create-customer";
import { Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer } from "@medusajs/customer/models";
import { CustomerModuleService } from "@medusajs/customer/services";
import { customerModuleExports, customerModuleModels, customerStaticResources } from "@medusajs/customer/static-manifest";
import { compileCustomerCoreDefinition, compileCustomerDefinition } from "../src/modules/customer/schema";
import { nativeCustomerSourceTargets } from "./support/native-customer-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));

it("executes the promoted Customer service, selection step, model closure and DML compiler", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeCustomerSource"));
  expect(evidence.entries).toHaveLength(nativeCustomerSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
  expect(customerModuleExports.service).toBe(CustomerModuleService);
  expect(customerStaticResources.models).toBe(customerModuleModels);
  expect(customerModuleModels).toEqual([Customer, CustomerAddress, CustomerGroup, CustomerGroupCustomer]);
  expect(findOrCreateCustomerStepId).toBe("find-or-create-customer");
  expect(findOrCreateCustomerStep).toBeTypeOf("function");
});

it("authenticates the complete Customer source with native identity, reference and active uniqueness", async () => {
  const target = { scopeUuid: "f54084af-06f7-48bf-949c-f8a9a7ee8284", epochUuid: "b2f2e203-4bda-4408-9b62-382b06b7b062" };
  const [native, compiled] = await Effect.runPromise(Effect.all([compileCustomerCoreDefinition(target), compileCustomerDefinition()]));
  const localNames = ["customer", "customer_address", "customer_group", "customer_group_customer"];
  expect(native.identity).toMatchObject({ ...target, sourceKey: "medusa.customer" });
  expect(native.source).toMatchObject({ key: "medusa.customer", writeProfile: "medusa.customer", owner: "medusa",
    definition: { kind: "relational", schema: compiled.schema }, evidence: { provenance: compiled.provenance, profile: "medusa.customer" } });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings.toSorted((left, right) => left.localName.localeCompare(right.localName))).toEqual(localNames.map(localName => ({
    kind: "definition", localName, table: { namespace: "medusa", logicalName: "commerce.customer/" + localName },
  })));
  expect(native.tables.map(table => table.localName).toSorted()).toEqual(localNames);
  for (const table of native.tables) {
    expect(table.rowKey?.fields).toEqual(["id"]);
    expect(table.indexes).toContainEqual({ kind: "key", nativeId: table.localName + ".primary",
      indexName: table.rowKey?.indexName, fields: ["id"] });
  }

  const customer = native.tables.find(table => table.localName === "customer");
  const address = native.tables.find(table => table.localName === "customer_address");
  const group = native.tables.find(table => table.localName === "customer_group");
  const membership = native.tables.find(table => table.localName === "customer_group_customer");
  if (customer === undefined || address === undefined || group === undefined || membership === undefined)
    throw new Error("Missing authenticated Customer closure");
  expect(address.foreignKeys).toMatchObject([{
    sourceTable: address.name, sourceFields: ["customer_id"], targetTable: customer.name, targetFields: ["id"], onDelete: "cascade",
  }]);
  expect(membership.foreignKeys).toHaveLength(2);
  expect(membership.foreignKeys).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceTable: membership.name, sourceFields: ["customer_id"],
      targetTable: customer.name, targetFields: ["id"] }),
    expect.objectContaining({ sourceTable: membership.name, sourceFields: ["customer_group_id"],
      targetTable: group.name, targetFields: ["id"] }),
  ]));
  expect(customer.uniqueConstraints).toEqual(expect.arrayContaining([expect.objectContaining({
    fields: ["email", "has_account"], eligibility: { field: "deleted_at", value: null }, nullsDistinct: true,
  })]));
  for (const field of ["is_default_billing", "is_default_shipping"]) {
    const eligibility = { all: [{ field: "deleted_at", value: null }, { field, value: true }] };
    const constraint = address.uniqueConstraints?.find(constraint => constraint.descriptor === "IDX_customer_address_unique_customer_" +
      (field === "is_default_billing" ? "billing" : "shipping"));
    expect(constraint).toMatchObject({ fields: ["customer_id"], eligibility, nullsDistinct: true });
    expect(address.indexes).toContainEqual({ kind: "index", nativeId: constraint?.descriptor, indexName: constraint?.indexName,
      fields: ["deleted_at", field, "customer_id"], requiredPrefix: eligibility });
  }
});
