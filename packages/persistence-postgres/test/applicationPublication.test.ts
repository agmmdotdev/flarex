import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import {
  applicationRuntimeTargetFromPublication,
  makeApplicationPublicationRepository,
} from "../src/applicationPublication";
import { createPGlitePersistence } from "../src/pglite";
import { runEffect } from "./effectTestRuntime";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "./sessionAuthorityTestSupport";

const ROOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
const AUTHORITY: ApplicationAnalysisAuthority = Object.freeze({
  scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
});

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application publication generation", () => {
  it("publishes one manifest-derived catalog, replays exactly, and makes one target", async () => {
    const fixture = await publicationFixture();
    const [first, replay] = await Promise.all([
      runEffect(fixture.publications.publish(fixture.input)),
      runEffect(fixture.publications.publish(fixture.input)),
    ]);
    const target = Result.getOrThrow(
      applicationRuntimeTargetFromPublication(first, "users:get"),
    );

    expect(replay).toEqual(first);
    expect(first.functions).toHaveLength(1);
    expect(first.publicationSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.schemaSha256).not.toBe(first.functionCatalogSha256);
    expect(target.target).toMatchObject({
      revisionId: first.revisionId,
      publicationSha256: first.publicationSha256,
      executionModulePath: "_flarex/application.js",
      function: {
        path: "users:get",
        kind: "query",
        visibility: "public",
      },
    });
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_publication_v1",
    )).rows).toEqual([{ count: "1" }]);
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_function_v1",
    )).rows).toEqual([{ count: "1" }]);
  });

  it("rejects replay after persisted function evidence is corrupted", async () => {
    const fixture = await publicationFixture();
    await runEffect(fixture.publications.publish(fixture.input));
    await fixture.persistence.query(
      "update fx_system_application_function_v1 set entry_bytes = $1 where scope_id = $2",
      [new Uint8Array([1]), AUTHORITY.scopeId],
    );
    const replay = await runEffect(Effect.result(
      fixture.publications.publish(fixture.input),
    ));

    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure).toMatchObject({
        reason: "conflictingReplay",
        retryable: false,
      });
    }
  });

  it("rejects both stale callers and fresh callers for a stale candidate", async () => {
    const fixture = await publicationFixture();
    await fixture.persistence.query(
      "update fx_system_scope_clock set storage_generation_fence = 2 where scope_id = $1",
      [AUTHORITY.scopeId],
    );
    const stale = await runEffect(Effect.result(
      fixture.publications.publish(fixture.input),
    ));
    const freshAuthority: ApplicationAnalysisAuthority = Object.freeze({
      ...AUTHORITY,
      storageGenerationFence: StorageGenerationFenceSchema.make(2n),
    });
    const fresh = await runEffect(Effect.result(
      fixture.publications.publish({
        ...fixture.input,
        authority: freshAuthority,
      }),
    ));

    for (const result of [stale, fresh]) {
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("authorityChanged");
      }
    }
  });

  it("rejects a publication whose admitted function cannot fit a runtime target", async () => {
    const fields: Record<string, {
      readonly fieldType: { readonly type: "string" };
      readonly optional: false;
    }> = {};
    for (let index = 0; index < 650; index += 1) {
      fields[`field_${index.toString().padStart(4, "0")}_${"x".repeat(48)}`] = {
        fieldType: { type: "string" },
        optional: false,
      };
    }
    const fixture = await publicationFixture({
      args: { type: "object", value: fields },
    });
    const result = await runEffect(Effect.result(
      fixture.publications.publish(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe("invalidInput");
    expect((await fixture.persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_system_application_publication_v1",
    )).rows).toEqual([{ count: "0" }]);
  });

  it("rejects multibyte function names beyond the runtime text budget", async () => {
    const moduleName = "界".repeat(1_400);
    const fixture = await publicationFixture({
      path: moduleName,
      moduleName,
      exportName: "default",
    });
    const result = await runEffect(Effect.result(
      fixture.publications.publish(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe("invalidInput");
  });

  it("publishes, replays, and targets a valid default export", async () => {
    const fixture = await publicationFixture({
      path: "users",
      moduleName: "users",
      exportName: "default",
    });
    const first = await runEffect(fixture.publications.publish(fixture.input));
    const replay = await runEffect(fixture.publications.publish(fixture.input));
    const target = Result.getOrThrow(
      applicationRuntimeTargetFromPublication(first, "users"),
    );

    expect(replay).toEqual(first);
    expect(target.target.function).toMatchObject({
      path: "users",
      moduleName: "users",
      exportName: "default",
    });
  });
});

interface FunctionOverrides {
  readonly path?: string;
  readonly moduleName?: string;
  readonly exportName?: string;
  readonly args?: unknown;
}

async function publicationFixture(functionOverrides?: FunctionOverrides) {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const identities = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
  ];
  let identityIndex = 0;
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle, {
    randomUuid: () => {
      const identity = identities[identityIndex];
      if (identity === undefined) throw new Error("Identity fixture exhausted.");
      identityIndex += 1;
      return identity;
    },
  });
  const pending = await runEffect(analyses.begin({
    authority: AUTHORITY,
    requestKey: "request:application-publication:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
  }));
  const canonical = canonicalManifest(functionOverrides);
  const analyzed = await runEffect(analyses.settle(AUTHORITY, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
    canonicalManifest: canonical.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed publication fixture.");
  }
  return Object.freeze({
    persistence,
    publications: makeApplicationPublicationRepository(persistence.drizzle),
    input: Object.freeze({
      authority: AUTHORITY,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: canonical.manifest,
    }),
  });
}

function canonicalManifest(functionOverrides?: FunctionOverrides) {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: SOURCE,
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: SCHEMA_SOURCE,
        sourceByteLength: 128,
      }],
    },
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "partitionBy", field: "_id" },
      }],
      indexes: [],
    },
    functions: [{
      path: "users:get",
      moduleName: "users",
      exportName: "get",
      kind: "query",
      visibility: "public",
      args: {
        type: "object",
        value: {
          id: {
            fieldType: { type: "id", tableName: "users" },
            optional: false,
          },
        },
      },
      returns: { type: "null" },
      partition: null,
      ...functionOverrides,
    }],
  }));
}
