import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { CollectionConfig } from "payload";
import { analyzeLoadedApplicationSourcePackageEffect } from "@flarex/analysis";
import { makeApplicationManifest, verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { compilePayloadCollections } from "../src/collections";
import { payloadScalarContentIdentity, payloadScalarConfiguration } from "../src/conformanceProfile";

const definitions = (): CollectionConfig[] => [
  { slug: "news-items", fields: [
    { name: "headline", type: "text", required: true, unique: true },
    { name: "priority", type: "number", required: true, defaultValue: 2 },
    { name: "visible", type: "checkbox", required: true },
    { name: "goLive", type: "date", required: true, defaultValue: "2026-09-11T00:00:00.000Z" },
  ] },
  { slug: "catalog", fields: [{ name: "sku", type: "text", required: true, unique: true }] },
];
const compile = (input: unknown) => Effect.runPromise(compilePayloadCollections(input));
const refusal = (input: unknown) => Effect.runPromise(Effect.result(compilePayloadCollections(input)));

describe("Payload collection compiler", () => {
  it("feeds two native collections through the real shared analysis and manifest verifier", async () => {
    const compiled = await compile(definitions());
    expect(compiled.configuration.tables.map(table => [table.collectionSlug, table.logicalTableName])).toEqual([
      ["catalog", "catalog"], ["news-items", "news_items"],
    ]);
    expect(compiled.configuration.tables[1]?.fields).toEqual([
      { name: "headline", kind: "text", unique: true }, { name: "priority", kind: "number", defaultValue: 2 },
      { name: "visible", kind: "boolean", defaultValue: false },
      { name: "goLive", kind: "date", defaultValue: "2026-09-11T00:00:00.000Z" },
      { name: "updatedAt", kind: "date" }, { name: "createdAt", kind: "date" },
    ]);
    const analysis = await Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({
      executionModules: {}, sourceMaps: {}, schemaDefinition: compiled.schemaDefinition,
    }));
    const manifest = await Effect.runPromise(makeApplicationManifest(analysis, {
      rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
      modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 64 }],
    }));
    expect(manifest.manifest.version).toBe(3);
    expect((await Effect.runPromise(verifyApplicationManifestV3(manifest.manifest))).canonicalText).toBe(manifest.canonicalText);
    const mismatched = { ...compiled.schemaDefinition, tables: { ...compiled.schemaDefinition.tables,
      catalog: { kind: "table", validator: { isFlarexValidator: true, json: { type: "object", value: {} } }, indexes: [] } } };
    expect(await Effect.runPromise(Effect.result(analyzeLoadedApplicationSourcePackageEffect({
      executionModules: {}, sourceMaps: {}, schemaDefinition: mismatched,
    })))).toMatchObject({ _tag: "Failure", failure: { _tag: "AnalyzerSchemaError" } });
  });

  it("owns evidence without freezing or mutating author data or sharing runtime collections", async () => {
    const input = definitions();
    const before = structuredClone(input);
    const compiled = await compile(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input[0]?.fields)).toBe(false);
    input[0]!.slug = "changed";
    input[0]!.fields.length = 0;
    const native = compiled.createNativeCollections();
    native[0]!.fields.length = 0;
    native[0]!.access!.read = () => false;
    expect(compiled.createNativeCollections()[0]?.fields).toHaveLength(4);
    expect(compiled.configuration.tables[1]?.collectionSlug).toBe("news-items");
    expect(Object.isFrozen(compiled.configuration.tables[1]?.fields[0])).toBe(true);
  });

  it("canonicalizes collection order but authenticates native field order, defaults, and uniqueness", async () => {
    const original = await compile(definitions());
    expect((await compile(definitions().reverse())).contentIdentity).toEqual(original.contentIdentity);
    const variants = [definitions(), definitions(), definitions()];
    variants[0]![0]!.fields.reverse();
    Object.assign(variants[1]![0]!.fields[1]!, { defaultValue: 3 });
    Reflect.deleteProperty(variants[2]![0]!.fields[0]!, "unique");
    for (const variant of variants) expect((await compile(variant)).contentIdentity.configSha256).not.toBe(original.contentIdentity.configSha256);
  });

  it("reproduces the fixed scalar descriptor from native authoring, not a second hand-written schema", async () => {
    const compiled = await compile([{ slug: "posts", fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "score", type: "number", required: true, defaultValue: 0 },
      { name: "enabled", type: "checkbox", required: true, defaultValue: false },
      { name: "publishedAt", type: "date", required: true },
    ] } satisfies CollectionConfig]);
    expect(compiled.contentIdentity).toEqual(payloadScalarContentIdentity);
    expect(compiled.configuration).toEqual(payloadScalarConfiguration);
  });

  it("rejects getters, executable options, inherited data, cycles, sparse arrays and extra keys before native sanitation", async () => {
    let calls = 0;
    const getter = definitions();
    Object.defineProperty(getter[0], "fields", { enumerable: true, get: () => { calls++; return []; } });
    const sparse = definitions(); Reflect.deleteProperty(sparse, "0");
    const extra = definitions(); Object.assign(extra, { surprise: true });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [getter, sparse, extra, cycle, [Object.create(definitions()[0]!)],
      [{ ...definitions()[0], hooks: { beforeChange: [() => { calls++; }] } }],
      [{ ...definitions()[0], fields: [{ name: "bad", type: "text", required: true, defaultValue: () => { calls++; return "bad"; } }] }],
      [{ ...definitions()[0], admin: {} }], [{ ...definitions()[0], fields: [], [Symbol("hidden")]: true }],
    ]) expect(await refusal(value)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(calls).toBe(0);
  });

  it("keeps native required-default validation and rejects unsupported field or collection semantics", async () => {
    for (const field of [
      { name: "value", type: "date", required: true, defaultValue: "not-a-date" },
      { name: "value", type: "text", required: true, defaultValue: "" },
      { name: "value", type: "number", required: true, defaultValue: "2" },
      { name: "value", type: "number", required: true, defaultValue: Infinity },
      { name: "value", type: "number", required: true, defaultValue: -0 },
      { name: "value", type: "text", required: true, defaultValue: null },
      { name: "value", type: "text", required: false },
      { name: "value", type: "text", required: true, unique: undefined },
      { name: "value", type: "number", required: true, unique: true },
      { name: "value", type: "relationship", relationTo: "catalog" },
      { name: "value", type: "text", required: true, index: true },
    ]) expect(Result.isFailure(await refusal([{ slug: "items", fields: [field] }]))).toBe(true);
    for (const flags of [{ timestamps: false }, { lockDocuments: true }, { enableQueryPresets: true }, { defaultSort: "headline" }, { auth: true }, { versions: true }]) {
      expect(Result.isFailure(await refusal([{ ...definitions()[0], ...flags }]))).toBe(true);
    }
  });

  it("refuses duplicate/reserved identities, ambiguous slug mapping and multiple unique fields", async () => {
    const original = definitions()[0]!;
    for (const input of [
      [original, original], [{ ...original, slug: "news_items" }, original],
      ...["users", "payload-preferences", "constructor", "_hidden"].map(slug => [{ ...original, slug }]),
      ...["id", "createdAt", "updatedAt", "constructor", "__proto__"].map(name => [{ ...original, fields: [{ name, type: "text", required: true }] }]),
      [{ ...original, fields: [original.fields[0], original.fields[0]] }],
      [{ ...original, fields: [original.fields[0], { name: "second", type: "text", required: true, unique: true }] }],
    ]) expect(Result.isFailure(await refusal(input))).toBe(true);
  });

  it("admits explicit collection/field ceilings and rejects excess counts and capture budget", async () => {
    const field = { name: "value", type: "text", required: true };
    const collections = Array.from({ length: 64 }, (_, index) => ({ slug: `items${index}`, fields: [field] }));
    expect((await compile(collections)).configuration.tables).toHaveLength(64);
    expect(Result.isFailure(await refusal([...collections, { slug: "excess", fields: [field] }]))).toBe(true);
    const fields = Array.from({ length: 62 }, (_, index) => ({ ...field, name: `field${index}` }));
    expect((await compile([{ slug: "items", fields }])).configuration.tables[0]?.fields).toHaveLength(64);
    expect(Result.isFailure(await refusal([{ slug: "items", fields: [...fields, { ...field, name: "excess" }] }]))).toBe(true);
    expect(Result.isFailure(await refusal([{ slug: "items", fields: [{ ...field, defaultValue: "x".repeat(1_048_576) }] }]))).toBe(true);
  });
});
