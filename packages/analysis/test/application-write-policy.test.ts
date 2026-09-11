import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";

import { analyzeLoadedApplicationSourcePackageEffect } from "../src/index.ts";
import { ApplicationManifestSchema, canonicalizeApplicationManifest, makeApplicationManifest } from "../src/applicationAnalysis.ts";
import { verifyApplicationManifestV3 } from "../src/applicationAnalysisV3.ts";
import { applicationSchemaPublicationFrame } from "../src/applicationPublicationFramesV2.ts";
import { captureApplicationWritePolicyData, decodeApplicationWritePolicies } from "../src/applicationWritePolicy/capture.ts";
import { verifyApplicationWritePolicies } from "../src/applicationWritePolicy/verification.ts";
import type { ApplicationWritePolicies } from "../src/applicationWritePolicy/model.ts";

describe("Application write-policy evidence", () => {
  it("authenticates one required text unique declaration without reinterpreting old descriptor bytes", async () => {
    const fixture = policyFixture();
    const configure = (fields: Json, version = 2) => ({ ...fixture, configuration: {
      ...fixture.configuration, version, tables: [{ logicalTableName: "posts", fields }],
    } });
    const unique = configure([{ name: "title", kind: "text", unique: true }]);
    expect(Result.isSuccess(decodeApplicationWritePolicies(unique, ["audit", "posts"]))).toBe(true);
    expect(hash(unique.configuration)).not.toBe(hash(fixture.configuration));
    for (const invalid of [
      configure([{ name: "title", kind: "text" }], 1),
      configure([{ name: "title", kind: "number", unique: true }]),
      configure([{ name: "other", kind: "text", unique: true }, { name: "title", kind: "text", unique: true }]),
      { ...unique, configuration: { ...unique.configuration, tables: [{ logicalTableName: "posts", fields: [{ name: "title", kind: "text", unique: undefined }] }] } },
      configure([{ name: "title", kind: "text", unique: false }]),
    ]) expect(Result.isFailure(decodeApplicationWritePolicies(invalid, ["audit", "posts"]))).toBe(true);
    const result = await Effect.runPromise(Effect.result(verifyApplicationWritePolicies(unique, ["audit", "posts"])));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "digestMismatch" } });
  });
  it("owns the evidence and verifies independent hashes for the complete set and each table", async () => {
    const input = policyFixture();
    const verified = await Effect.runPromise(verifyApplicationWritePolicies(input, ["posts", "audit"]));
    expect(verified.policySetSha256).toBe(hash(input));
    expect(verified.tables.map(table => table.writePolicySha256)).toEqual(input.tables.map(table =>
      hash({ format: "flarex.application-table-write-policy", version: 1, ...table })));
    input.configuration.tables[0]!.fields[0]!.name = "changed";
    expect(verified.policies.configuration.tables[0]?.fields[0]?.name).toBe("title");
    expect(Object.isFrozen(verified.policies.configuration.tables[0]?.fields[0])).toBe(true);
  });

  it("rejects unknown fields, accessors, array extras, holes, cycles and executable configuration without invoking getters", () => {
    let reads = 0;
    const getter = policyFixture();
    Object.defineProperty(getter.configuration, "profile", { enumerable: true, get: () => { reads++; return "payload.scalar"; } });
    const arrayGetter = policyFixture();
    Object.defineProperty(arrayGetter.tables, "0", { enumerable: true, get: () => { reads++; return {}; } });
    const extras = policyFixture();
    Object.assign(extras.tables, { extra: true });
    const sparse = policyFixture();
    Reflect.deleteProperty(sparse.tables, "0");
    const cycle = policyFixture();
    Object.assign(cycle.configuration, { cycle });
    const cases: unknown[] = [
      { ...policyFixture(), future: true }, getter, arrayGetter, extras, sparse, cycle,
      { ...policyFixture(), configuration: () => ({}) },
      { ...policyFixture(), [Symbol("hidden")]: true },
    ];
    for (const input of cases) expect(Result.isFailure(decodeApplicationWritePolicies(input, ["audit", "posts"]))).toBe(true);
    expect(reads).toBe(0);
  });

  it("refuses duplicate identities, missing policies, unsorted entries and managed/configuration disagreement", () => {
    const fixture = policyFixture();
    for (const tables of [
      [fixture.tables[0], fixture.tables[0]],
      [fixture.tables[0]],
      [...fixture.tables].reverse(),
      [fixture.tables[0], { logicalTableName: "posts", owner: "application" }],
    ]) expect(Result.isFailure(decodeApplicationWritePolicies({ ...fixture, tables }, ["audit", "posts"]))).toBe(true);
  });

  it("does not treat hash-shaped configuration or provenance references as proof", async () => {
    const configMismatch = policyFixture();
    configMismatch.tables[1]!.configSha256 = "a".repeat(64);
    const provenanceMismatch = policyFixture();
    provenanceMismatch.configuration.provenanceSha256 = "b".repeat(64);
    for (const input of [configMismatch, provenanceMismatch]) {
      const result = await Effect.runPromise(Effect.result(verifyApplicationWritePolicies(input, ["audit", "posts"])));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "digestMismatch" } });
    }
  });

  it("rejects rehashed scalar configuration mismatches, including inherited property names", async () => {
    for (const field of [
      { name: "title", kind: "number" }, { name: "missing", kind: "text" },
      { name: "constructor", kind: "text" }, { name: "__proto__", kind: "text" },
    ]) {
      const original = policyFixture();
      const configuration = { ...original.configuration, tables: [{ logicalTableName: "posts", fields: [field] }] };
      const writePolicies = { ...original, configuration, tables: [original.tables[0], {
        ...original.tables[1], configSha256: hash(configuration),
      }] };
      const result = await Effect.runPromise(Effect.result(analyzeLoadedApplicationSourcePackageEffect({
        executionModules: {}, sourceMaps: {},
        schemaDefinition: { tables: { audit: schemaTable(), posts: schemaTable() }, relations: [], writePolicies },
      })));
      expect(result).toMatchObject({ _tag: "Failure", failure: {
        _tag: "AnalyzerSchemaError", cause: { reason: "configurationMismatch" },
      } });
    }
  });

  it("refuses inherited policy data/getters and preserves own policies when a Proxy has trap lies", async () => {
    let getterCalls = 0;
    const inheritedGetter = Object.defineProperty({}, "writePolicies", { get: () => { getterCalls++; return policyFixture(); } });
    for (const prototype of [{ writePolicies: policyFixture() }, inheritedGetter]) {
      const schemaDefinition = Object.assign(Object.create(prototype), { tables: { audit: schemaTable(), posts: schemaTable() }, relations: [] });
      const result = await Effect.runPromise(Effect.result(analyzeLoadedApplicationSourcePackageEffect({
        executionModules: {}, sourceMaps: {}, schemaDefinition,
      })));
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "AnalyzerSchemaError" } });
    }
    expect(getterCalls).toBe(0);
    const schemaDefinition = new Proxy({ tables: { audit: schemaTable(), posts: schemaTable() }, relations: [], writePolicies: policyFixture() }, { has: () => false });
    const analysis = await Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({
      executionModules: {}, sourceMaps: {}, schemaDefinition,
    }));
    expect(analysis.writePolicies).toEqual(policyFixture());
  });

  it("admits exactly 64 table declarations and refuses a sixty-fifth before traversal", () => {
    const fixture = policyFixture();
    const names = Array.from({ length: 63 }, (_, index) => `app${String(index).padStart(2, "0")}`);
    const declarations = names.map(logicalTableName => ({ logicalTableName, owner: "application" }));
    const atLimit = { ...fixture, tables: [...declarations, fixture.tables[1]] };
    expect(Result.isSuccess(decodeApplicationWritePolicies(atLimit, [...names, "posts"]))).toBe(true);
    let traversed = false;
    const excessive = [...atLimit.tables, { logicalTableName: "zzz", owner: "application" }];
    Object.defineProperty(excessive, "0", { enumerable: true, get: () => { traversed = true; return {}; } });
    expect(captureApplicationWritePolicyData({ ...fixture, tables: excessive })).toMatchObject({
      _tag: "Failure", failure: { reason: "limitExceeded" },
    });
    expect(traversed).toBe(false);
  });

  it("measures canonical UTF-8 bytes and refuses excess depth", () => {
    expect(Result.isSuccess(captureApplicationWritePolicyData("x".repeat(1_048_574)))).toBe(true);
    expect(captureApplicationWritePolicyData("x".repeat(1_048_575))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(captureApplicationWritePolicyData("é".repeat(524_288))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    let nested: unknown = null;
    for (let index = 0; index < 10; index++) nested = { child: nested };
    expect(captureApplicationWritePolicyData(nested)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("carries policy evidence through trusted analysis, V3 roundtrip and schema publication with zero relations", async () => {
    const policies = policyFixture();
    const analysis = await Effect.runPromise(analyzeLoadedApplicationSourcePackageEffect({
      executionModules: {}, sourceMaps: {},
      schemaDefinition: {
        tables: { audit: schemaTable(), posts: schemaTable() },
        relations: [], writePolicies: policies,
      },
    }));
    const manifest = await Effect.runPromise(makeApplicationManifest(analysis, {
      rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
      modules: [
        { path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 48 },
        { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 64 },
      ],
    }));
    expect(manifest.manifest.version).toBe(3);
    const mutableBytes = manifest.canonicalBytes;
    mutableBytes.fill(0);
    expect(new TextDecoder().decode(manifest.canonicalBytes)).toBe(manifest.canonicalText);
    expect(Result.getOrThrow(canonicalizeApplicationManifest(manifest.manifest)).canonicalBytes).toEqual(manifest.canonicalBytes);
    expect(Result.getOrThrow(Schema.decodeUnknownResult(ApplicationManifestSchema)(manifest.manifest))).toEqual(manifest.manifest);
    expect((await Effect.runPromise(verifyApplicationManifestV3(manifest.manifest))).canonicalBytes).toEqual(manifest.canonicalBytes);
    const incorrectSetDigest = { ...manifest.manifest, schema: { ...manifest.manifest.schema, writePolicySetSha256: "a".repeat(64) } };
    expect(await Effect.runPromise(Effect.result(verifyApplicationManifestV3(incorrectSetDigest)))).toMatchObject({
      _tag: "Failure", failure: { path: "schema.writePolicySetSha256" },
    });
    expect(JSON.parse(new TextDecoder().decode(Result.getOrThrow(applicationSchemaPublicationFrame(manifest.manifest))))).toMatchObject({
      version: 3, schema: { version: 3, relations: [], writePolicies: policies, writePolicySetSha256: hash(policies) },
    });
    const stripped = { ...manifest.manifest, version: 2 };
    expect(Result.isFailure(canonicalizeApplicationManifest(stripped))).toBe(true);
  });
});

function hash(value: Json): string {
  return createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid fixture"); })).digest("hex");
}

function policyFixture() {
  const provenance = {
    format: "flarex.payload-provenance", version: 1, package: "payload", release: "3.88.0",
    npmIntegrity: "sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==",
    gitTagObject: "c54dea8f4010d9cb194780f2ee1e4b3ec697f9be", gitCommit: "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22",
  } satisfies ApplicationWritePolicies["provenance"];
  const configuration = {
    format: "flarex.payload-configuration", version: 2, profile: "payload.scalar", provenanceSha256: hash(provenance),
    tables: [{ logicalTableName: "posts", fields: [{ name: "title", kind: "text" }] }],
  } satisfies ApplicationWritePolicies["configuration"];
  return {
    format: "flarex.application-table-write-policies", version: 1, provenance, configuration,
    tables: [
      { logicalTableName: "audit", owner: "application" },
      { logicalTableName: "posts", owner: "payload", policyId: "payload.scalar", configSha256: hash(configuration), provenanceSha256: hash(provenance) },
    ],
  } satisfies ApplicationWritePolicies;
}

function schemaTable() {
  return { kind: "table", validator: { isFlarexValidator: true, json: {
    type: "object", value: { title: { fieldType: { type: "string" }, optional: false } },
  } }, indexes: [] };
}
