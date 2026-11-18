import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { compileLogicalDocumentReference, compileLogicalDocumentReferences } from "flarex-protocol/internal/logical-storage-requirements";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { checkCoreTableAccess, coreNativePolicyForTable, coreNativeStoredTables, isCoreNativeDefinitionSuccessor,
  makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { CoreNativeReferenceSchema, CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { isCorePrivateTable, isCoreSystemTable } from "../../src/core/nativeTableAccess";
import type { CoreNativeAuthority, CoreNativeDefinition } from "../../src/core/nativePolicy";
import type { CoreTableDefinition } from "../../src/core/api";
import { preparePayloadConformanceSource } from "../integration/payload/payloadNativeManyFixture";

const target = { scopeUuid: "4ef2c539-a772-47df-bbdf-61aa6ff3eec7", epochUuid: "7074c389-5f08-4a97-8046-ab7f36ddc501" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(1)));

describe("authenticated private native many lowering", () => {
  it.each(["payload.content-many", "payload.content-joins"] as const)("keeps %s source bindings public and derives its complete private schema", async profile => {
    const producer = await preparePayloadConformanceSource(profile);
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract, applicationRead: true });
      expect(definition.tables.map(table => table.name)).toEqual(["posts"]);
      expect(definition.privateTables).toHaveLength(1);
      expect(definition.references).toHaveLength(2);
      const many = definition.references.find(reference => "projection" in reference);
      if (many === undefined || !("projection" in many)) throw new Error("Missing private many reference");
      expect(many.reference).toMatchObject({ kind: "manyMembership", sourceKey: "payload" });
      expect(Schema.is(CoreNativeReferenceSchema)(many)).toBe(true);
      expect(definition.schema.tables.find(table => table.tableName === "posts")?.indexes)
        .not.toContainEqual({ indexDescriptor: many.indexName, fields: [many.field] });
      const privateTable = definition.privateTables?.[0];
      expect(privateTable?.name).toBe(many.projection.tableName);
      expect(privateTable?.name.startsWith("_")).toBe(false);
      const schema = definition.schema.tables.find(table => table.tableName === many.projection.tableName);
      expect(schema?.indexes).toEqual([
        { indexDescriptor: "by_source_target", fields: ["sourceId", "targetId"] },
        { indexDescriptor: "by_target_source", fields: ["targetId", "sourceId"] },
      ]);
      expect(coreNativeStoredTables(definition)).toHaveLength(2);
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
      expect(bundle.bindings.map(binding => binding.coreTableName)).toEqual(["posts"]);
      expect(bundle.schema.tables.map(table => table.tableName)).toEqual(["posts", many.projection.tableName]);
      expect(JSON.parse(definition.metadata)).toMatchObject({ format: "flarex.core-native-memberships", version: 1,
        loweringVersion: 1, privateTables: [{ name: many.projection.tableName }] });
      const recreated = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract, applicationRead: true });
      expect(recreated.metadata).toBe(definition.metadata);
      expect(recreated.identity).toEqual(definition.identity);
      expect(Object.isFrozen(many.projection)).toBe(true);
    }));
  });

  it("keeps scalar extension lowering singular and refuses a many declaration or foreign declaration", async () => {
    const producer = await preparePayloadConformanceSource("payload.content-many");
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract });
      const source = definition.source;
      if (source.definition.kind !== "documents") throw new Error("Expected document source");
      const scalar = source.definition.relations[0], many = source.definition.relations[1];
      if (scalar === undefined || many === undefined) throw new Error("Missing admitted declarations");
      expect(Result.getOrThrow(compileLogicalDocumentReferences(source))).toEqual([]);
      expect(Result.getOrThrow(compileLogicalDocumentReference(source, scalar)).source.field).toBe("relatedPost");
      expect(Result.isFailure(compileLogicalDocumentReference(source, many))).toBe(true);
      expect(Result.isFailure(compileLogicalDocumentReference(source, { ...scalar }))).toBe(true);
      const scalarDescriptor = definition.references.find(reference => !("projection" in reference));
      expect(Schema.is(CoreNativeReferenceSchema)({ ...scalarDescriptor, declaration: many })).toBe(false);
    }));
  });

  it("denies private table access to Application and even a presented native authority", async () => {
    const producer = await preparePayloadConformanceSource("payload.content-many");
    await Effect.runPromise(Effect.gen(function* () {
      const definition = yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract, applicationRead: true });
      const privateTable = definition.privateTables?.[0];
      if (privateTable === undefined) throw new Error("Missing private table");
      const policy = coreNativePolicyForTable(definition, privateTable, "active", schemaId);
      expect(policy).toMatchObject({ applicationRead: false, privateReference: { kind: "referenceMembership" }, uniqueConstraints: [] });
      expect(policy).not.toHaveProperty("references");
      const table: CoreTableDefinition = { name: privateTable.name, number: 10002, tabletId: new Uint8Array(16).fill(2),
        namespace: null, state: "active", indexes: [], nativePolicy: policy };
      const authority: CoreNativeAuthority = { definition, namespace: null, schemaId, authorityEpoch: 1n, tables: [table] };
      expect(isCorePrivateTable(table)).toBe(true);
      expect(isCoreSystemTable(table)).toBe(true);
      for (const mode of ["read", "write"] as const) {
        expect(Result.isFailure(checkCoreTableAccess(table, mode))).toBe(true);
        expect(Result.isFailure(checkCoreTableAccess(table, mode, authority))).toBe(true);
      }
      const accepts = Schema.is(CoreNativeTablePolicySchema);
      expect(accepts(policy)).toBe(true);
      expect(accepts({ ...policy, applicationRead: true })).toBe(false);
      expect(accepts({ ...policy, privateReference: { ...policy.privateReference, kind: "other" } })).toBe(false);
      expect(accepts({ ...policy, references: definition.references })).toBe(false);
    }));
  });

  it("preserves exact optional-one wire and refuses same-owner many/joins replacement", async () => {
    const producers = await Promise.all([preparePayloadConformanceSource("payload.content-relations"),
      preparePayloadConformanceSource("payload.content-many"), preparePayloadConformanceSource("payload.content-joins")]);
    await Effect.runPromise(Effect.gen(function* () {
      const definitions: CoreNativeDefinition[] = [];
      for (const producer of producers) definitions.push(yield* makeCoreNativeDefinition({ ...target, source: producer.sourceContract }));
      const [one, many, joins] = definitions;
      if (one === undefined || many === undefined || joins === undefined) throw new Error("Missing definitions");
      expect(one).not.toHaveProperty("privateTables");
      expect(JSON.parse(one.metadata)).not.toHaveProperty("format");
      expect(one.schema.tables.map(table => table.tableName)).toEqual(["posts"]);
      expect(isCoreNativeDefinitionSuccessor(one, many)).toBe(false);
      expect(isCoreNativeDefinitionSuccessor(many, joins)).toBe(false);
      const publicTable = one.tables[0];
      if (publicTable === undefined) throw new Error("Missing public table");
      const publicPolicy = coreNativePolicyForTable(one, publicTable, "active", schemaId);
      expect(publicPolicy).not.toHaveProperty("privateReference");
    }));
  });
});
