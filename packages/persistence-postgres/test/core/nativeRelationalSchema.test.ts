import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { Json } from "flarex-protocol/json";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition } from "../../../medusa-adapter/src/modules/product/definition";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { compileProductLinksDefinition } from "../../../medusa-adapter/src/links/product-definition";
import { coreNativeConstraintAccessFields, coreNativePolicyForTable, coreNativeRelationalRows,
  makeCoreRelationalNativeDefinition, sameCoreNativeTablePolicy } from "../../src/core/nativePolicy";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { encodeDocumentId } from "flarex-protocol/document-id";

const target = { scopeUuid: "f2bfbf4a-271e-4a44-bcc8-7aa3c7fe59bd", epochUuid: "df564a72-4a2c-4265-8b96-83ac7c90ee1e" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(4)));
const compile = Effect.fn("NativeRelationalSchemaTest.compile")(function* (key: string, schema: RelationalSchema, provenance: Json) {
  const source = yield* captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key,
    evidence: { provenance }, definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({
      kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` },
    })) });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance, commands: [] });
});

describe("complete native relational schema lowering", () => {
  it("lowers the genuine Product graph, native tuple pivots and every FK and unique requirement", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const native = yield* compileProductDefinition();
      const definition = yield* compile("medusa.product", native.schema, native.provenance);
      expect(definition.tables).toHaveLength(13);
      expect(definition.tables.reduce((count, table) => count + (table.indexes?.length ?? 0), 0)).toBe(60);
      expect(definition.foreignKeys).toHaveLength(15);
      expect(definition.foreignKeys?.filter(key => key.onDelete === "cascade")).toHaveLength(11);
      expect(definition.foreignKeys?.filter(key => key.onDelete === "noAction")).toHaveLength(4);
      expect(definition.foreignKeys?.every(key => key.onUpdate === "noAction")).toBe(true);
      expect(definition.tables.reduce((count, table) => count + table.uniqueConstraints.length, 0)).toBe(24);
      for (const localName of ["product_category_product", "product_tags", "product_variant_option"]) {
        const table = definition.tables.find(candidate => candidate.localName === localName);
        expect(table?.rowKey?.fields).toHaveLength(2);
        expect(table?.privateReference).toBeUndefined();
        expect(coreNativeRelationalRows(definition, table?.name ?? "")?.rows.keyColumns).toEqual(table?.rowKey?.fields);
      }
      expect(definition.tables.find(table => table.localName === "product_variant_product_image")?.rowKey?.fields).toEqual(["id"]);
      for (const table of definition.tables) {
        const policy = coreNativePolicyForTable(definition, table, "active", schemaId);
        expect(Schema.is(CoreNativeTablePolicySchema)(policy)).toBe(true);
        expect(sameCoreNativeTablePolicy(policy, { ...policy,
          ...(policy.foreignKeys === undefined ? {} : { foreignKeys: policy.foreignKeys.map(key => ({ ...key })) }) })).toBe(true);
        if (table.foreignKeys !== undefined) expect(sameCoreNativeTablePolicy(policy, { ...policy,
          foreignKeys: table.foreignKeys.map(key => ({ ...key, onDelete: key.onDelete === "cascade" ? "noAction" : "cascade" })) })).toBe(false);
      }
    }));
  });

  it("keeps partial eligibility outside nullable native key semantics", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const native = yield* compileProductDefinition();
      const definition = yield* compile("medusa.product", native.schema, native.provenance);
      const variant = definition.tables.find(table => table.localName === "product_variant");
      const sku = variant?.uniqueConstraints.find(constraint => constraint.fields.length === 1 && constraint.fields[0] === "sku");
      expect(sku).toMatchObject({ fields: ["sku"], nullsDistinct: true, eligibility: { field: "deleted_at", value: null } });
      if (sku === undefined) return yield* Effect.die(new Error("Missing native SKU unique requirement"));
      expect(coreNativeConstraintAccessFields(sku)).toEqual(["deleted_at", "sku"]);
      expect(coreNativeConstraintAccessFields({ ...sku, fields: ["deleted_at", "sku"] })).toEqual(["deleted_at", "sku"]);
    }));
  });

  it("keeps stored Module Links as native business records without endpoint FKs", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const native = yield* compileProductLinksDefinition({ salesChannel: true, shippingProfile: true });
      const definition = yield* compile("medusa.product-links", native.schema, native.provenance);
      expect(definition.tables).toHaveLength(2);
      expect(definition.foreignKeys).toBeUndefined();
      expect(definition.privateTables).toBeUndefined();
      for (const table of definition.tables) {
        expect(table.rowKey?.fields).toEqual(table.localName === "product_sales_channel"
          ? ["product_id", "sales_channel_id"] : ["product_id", "shipping_profile_id"]);
      }
      expect(definition.tables.find(table => table.localName === "product_shipping_profile")?.uniqueConstraints
        .some(constraint => constraint.eligibility?.field === "deleted_at")).toBe(true);
    }));
  });

  it("preserves the old scalar Currency stored frame when relational extensions are unused", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* compileCurrencyCoreDefinition(target);
      const table = definition.tables[0];
      if (table === undefined) return yield* Effect.die(new Error("Missing Currency table"));
      const policy = coreNativePolicyForTable(definition, table, "active", schemaId);
      expect(policy).not.toHaveProperty("rowKey");
      expect(policy).not.toHaveProperty("foreignKeys");
      expect(definition.metadata).not.toContain('"rowKey"');
      expect(definition.metadata).not.toContain('"foreignKeys"');
      expect(definition.metadata).not.toContain('"eligibility"');
    }));
  });
});
