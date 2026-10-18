import { describe, expect, it } from "vitest";
import { postgresUrl, useFileScopedPostgresSchedulerPersistence } from "./postgresHelpers";
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
});
