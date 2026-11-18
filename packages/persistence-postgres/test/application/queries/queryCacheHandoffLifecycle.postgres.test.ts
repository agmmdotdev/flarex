import { describe, expect, it } from "vitest";
import { createApplicationNativeMutationPostgresFixture } from "../applicationNativeMutationTestFixture";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import { assertQueryCacheHandoffLifecycle, QUERY_CACHE_HANDOFF_FIXTURE_OPTIONS } from "./queryCacheHandoffLifecycleScenario";

describe.skipIf(postgresUrl === null)("query cache handoff lifecycle on ordinary-role PostgreSQL", () => {
  it("preserves outcomes, overlapping snapshots and cancellation without late-read aliases", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      expect((await target.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname=current_user",
      )).rows[0]?.superuser).toBe(false);
      const fixture = await createApplicationNativeMutationPostgresFixture(QUERY_CACHE_HANDOFF_FIXTURE_OPTIONS, { control, target });
      await assertQueryCacheHandoffLifecycle(fixture);
      for (const persistence of [control, target]) {
        expect(persistence.pool.waitingCount).toBe(0);
        expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
      }
    });
  }, 120_000);
});
