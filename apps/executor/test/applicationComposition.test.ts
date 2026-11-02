import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import type { CoreApplicationCandidate } from "@flarex/persistence-postgres/internal/core";
import { createCoreApplicationDefinition } from "@flarex/system-test/internal/application-core-definition";
import { APPLICATION_ANALYSIS_ANALYZER_IDENTITY, APPLICATION_ANALYSIS_POLICY_IDENTITY,
  type ApplicationAnalysisHostResult } from "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { Effect, Encoding, Option, Result } from "effect";
import { captureDocumentObject } from "flarex-protocol/document-value";
import type { PushSourcePackage } from "flarex-protocol/deployment";
import { beforeAll, describe, expect, it } from "vitest";
import { assertExecutorApplicationProfile, finishExecutorApplicationPush,
  makeExecutorApplicationCredentials, prepareExecutorApplicationDefinition } from "../src/applicationComposition";
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

  function completedCandidate(): CoreApplicationCandidate {
    const profile = configuredProfile();
    const sourcePackage: PushSourcePackage = { modules: definition.source.modules.map(module => ({ path: module.path,
      environment: "isolate", sha256: module.sourceSha256 })),
      functions: ["functions/users.js"], execution: definition.source.sourceArtifact.executionModulePath };
    return { id: "completed-attempt", schemaProposal: { namespace: null, id: "shared-schema" },
      state: "active", indexesReady: true, abandoned: false, activatedAt: 2000, creationTime: 1000, updatedAt: 2000,
      registration: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid,
        candidateId: "completed-attempt", sourceArtifactRootSha256: definition.source.sourceArtifact.rootSha256,
        sourcePackageHash: "aa".repeat(32), analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity,
        compatibilityDate: profile.compatibilityDate, generation: profile.generation, programs: [] },
      metadata: Result.getOrThrow(captureDocumentObject({ format: "flarex.application-candidate-evidence", version: 1,
        canonicalManifest: Result.getOrThrow(canonicalizeApplicationManifest(definition.manifest)).canonicalText, sourcePackage })),
    };
  }

  it("discovers the active deployment attempt independently of pending schema state", async () => {
    const candidate = completedCandidate();
    const profile = await Effect.runPromise(assertExecutorApplicationProfile({
      readActiveApplicationCandidate: () => Effect.succeed(Option.some(candidate)),
    }, configuredProfile()));
    expect(profile.sourceArtifactRootSha256).toBe(candidate.registration.sourceArtifactRootSha256);
    const unready = await Effect.runPromise(assertExecutorApplicationProfile({
      readActiveApplicationCandidate: () => Effect.succeed(Option.none()),
    }, configuredProfile()).pipe(Effect.flip));
    expect(unready).toMatchObject({ reason: "profileNotReady" });
    const mismatched = await Effect.runPromise(assertExecutorApplicationProfile({
      readActiveApplicationCandidate: () => Effect.succeed(Option.some({ ...candidate,
        registration: { ...candidate.registration, generation: candidate.registration.generation + 1 } })),
    }, configuredProfile()).pipe(Effect.flip));
    expect(mismatched).toMatchObject({ reason: "profileNotReady" });
  });

  it("returns a completed finish by attempt ID without touching its old shared schema or republishing programs", async () => {
    const candidate = completedCandidate();
    const finished = await Effect.runPromise(finishExecutorApplicationPush({
      readApplicationCandidate: id => {
        expect(id).toBe(candidate.id);
        return Effect.succeed(Option.some(candidate));
      },
      schemaStatus: () => Effect.die("Completed finish read an obsolete shared schema."),
      advanceSchema: () => Effect.die("Completed finish advanced an obsolete shared schema."),
      activateApplicationCandidate: () => Effect.die("Completed finish republished its old source."),
    }, configuredProfile(), candidate.id));
    expect(finished).toMatchObject({ pushId: candidate.id, state: "active", createdAt: 1000, updatedAt: 2000 });
    expect(finished.pushId).not.toBe(candidate.schemaProposal.id);
  });

  it("lets Core recover a parallel completed finish after a newer source supersedes its schema", async () => {
    const candidate = completedCandidate();
    const { activatedAt, ...prepared } = candidate;
    expect(activatedAt).toBe(2000);
    const finished = await Effect.runPromise(finishExecutorApplicationPush({
      readApplicationCandidate: () => Effect.succeed(Option.some({ ...prepared, state: "validated" })),
      schemaStatus: proposal => {
        expect(proposal).toEqual(candidate.schemaProposal);
        return Effect.succeed({ proposal, state: "overwritten", indexesReady: false });
      },
      advanceSchema: () => Effect.die("An overwritten schema cannot be advanced."),
      activateApplicationCandidate: (id, publication) => {
        expect(id).toBe(candidate.id);
        expect(publication.programs.some(program => program.identity.functionPath === "users:get")).toBe(true);
        return Effect.succeed(candidate);
      },
    }, configuredProfile(), candidate.id));
    expect(finished).toMatchObject({ pushId: candidate.id, state: "active", updatedAt: 2000 });
  });

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
