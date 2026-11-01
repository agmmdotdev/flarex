import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import { createCoreApplicationDefinition } from "@flarex/system-test/internal/application-core-definition";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY,
  type ApplicationAnalysisHostResult } from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { Effect, Encoding, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { makeExecutorApplicationCredentials, prepareExecutorApplicationDefinition } from "../src/applicationComposition";
import { resolveExecutorApplicationProfile } from "../src/applicationConfiguration";
import { executorApplicationConfigurationFixture, executorApplicationProfileFixture } from "./support/executorApplicationConfiguration";

describe("configured Application composition", () => {
  let definition: Awaited<ReturnType<typeof createCoreApplicationDefinition>>;
  beforeAll(async () => { definition = await createCoreApplicationDefinition(); }, 120_000);

  function configuredProfile() {
    const anchor = definition.manifest.functions.find(fn => fn.kind === "query" && fn.visibility === "public");
    if (anchor === undefined) throw new Error("The actual analyzed fixture has no public query.");
    const input = { ...executorApplicationProfileFixture(), analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
      analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY };
    return Result.getOrThrow(resolveExecutorApplicationProfile({
      FLAREX_APPLICATION_PROFILES: JSON.stringify({ version: 1, profiles: [input] }),
    }, input.deploymentId));
  }

  it("passes actual cold Analysis output through the production schema and program producers", async () => {
    expect(definition.coldAnalysisLoads).toBeGreaterThan(0);
    const profile = configuredProfile();
    let reads = 0;
    let calls = 0;
    const canonical = Result.getOrThrow(canonicalizeApplicationManifest(definition.manifest));
    const prepared = await Effect.runPromise(prepareExecutorApplicationDefinition({ APPLICATION_ANALYZER: {
      analyze: async request => {
        calls++;
        expect(request).toMatchObject({ sourceArtifactRootSha256: definition.source.sourceArtifact.rootSha256,
          analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY, analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY });
        return { format: "flarex.application-analysis-host-result", version: 1, kind: "analyzed",
          sourceArtifactRootSha256: definition.source.sourceArtifact.rootSha256,
          analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY, analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY,
          manifest: definition.manifest, canonicalManifest: canonical.canonicalText } satisfies ApplicationAnalysisHostResult;
      },
    } }, profile, { read: () => Effect.sync(() => { reads++; return definition.source; }) }, definition.source.sourceArtifact.rootSha256));
    expect(reads).toBe(1);
    expect(calls).toBe(1);
    expect(prepared.schema.tables.map(table => table.tableName)).toEqual(definition.manifest.schema.tables.map(table => table.name));
    expect(prepared.programs.some(program => program.identity.functionPath === "users:get")).toBe(true);
  });

  it("refuses Analysis that does not bind the requested immutable source", async () => {
    let reads = 0;
    let calls = 0;
    const canonical = Result.getOrThrow(canonicalizeApplicationManifest(definition.manifest));
    const failure = await Effect.runPromise(prepareExecutorApplicationDefinition({ APPLICATION_ANALYZER: {
      analyze: async request => { calls++; return { format: "flarex.application-analysis-host-result", version: 1, kind: "analyzed",
        sourceArtifactRootSha256: request.sourceArtifactRootSha256, analyzerIdentity: APPLICATION_ANALYSIS_ANALYZER_IDENTITY,
        analyzerPolicyIdentity: APPLICATION_ANALYSIS_POLICY_IDENTITY, manifest: definition.manifest,
        canonicalManifest: canonical.canonicalText } satisfies ApplicationAnalysisHostResult; },
    } }, configuredProfile(), { read: () => Effect.sync(() => { reads++; return definition.source; }) }, "ff".repeat(32)).pipe(Effect.flip));
    expect(failure).toMatchObject({ reason: "sourceMismatch" });
    expect(reads).toBe(1);
    expect(calls).toBe(1);
  });

  it("refuses partition authority in a valid analyzed manifest before it can be flattened", () => {
    const mutation = definition.manifest.functions.find(fn => fn.kind === "mutation" && fn.visibility === "public");
    if (mutation === undefined) throw new Error("The actual analyzed fixture has no public mutation.");
    const partitioned = { ...definition.manifest,
      schema: { ...definition.manifest.schema, tables: definition.manifest.schema.tables.map(table => table.name === "users"
        ? { ...table, placement: { kind: "partitionBy", field: "_id" } } : table) },
      functions: definition.manifest.functions.map(fn => fn.path === mutation.path
        ? { ...fn, partition: { type: "partitionCreateRoot", table: "users", partitionField: "_id" } } : fn),
    };
    expect(Result.isSuccess(canonicalizeApplicationManifest(partitioned))).toBe(true);
    const result = compileCoreApplicationSchema(partitioned);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("Partition authority was erased.");
    expect(result.failure).toMatchObject({ reason: "unsupportedCapability" });
  });

  it("reconstructs cursor keys from stable operator secrets and refuses invalid key material", async () => {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    if (!("privateKey" in pair)) throw new Error("Expected an Ed25519 key pair.");
    const fixture = executorApplicationConfigurationFixture();
    const profile = Result.getOrThrow(resolveExecutorApplicationProfile(fixture, fixture.profile.deploymentId));
    const key = { keyId: profile.keyId,
      privateKeyPkcs8: Encoding.encodeBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
      publicKeySpki: Encoding.encodeBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
      queryCursorSecret: Encoding.encodeBase64(crypto.getRandomValues(new Uint8Array(32))), issuedAtInclusiveEpochMilliseconds: 0 };
    const env = { FLAREX_APPLICATION_KEYS: JSON.stringify({ version: 1, keys: [key] }) };
    const first = await Effect.runPromise(makeExecutorApplicationCredentials(env, profile));
    const second = await Effect.runPromise(makeExecutorApplicationCredentials(env, profile));
    const cursor = { position: { kind: "end" as const }, queryFingerprint: new Uint8Array(32) };
    const encoded = first.queryCursor.broker.encode(cursor);
    expect(second.queryCursor.broker.encode(cursor)).toBe(encoded);
    expect(Result.getOrThrow(second.queryCursor.broker.decode(encoded))).toEqual(cursor);
    const failure = await Effect.runPromise(makeExecutorApplicationCredentials(fixture, profile).pipe(Effect.flip));
    expect(failure).toMatchObject({ reason: "keyUnavailable" });
  });
});
