import { describe, it } from "vitest";
import { createPostgresLocatedPointMutationSessionActivationTargetV1, createPostgresSharedScopeAuthorityProvisioner } from "../../../src/database/postgres";
import { isLocatedReadCommittedAttemptTargetV1 } from "../../../src/database/locatedTransactionIdentity";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { assertQueryCacheRefresh, prepareQueryCacheRefreshScope, QUERY_CACHE_REFRESH_LOCATOR, createQueryCacheRefreshUuid } from "./queryCacheRefreshScenario";

describe.skipIf(postgresUrl === null)("bounded query-cache refresh on ordinary-role PostgreSQL", () => {
  it("captures exact historical changes under one guard and refuses bounded reuse without hiding corruption", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try {
      const persistence = fixture.persistence;
      const target = createPostgresLocatedPointMutationSessionActivationTargetV1(persistence, QUERY_CACHE_REFRESH_LOCATOR);
      if (!isLocatedReadCommittedAttemptTargetV1(target)) throw new Error("Expected PostgreSQL read-committed target");
      const located = await prepareQueryCacheRefreshScope(persistence, createPostgresSharedScopeAuthorityProvisioner(persistence,
        { physicalLocator: QUERY_CACHE_REFRESH_LOCATOR, randomUuid: createQueryCacheRefreshUuid() }), target);
      await assertQueryCacheRefresh(persistence, located);
    } finally { await fixture.dispose(); }
  }, 120_000);
});
