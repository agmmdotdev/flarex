import { describe, it } from "vitest";
import { createPGliteLocatedPointMutationSessionActivationTargetV1, createPGliteSharedScopeAuthorityProvisioner } from "../../../src/database/pglite";
import { isLocatedReadCommittedAttemptTargetV1 } from "../../../src/database/locatedTransactionIdentity";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { assertQueryCacheRefresh, prepareQueryCacheRefreshScope, QUERY_CACHE_REFRESH_LOCATOR, createQueryCacheRefreshUuid } from "./queryCacheRefreshScenario";

describe("bounded query-cache refresh on PGlite", () => {
  it("captures exact historical changes under one guard and refuses bounded reuse without hiding corruption", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(persistence, QUERY_CACHE_REFRESH_LOCATOR);
    if (!isLocatedReadCommittedAttemptTargetV1(target)) throw new Error("Expected PGlite read-committed target");
    const located = await prepareQueryCacheRefreshScope(persistence, createPGliteSharedScopeAuthorityProvisioner(persistence,
      { physicalLocator: QUERY_CACHE_REFRESH_LOCATOR, randomUuid: createQueryCacheRefreshUuid() }), target);
    await assertQueryCacheRefresh(persistence, located);
  }, 120_000);
});
