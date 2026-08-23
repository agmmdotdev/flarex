import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "./sessionAuthorityTestSupport";
import { relationManifestV2Text } from
  "./applicationAnalysisRegistrationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgres = useFileScopedPostgresPersistence();
const AUTHORITY: ApplicationAnalysisAuthority = Object.freeze({
  scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
  epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
});

describePostgres("Application Analysis admission - PostgreSQL", () => {
  it("serializes concurrent exact admission on one candidate and analysis", async () => {
    await withPostgres(async persistence => {
      await insertSessionTestScope(persistence);
      const firstRepository = makeApplicationAnalysisRepository(
        persistence.drizzle,
      );
      const secondRepository = makeApplicationAnalysisRepository(
        persistence.drizzle,
      );
      const input = Object.freeze({
        authority: AUTHORITY,
        requestKey: "request:application-analysis:postgres-concurrent",
        sourceArtifactRootSha256: "a".repeat(64),
        analyzerIdentity: "analyzer-postgres-concurrent",
        analyzerPolicyIdentity: "policy-postgres-concurrent",
      });

      const [first, second] = await Promise.all([
        runEffect(firstRepository.begin(input)),
        runEffect(secondRepository.begin(input)),
      ]);

      expect(first).toEqual(second);
      expect(first.status).toBe("pending");
      const rows = await persistence.query<{
        candidate_count: string;
        analysis_count: string;
      }>(`
        select
          (select count(*)::text from fx_system_application_candidate_v1)
            as candidate_count,
          (select count(*)::text from fx_system_application_analysis_v1)
            as analysis_count
      `);
      expect(rows.rows).toEqual([{
        candidate_count: "1",
        analysis_count: "1",
      }]);
    });
  }, 60_000);

  it("settles and replays a relation-bearing manifest exactly", async () => {
    await withPostgres(async persistence => {
      await insertSessionTestScope(persistence);
      const repository = makeApplicationAnalysisRepository(persistence.drizzle);
      const rootSha256 = "d".repeat(64);
      const pending = await runEffect(repository.begin(Object.freeze({
        authority: AUTHORITY,
        requestKey: "request:application-analysis:postgres-relations",
        sourceArtifactRootSha256: rootSha256,
        analyzerIdentity: "analyzer-postgres-relations",
        analyzerPolicyIdentity: "policy-postgres-relations",
      })));
      const terminal = Object.freeze({
        kind: "analyzed" as const,
        candidateId: pending.candidateId,
        sourceArtifactRootSha256: rootSha256,
        analyzerIdentity: "analyzer-postgres-relations",
        analyzerPolicyIdentity: "policy-postgres-relations",
        canonicalManifest: relationManifestV2Text(rootSha256),
      });

      const analyzed = await runEffect(repository.settle(AUTHORITY, terminal));
      const replay = await runEffect(repository.settle(AUTHORITY, terminal));
      const inspected = await runEffect(
        repository.inspect(AUTHORITY, pending.candidateId),
      );

      expect(analyzed).toMatchObject({
        status: "analyzed",
        manifest: {
          version: 2,
          schema: { version: 2, relations: [{ relationOrdinal: 1 }] },
        },
      });
      expect(replay).toEqual(analyzed);
      expect(inspected).toEqual(analyzed);
    });
  }, 60_000);
});
