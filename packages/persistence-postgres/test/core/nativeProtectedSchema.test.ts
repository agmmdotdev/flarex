import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { compileProductCoreDefinition } from "../../../medusa-adapter/src/modules/product/schema";
import { makeCoreNativeDefinition, coreNativePolicyForTable } from "../../src/core/nativePolicy";
import { isCoreSchemaBundleSuccessor, makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { encodeDocumentId } from "flarex-protocol/document-id";

const target = { scopeUuid: "f2bfbf4a-271e-4a44-bcc8-7aa3c7fe59bd", epochUuid: "df564a72-4a2c-4265-8b96-83ac7c90ee1e" };
const schemaId = Result.getOrThrow(encodeDocumentId(532, new Uint8Array(16).fill(4)));
const fixture = Effect.fn("ProtectedSchemaTest.fixture")(function* () {
  const compiled = yield* compilePayloadCollections([{ slug: "articles", fields: [
    { name: "headline", type: "text", required: true }, { name: "featuredProduct", type: "text" },
  ] }]);
  const payload = yield* makeCoreNativeDefinition({ ...target, source: compiled.sourceContract });
  const product = yield* compileProductCoreDefinition(target);
  const candidate = yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
    deploymentId: "protected-test", scopeId: "protected-test", applicationAnalysis: { candidateId: "protected-test", analysisId: "protected-test",
      manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
    sources: [payload.source, product.source], extensions: [{ name: "article_product", sourceKey: "payload",
      source: { table: { namespace: "app", logicalName: "articles" }, field: "featuredProduct" },
      target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
      policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
      onTargetSoftDelete: "retain", onTargetDelete: "restrict" }] });
  return { candidate, payload, product };
});

describe("authenticated protected reference schema closure", () => {
  it("uses the genuine prepared extension and preserves both native source identities", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const { candidate, payload, product } = yield* fixture();
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload }, { kind: "native", definition: product }], candidate });
      const reference = bundle.protectedReferences?.[0];
      expect(reference).toMatchObject({ sourceTable: "articles", field: "featuredProduct", targetField: "id",
        sourceIdentity: { sourceKey: "payload", sourceSha256: payload.source.sourceSha256 },
        targetIdentity: { sourceKey: "medusa.product", sourceSha256: product.source.sourceSha256 },
        reference: { liveness: { target: { kind: "softDeleteNull", field: "deleted_at" } }, onTargetSoftDelete: "retain" } });
      expect(payload.references).toEqual([]);
      expect(product.references).toEqual([]);
      expect(bundle.schema.tables.find(table => table.tableName === "articles")?.indexes)
        .toContainEqual({ indexDescriptor: reference?.indexName, fields: ["featuredProduct"] });
      const declaration = product.tables.find(table => table.localName === "product");
      if (declaration === undefined) return yield* Effect.die(new Error("Missing native Product table"));
      expect(coreNativePolicyForTable(product, declaration, "active", schemaId, bundle.protectedReferences).protectedReferences)
        .toEqual(bundle.protectedReferences);
    }));
  });

  it("refuses a candidate whose document source differs from the issued producer", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const { candidate, product } = yield* fixture();
      const changed = yield* compilePayloadCollections([{ slug: "articles", fields: [
        { name: "headline", type: "text", required: true }, { name: "featuredProduct", type: "text" },
        { name: "extra", type: "text" },
      ] }]);
      const payload = yield* makeCoreNativeDefinition({ ...target, source: changed.sourceContract });
      const result = yield* Effect.result(makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload },
        { kind: "native", definition: product }], candidate }));
      expect(Result.isFailure(result)).toBe(true);
    }));
  });

  it("admits compatible unrelated source additions without changing protected endpoint policy", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const product = yield* compileProductCoreDefinition(target);
      const before = yield* prepareApplicationSchemaSource(defineSchema({ users: defineTable({ product: v.optional(v.string()) }) }));
      const after = yield* prepareApplicationSchemaSource(defineSchema({ users: defineTable({ product: v.optional(v.string()), audit: v.optional(v.string()) }) }));
      const make = Effect.fn(function* (application: typeof before, retain: boolean) {
        const candidate = yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
          deploymentId: "protected-test", scopeId: "protected-test", applicationAnalysis: { candidateId: "protected-test", analysisId: "protected-test",
            manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
          sources: [application.source, product.source], extensions: [{ name: "user_product", sourceKey: "application",
            source: { table: { namespace: "app", logicalName: "users" }, field: "product" },
            target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
            policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
            ...(retain ? { onTargetSoftDelete: "retain" as const } : {}), onTargetDelete: "restrict" }] });
        return yield* makeCoreSchemaBundle({ sources: [{ kind: "application", definition: application }, { kind: "native", definition: product }], candidate });
      });
      const original = yield* make(before, true), compatible = yield* make(after, true), changed = yield* make(after, false);
      expect(original.protectedReferences?.[0]?.sourceIdentity.sourceSha256)
        .not.toBe(compatible.protectedReferences?.[0]?.sourceIdentity.sourceSha256);
      expect(isCoreSchemaBundleSuccessor(original, compatible)).toBe(true);
      expect(isCoreSchemaBundleSuccessor(original, changed)).toBe(false);
    }));
  });
});
