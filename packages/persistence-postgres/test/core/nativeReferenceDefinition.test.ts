import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeCoreNativeDefinition } from "../../src/core/nativePolicy";
import { CoreNativeReferenceSchema } from "../../src/core/nativePolicyTypes";

const target = { scopeUuid: "4ef2c539-a772-47df-bbdf-61aa6ff3eec7", epochUuid: "7074c389-5f08-4a97-8046-ab7f36ddc501" };

describe("authenticated optional-one native declarations", () => {
  it("keeps the complete configured declaration, bound endpoints and one ordinary reverse index", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([
        { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
        { slug: "articles", fields: [{ name: "title", type: "text", required: true },
          { name: "author", type: "relationship", relationTo: "authors" }] },
      ]);
      const definition = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
      expect(definition.references).toHaveLength(1);
      const reference = definition.references[0];
      expect(reference).toMatchObject({ sourceTable: "articles", targetTable: "authors", field: "author", indexName: "by_reference_author",
        declaration: { source: { table: "articles", path: [{ kind: "field", name: "author" }], forwardName: "author" },
          target: { table: "authors" }, value: { cardinality: "one", required: false }, inverse: { cardinality: "many", name: null },
          localized: false, onTargetDelete: "restrict" },
        reference: { sourceKey: "payload", source: { table: { namespace: "app", logicalName: "articles" }, field: "author" },
          target: { table: { namespace: "app", logicalName: "authors" }, field: "_id" } } });
      expect(Schema.is(CoreNativeReferenceSchema)(reference)).toBe(true);
      expect(Object.isFrozen(reference?.declaration.source.path)).toBe(true);
      expect(definition.schema.tables.find(table => table.tableName === "articles")?.indexes)
        .toContainEqual({ indexDescriptor: "by_reference_author", fields: ["author"] });
      expect(definition.source.definition.kind === "documents" && definition.source.definition.indexes
        .some(index => index.descriptor === "by_reference_author")).toBe(false);
    }));
  });

  it("preserves empty scalar policy meaning and refuses declaration/profile mismatch", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const compiled = yield* compilePayloadCollections([{ slug: "posts", fields: [{ name: "title", type: "text", required: true }] }]);
      const scalar = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
      expect(scalar.references).toEqual([]);
      expect(JSON.parse(scalar.metadata)).not.toHaveProperty("references");
      const mismatch = yield* Effect.result(makeCoreNativeDefinition({ ...target,
        source: { ...compiled.sourceContract, writeProfile: "payload.content-relations" } }));
      expect(Result.isFailure(mismatch)).toBe(true);
    }));
  });
});
