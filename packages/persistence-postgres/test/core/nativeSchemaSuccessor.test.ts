import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { isCoreNativeDefinitionSuccessor, makeCoreNativeDefinition, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { coreSchemaBundleExpectedTarget, isCoreSchemaBundleSuccessor, makeCoreSchemaBundle } from "../../src/core/schemaBundle";

const target = { scopeUuid: "023ac9ac-7d1f-4a72-b989-c0dd4cb9b99a", epochUuid: "99174910-8f7f-420e-9a1a-d046b06ca235" };
const content = Effect.fn("NativeSuccessor.content")(function* (relation = false, changedDefault = false, slug = "posts") {
  const source = yield* compilePayloadCollections([{ slug, fields: [
    { name: "title", type: "text", required: true, unique: true },
    { name: "score", type: "number", defaultValue: changedDefault ? 2 : 1, index: true },
    ...(relation ? [{ name: "relatedPost", type: "relationship", relationTo: slug }] : []),
  ] }]);
  return yield* makeCoreNativeDefinition({ ...target, source: source.sourceContract });
});
const neutralNative = Effect.fn("NativeSuccessor.neutralNative")(function* () {
  const origin = { kind: "authored", sourceId: "neutral.marker" };
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "system", lineageId: "neutral-model", tables: [{
    tableId: "markers", origin, columns: [{ columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin }],
    keys: [{ keyId: "marker.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [],
  }], capabilities: [] }));
  const provenance = { kind: "neutral-test-producer", version: 1 };
  const source = yield* captureLogicalSchemaSource({ key: "neutral-native", owner: "system", writeProfile: "neutral.markers",
    evidence: { provenance }, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "markers", table: { namespace: "system", logicalName: "neutral-model/markers" } }] });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance, commands: [] });
});

describe("selected native schema successor policy", () => {
  it("derives the exact scalar-to-optional-one addition from authenticated endpoint declarations", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const prior = yield* content(), next = yield* content(true), changed = yield* content(true, true);
      expect(isCoreNativeDefinitionSuccessor(prior, next)).toBe(true);
      expect(isCoreNativeDefinitionSuccessor(next, prior)).toBe(false);
      expect(isCoreNativeDefinitionSuccessor(prior, changed)).toBe(false);
      expect(isCoreNativeDefinitionSuccessor(yield* content(false, false, "news"), yield* content(true, false, "news"))).toBe(true);
      expect(isCoreNativeDefinitionSuccessor({ ...prior }, next)).toBe(false);
    }));
  });

  it("admits audit optional-field evolution with unchanged native producer meaning", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const payload = yield* content(true);
      const before = yield* prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ event: v.string() }) }));
      const after = yield* prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ event: v.string(), note62: v.optional(v.string()) }) }));
      const incompatible = yield* prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ event: v.string(), note62: v.string() }) }));
      const bundle = (application: typeof before) => makeCoreSchemaBundle({ sources: [
        { kind: "application", definition: application }, { kind: "native", definition: payload },
      ] });
      const prior = yield* bundle(before), next = yield* bundle(after);
      expect(isCoreSchemaBundleSuccessor(prior, next)).toBe(true);
      expect(isCoreSchemaBundleSuccessor(next, prior)).toBe(false);
      expect(isCoreSchemaBundleSuccessor(prior, yield* bundle(incompatible))).toBe(false);
      const neutralBefore = yield* prepareApplicationSchemaSource(defineSchema({ events: defineTable({ event: v.string() }) }));
      const neutralAfter = yield* prepareApplicationSchemaSource(defineSchema({ events: defineTable({ event: v.string(), detail: v.optional(v.string()) }) }));
      expect(isCoreSchemaBundleSuccessor(yield* bundle(neutralBefore), yield* bundle(neutralAfter))).toBe(true);
    }));
  });

  it("admits an authenticated native source addition with the entire existing source closure unchanged", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const payload = yield* content(true), extra = yield* neutralNative();
      const prior = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload }] });
      const next = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload }, { kind: "native", definition: extra }] });
      expect(isCoreSchemaBundleSuccessor(prior, next)).toBe(true);
      expect(isCoreSchemaBundleSuccessor(next, prior)).toBe(false);
      const changed = yield* content(true, true);
      const mixed = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: changed }, { kind: "native", definition: extra }] });
      expect(isCoreSchemaBundleSuccessor(prior, mixed)).toBe(false);
      const application = yield* prepareApplicationSchemaSource(defineSchema({ events: defineTable({ event: v.string() }) }));
      const addedApplication = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition: payload }, { kind: "application", definition: application }] });
      expect(isCoreSchemaBundleSuccessor(prior, addedApplication)).toBe(false);
      expect(isCoreSchemaBundleSuccessor(prior, { ...next })).toBe(false);
      const namespace = { kind: "byComponent" as const, id: yield* Effect.fromResult(encodeDocumentId(10001, new Uint8Array(16).fill(1))) };
      const foreignNamespace = yield* makeCoreSchemaBundle({ namespace,
        sources: [{ kind: "native", definition: payload }, { kind: "native", definition: extra }] });
      expect(isCoreSchemaBundleSuccessor(prior, foreignNamespace)).toBe(false);
      expect(coreSchemaBundleExpectedTarget(next, null, [prior])).toBe(false);
      expect(coreSchemaBundleExpectedTarget(next, null, [prior, next])).toBe(true);
      expect(coreSchemaBundleExpectedTarget(foreignNamespace, null, [prior, foreignNamespace])).toBe(false);
      expect(coreSchemaBundleExpectedTarget({ ...next }, null, [next])).toBe(false);
    }));
  });
});
