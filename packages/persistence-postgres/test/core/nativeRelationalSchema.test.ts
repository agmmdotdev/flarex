import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { Json } from "flarex-protocol/json";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition, type RelationalSchema } from "flarex-protocol/internal/relational-schema";
import { compileProductDefinition } from "../../../medusa-adapter/src/modules/product/definition";
import { compileCurrencyCoreDefinition } from "../../../medusa-adapter/src/modules/currency/schema";
import { compilePricingCoreDefinition, compilePricingDefinition } from "../../../medusa-adapter/src/modules/pricing/schema";
import { compileProductLinksDefinition } from "../../../medusa-adapter/src/links/product-definition";
import { coreNativeConstraintAccessFields, coreNativePolicyForTable, coreNativeRelationalRows,
  makeCoreRelationalNativeDefinition, sameCoreNativeTablePolicy } from "../../src/core/nativePolicy";
import { CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { coreNativeIndexName } from "../../src/core/schemaTableName";
import { encodeDocumentId } from "flarex-protocol/document-id";
import oldSuffixMetadata from "./fixtures/native-key-suffix-old-metadata.json" with { type: "json" };

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

const reverseOrigin = { kind: "synthetic", sourceId: "native-reverse-schema-test" } as const;
const reverseSchema = (coverage: "missing" | "declared" | "foreignKey" | "collision") => Result.getOrThrow(normalizeRelationalSchema({
  owner: "medusa", lineageId: reverseOrigin.sourceId, tables: [
    ...(coverage === "foreignKey" ? [{ tableId: "endpoint", origin: reverseOrigin, columns: [
      { columnId: "id", type: "text" as const, nullable: false, default: { kind: "none" as const }, origin: reverseOrigin },
    ], keys: [{ keyId: "endpoint.primary", kind: "primary" as const, columns: ["id"], origin: reverseOrigin }],
    indexes: [], constraints: [], relationships: [] }] : []),
    { tableId: "link", origin: reverseOrigin, columns: [
      ...["left", "right", "note"].map(columnId => ({ columnId, type: "text" as const, nullable: false,
        default: { kind: "none" as const }, origin: reverseOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: reverseOrigin },
    ], keys: [{ keyId: "link.primary", kind: "primary", columns: ["left", "right"], origin: reverseOrigin }], indexes: [
      { indexId: "link.active-right", kind: "btree", columns: ["right"],
        predicate: { kind: "isNull", columnId: "deleted_at" }, origin: reverseOrigin },
      ...(coverage === "declared" ? [{ indexId: "link.all-right", kind: "btree" as const, columns: ["right", "left"],
        predicate: null, origin: reverseOrigin }] : []),
      ...(coverage === "collision" ? [{ indexId: "key-reverse/right", kind: "btree" as const, columns: ["note"],
        predicate: null, origin: reverseOrigin }] : []),
    ], constraints: coverage === "foreignKey" ? [{ constraintId: "link.right", kind: "foreignKey", sourceColumns: ["right"],
      targetColumns: [{ tableId: "endpoint", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin: reverseOrigin }] : [],
    relationships: [] },
  ], capabilities: [],
}));

describe("complete native relational schema lowering", () => {
  it("infers missing unconditional suffix access without granting endpoint or uniqueness semantics", async () => {
    const definition = await Effect.runPromise(compile("medusa.reverse-schema-test", reverseSchema("missing"), reverseOrigin));
    const table = definition.tables[0];
    if (table?.table === undefined) throw new Error("Missing neutral reverse table");
    expect(table.indexes?.map(index => index.nativeId)).toEqual(["link.primary", "link.active-right", "key-reverse/right"]);
    expect(table.indexes?.find(index => index.nativeId === "key-reverse/right")).toEqual({ nativeId: "key-reverse/right", kind: "index",
      indexName: await Effect.runPromise(coreNativeIndexName(table.table, "index", "key-reverse/right")), fields: ["right"] });
    expect(table.uniqueConstraints.map(constraint => constraint.descriptor)).toEqual(["link.primary"]);
    expect(definition.foreignKeys).toBeUndefined();
    expect(definition.privateTables).toBeUndefined();
  });

  it("reuses declared unconditional leading coverage without renaming its access path", async () => {
    const definition = await Effect.runPromise(compile("medusa.reverse-schema-test", reverseSchema("declared"), reverseOrigin));
    const table = definition.tables[0];
    expect(table?.indexes?.map(index => index.nativeId)).toEqual(["link.primary", "link.active-right", "link.all-right"]);
    expect(table?.indexes?.find(index => index.nativeId === "link.all-right")).toMatchObject({ fields: ["right", "left"] });
    expect(table?.indexes?.filter(index => index.fields[0] === "right" && index.requiredPrefix === undefined)).toHaveLength(1);
  });

  it("retains the existing FK descriptor and index before deduplicating inferred reverse membership", async () => {
    const definition = await Effect.runPromise(compile("medusa.reverse-schema-test", reverseSchema("foreignKey"), reverseOrigin));
    const table = definition.tables.find(table => table.localName === "link");
    if (table?.table === undefined) throw new Error("Missing neutral FK reverse table");
    const expected = await Effect.runPromise(coreNativeIndexName(table.table, "index", "foreign-key/link.right"));
    expect(table.indexes?.map(index => index.nativeId)).toEqual(["link.primary", "link.active-right", "foreign-key/link.right"]);
    expect(table.indexes?.find(index => index.nativeId === "foreign-key/link.right"))
      .toEqual({ nativeId: "foreign-key/link.right", kind: "index", indexName: expected, fields: ["right"] });
    expect(definition.foreignKeys?.[0]).toMatchObject({ descriptor: "link.right", sourceIndexName: expected });
  });

  it("refuses a native descriptor collision instead of silently shadowing different index fields", async () => {
    const result = await Effect.runPromise(Effect.result(compile("medusa.reverse-schema-test", reverseSchema("collision"), reverseOrigin)));
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "unsupportedCapability",
      message: "Relational reverse access path collides with a native declaration" } });
  });

  it("preserves the authentic pre-correction Currency identity and stored metadata exactly", async () => {
    const previous = oldSuffixMetadata.unaffectedCurrency;
    const definition = await Effect.runPromise(compileCurrencyCoreDefinition({ scopeUuid: previous.identity.scopeUuid,
      epochUuid: previous.identity.epochUuid }));
    expect(definition.identity).toEqual(previous.identity);
    expect(definition.metadata).toBe(previous.metadata);
  });

  it("lowers the genuine complete Pricing text-predicate index as a nonunique ordinary superset", async () => {
    const native = await Effect.runPromise(compilePricingDefinition());
    const definition = await Effect.runPromise(compilePricingCoreDefinition(target));
    expect(definition.tables).toHaveLength(6);
    expect(definition.tables.map(table => table.localName).toSorted()).toEqual([
      "price", "price_list", "price_list_rule", "price_preference", "price_rule", "price_set",
    ]);
    const source = native.schema.tables.find(table => table.identity.tableId === "price_list");
    const table = definition.tables.find(table => table.localName === "price_list");
    const selected = source?.indexes.filter(index => index.predicate?.kind === "isNullAndTextEquals");
    expect(selected).toHaveLength(1);
    const declared = selected?.[0];
    if (declared === undefined || table?.table === undefined) throw new Error("Missing authentic PriceList text-predicate declaration");
    const nativeId = declared.identity.indexId;
    expect(nativeId).toBe("PriceList_id_status_starts_at_ends_at_0");
    const index = table?.indexes?.find(index => index.nativeId === nativeId);
    expect(declared).toMatchObject({ kind: "btree", predicate: { kind: "isNullAndTextEquals", value: "active",
      nullColumn: { tableId: "price_list", columnId: "deleted_at" }, textColumn: { tableId: "price_list", columnId: "status" } } });
    expect(declared?.columns.map(column => column.columnId)).toEqual(["id", "status", "starts_at", "ends_at"]);
    expect(index).toMatchObject({ nativeId, kind: "index", fields: ["deleted_at", "status", "id", "starts_at", "ends_at"],
      requiredPrefix: { all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }] } });
    expect(index?.indexName).toBe(await Effect.runPromise(coreNativeIndexName(table.table, "index", nativeId)));
    expect(table?.uniqueConstraints.some(constraint => constraint.descriptor === nativeId)).toBe(false);
    expect(definition.identity.sourceKey).toBe("medusa.pricing");
    expect(definition.identity.sourceSha256).toBe(definition.source.sourceSha256);
    expect(definition.schema.tables.find(schema => schema.tableName === table?.name)?.indexes.find(candidate => candidate.indexDescriptor === index?.indexName)?.fields)
      .toEqual(["deleted_at", "status", "id", "starts_at", "ends_at"]);
  });

  it("authenticates the exact text literal and refuses producer metadata with an unchanged source digest", async () => {
    const native = await Effect.runPromise(compilePricingDefinition());
    const selected = native.schema.tables.find(table => table.identity.tableId === "price_list")?.indexes
      .filter(index => index.predicate?.kind === "isNullAndTextEquals");
    expect(selected).toHaveLength(1);
    const sourceIndex = selected?.[0];
    if (sourceIndex === undefined) throw new Error("Missing authentic PriceList text-predicate declaration");
    const altered = Result.getOrThrow(normalizeRelationalSchema(relationalSchemaSourceFromDefinition({ ...native.schema,
      tables: native.schema.tables.map(table => ({ ...table, indexes: table.indexes.map(index => index.predicate?.kind === "isNullAndTextEquals"
        ? { ...index, predicate: { ...index.predicate, value: "draft" } } : index) })),
    })));
    const original = await Effect.runPromise(compile("medusa.pricing", native.schema, native.provenance));
    const changed = await Effect.runPromise(compile("medusa.pricing", altered, native.provenance));
    expect(changed.identity.sourceSha256).not.toBe(original.identity.sourceSha256);
    expect(changed.identity.definitionHash).not.toBe(original.identity.definitionHash);
    expect(changed.tables.find(table => table.localName === "price_list")?.indexes?.find(index => index.nativeId === sourceIndex.identity.indexId)?.requiredPrefix)
      .toEqual({ all: [{ field: "deleted_at", value: null }, { field: "status", value: "draft" }] });
    const refusal = await Effect.runPromise(Effect.result(makeCoreRelationalNativeDefinition({ ...target,
      source: { ...original.source, definition: { kind: "relational", schema: altered } }, provenance: native.provenance, commands: [] })));
    expect(refusal).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "unsupportedCapability" } });
  });

  it("refuses malformed text literals and columns before relational lowering can issue a source", async () => {
    const native = await Effect.runPromise(compilePricingDefinition());
    for (const value of [true, 1, null, { eq: "active" }]) {
      expect(Result.isFailure(normalizeRelationalSchema(relationalSchemaSourceFromDefinition({ ...native.schema,
        tables: native.schema.tables.map(table => ({ ...table, indexes: table.indexes.map(index => index.predicate?.kind === "isNullAndTextEquals"
          ? { ...index, predicate: { ...index.predicate, value } } : index) })),
      })))).toBe(true);
    }
    for (const columnId of ["starts_at", "missing_status"]) {
      expect(Result.isFailure(normalizeRelationalSchema(relationalSchemaSourceFromDefinition({ ...native.schema,
        tables: native.schema.tables.map(table => ({ ...table, indexes: table.indexes.map(index => index.predicate?.kind === "isNullAndTextEquals"
          ? { ...index, predicate: { ...index.predicate, textColumn: { ...index.predicate.textColumn, columnId } } } : index) })),
      })))).toBe(true);
    }
  });

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
        .some(constraint => constraint.eligibility !== undefined && "field" in constraint.eligibility
          && constraint.eligibility.field === "deleted_at")).toBe(true);
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
