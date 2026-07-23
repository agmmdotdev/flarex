import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  makeDeclarativeV2InertRepositoryV1,
} from "../src/declarativeV2InertRepository";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
} from "../src/postgres";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;

describePostgres("real Postgres Declarative V2 inert foundation", () => {
  it("migrates inert constraints and converges concurrent identical inserts", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const constraints = await persistence.query<{
        check_count: string;
        foreign_key_count: string;
      }>(`
        select
          count(*) filter (where contype = 'c')::text as check_count,
          count(*) filter (where contype = 'f')::text as foreign_key_count
        from pg_constraint
        where conname like 'fx_dv2_%'
      `);
      expect(constraints.rows).toEqual([{
        check_count: "43",
        foreign_key_count: "20",
      }]);
      await insertSessionTestScope(persistence);
      const target =
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          {
            kind: "shared_database",
            databaseKey: "primary",
            schemaName: "public",
          },
        );
      if (!isLocatedReadCommittedAttemptTargetV1(target)) {
        throw new Error("Expected a located READ COMMITTED target.");
      }
      const repository = makeDeclarativeV2InertRepositoryV1(target);
      const candidate = candidateFixture();
      const encoded = Result.getOrThrow(
        encodeDeclarativeV2PhysicalFrameV1(candidate, {
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
        }),
      );
      const bytes = encoded.canonicalBytes.byteLength;
      const budget = {
        maximumCalls: 3,
        maximumFrameBytes: bytes * 2,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: bytes,
      } as const;
      const [left, right] = await Promise.all([
        runEffect(repository.insertCandidate(candidate, budget)),
        runEffect(repository.insertCandidate(candidate, budget)),
      ]);
      expect([left.kind, right.kind].sort()).toEqual([
        "inserted",
        "replayed",
      ]);
      const stored = await runEffect(repository.readCandidate(
        scopeId,
        left.candidateSha256,
        {
          maximumCalls: 2,
          maximumFrameBytes: bytes * 2,
          maximumCanonicalBytes: encoded.usage.canonicalBytes,
          maximumHashBytes: bytes,
        },
      ));
      expect(stored.kind).toBe("present");
      const counts = await persistence.query<{
        candidates: string;
        heads: string;
        legacy_packages: string;
      }>(`
        select
          (select count(*) from fx_system_declarative_v2_candidate)::text
            as candidates,
          (select count(*) from fx_system_declarative_v2_activation_head)::text
            as heads,
          (select count(*) from deployment_packages)::text as legacy_packages
      `);
      expect(counts.rows).toEqual([{
        candidates: "1",
        heads: "0",
        legacy_packages: "0",
      }]);
    });
  }, 60_000);
});

function candidateFixture(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
    scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: `epoch_${SESSION_TEST_EPOCH_UUID}`,
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    readinessPolicyIdentity: "readiness-v1",
  };
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}
