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
});
