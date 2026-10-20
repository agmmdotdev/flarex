import { describe, expect, it } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl, useFileScopedPostgresSchedulerPersistence } from "./postgresHelpers";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { registerFileScopedPersistenceTests } from "./fileScopedPersistenceScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresSchedulerPersistence();

describePostgres("file-scoped Postgres test fixture", { concurrent: false }, () => {
  registerFileScopedPersistenceTests(withPostgresPersistence, (previous, current) => {
    expect(current).toBe(previous);
  });

  it("restores the exact scheduler migration rows after mutation and deletion", async () => {
    let baseline: readonly { kind: string; seed: string }[] = [];
    await withPostgresPersistence(async persistence => {
      baseline = (await persistence.query<{ kind: string; seed: string }>(`
        select 'redelivery' as kind, row_to_json(seed)::text as seed from fx_system_point_mutation_redelivery_scheduler seed
        union all select 'history', row_to_json(seed)::text from fx_system_retained_history_scheduler seed
        order by kind
      `)).rows;
      expect(baseline).toHaveLength(2);
      await persistence.query("update fx_system_point_mutation_redelivery_scheduler set run_fence=run_fence+1");
      await persistence.query("delete from fx_system_retained_history_scheduler");
    });
    await withPostgresPersistence(async persistence => {
      expect((await persistence.query<{ kind: string; seed: string }>(`
        select 'redelivery' as kind, row_to_json(seed)::text as seed from fx_system_point_mutation_redelivery_scheduler seed
        union all select 'history', row_to_json(seed)::text from fx_system_retained_history_scheduler seed
        order by kind
      `)).rows).toEqual(baseline);
    });
  }, 30_000);

  it("retains rows while renewing runtime ownership and enforcing pool and disposal guards", async () => {
    const fixture = await createFileScopedPostgresFixture({ retainRows: true });
    try {
      await fixture.persistence.insertDeploymentMetadata({
        deploymentId: "fixture_retained_rows", projectId: "project_fixture_retained_rows",
      });
      const stored = await fixture.persistence.getDeploymentMetadata("fixture_retained_rows");
      expect(stored).not.toBeNull();
      const originalRuntime = preparedHostTestRuntime(fixture.persistence.drizzle);
      await fixture.reset();
      await expect(fixture.persistence.getDeploymentMetadata("fixture_retained_rows")).resolves.toEqual(stored);
      const renewedRuntime = preparedHostTestRuntime(fixture.persistence.drizzle);
      expect(renewedRuntime).not.toBe(originalRuntime);

      const client = await fixture.persistence.pool.connect();
      try {
        await expect(fixture.reset()).rejects.toThrow(
          "File-scoped Postgres test left a checked-out or waiting pool client.",
        );
        expect(preparedHostTestRuntime(fixture.persistence.drizzle)).toBe(renewedRuntime);
      } finally { client.release(); }

      await fixture.reset();
      expect(preparedHostTestRuntime(fixture.persistence.drizzle)).not.toBe(renewedRuntime);
      await expect(fixture.persistence.getDeploymentMetadata("fixture_retained_rows")).resolves.toEqual(stored);
    } finally { await fixture.dispose(); }
    await expect(fixture.reset()).rejects.toThrow("File-scoped Postgres fixture is closed.");
  }, 30_000);
});
