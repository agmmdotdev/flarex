import { describe, expect, it } from "vitest";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { registerFileScopedPersistenceTests } from "./fileScopedPersistenceScenario";
import { useFileScopedPGliteRuntimePersistence, useFileScopedPGliteStoragePersistence } from "./pgliteTestFixture";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";

describe("file-scoped PGlite runtime fixture", () => {
  const withPersistence = useFileScopedPGliteRuntimePersistence();
  registerFileScopedPersistenceTests(withPersistence, (previous, current) => {
    expect(current).not.toBe(previous);
    expect(() => preparedHostTestRuntime(previous.drizzle)).toThrow("no open host runtime");
    expect(preparedHostTestRuntime(current.drizzle)).toBeDefined();
  });

  it("preserves system seeds on reuse and rebuilds when reset refuses unexpected data", async () => {
    let previous: PGliteFlarexPersistence | undefined;
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      previous = persistence;
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
    });

    await expect(withPersistence(async persistence => {
      expect(persistence).not.toBe(previous);
      expect(await seededRows(persistence)).toEqual(baseline);
      await persistence.query("delete from fx_system_retained_history_scheduler");
      await persistence.insertDeploymentMetadata({ deploymentId: "fixture_reset", projectId: "fixture_reset" });
      // Deliberately violate this row-only fixture's contract: reset must fail,
      // rather than weaken constraints or cascade into another table family.
      await persistence.query(`create table fixture_runtime_reset_ref (
        deployment_id text references deployments (deployment_id))`);
      await persistence.query("insert into fixture_runtime_reset_ref values ('fixture_reset')");
    })).rejects.toMatchObject({ code: "23503" });

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect((await persistence.query("select to_regclass('fixture_runtime_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
      expect(await persistence.getDeploymentMetadata("fixture_reset")).toBeNull();
    });
  });
});

describe("file-scoped PGlite storage fixture", () => {
  const withPersistence = useFileScopedPGliteStoragePersistence();

  it("resets scope authority atomically, preserves seeds and rebuilds after an unexpected dependant", async () => {
    const scope = { scopeId: ScopeIdSchema.make("scope_72000000-0000-4000-8000-000000000001"),
      epoch: ScopeEpochSchema.make("epoch_72000000-0000-4000-8000-000000000002") };
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await insertCurrentScopeClockFixture(persistence.drizzle, scope);
    });

    await expect(withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await persistence.getScopeClock(scope.scopeId)).toBeNull();
      expect((await persistence.query("select scope_id from fx_system_scope_execution_authority")).rows).toEqual([]);
      await insertCurrentScopeClockFixture(persistence.drizzle, scope);
      await persistence.query("delete from fx_system_retained_history_scheduler");
      await persistence.query(`create table fixture_storage_reset_ref (
        scope_id text references fx_system_scope_clock (scope_id))`);
      await persistence.query("insert into fixture_storage_reset_ref values ($1)", [scope.scopeId]);
    })).rejects.toMatchObject({ code: "23503" });

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await persistence.getScopeClock(scope.scopeId)).toBeNull();
      expect((await persistence.query("select to_regclass('fixture_storage_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
    });
  });
});

async function seededRows(persistence: PGliteFlarexPersistence) {
  return (await persistence.query<{ kind: string; value: unknown }>(`
    select 'redelivery' as kind, to_jsonb(seed) as value from fx_system_point_mutation_redelivery_scheduler seed
    union all select 'repair', to_jsonb(seed) from fx_system_durable_task_repair_scheduler_v1 seed
    union all select 'history', to_jsonb(seed) from fx_system_retained_history_scheduler seed
    union all select 'epoch', to_jsonb(seed) from fx_system_prepared_metadata_epoch seed
    union all select 'installation', to_jsonb(seed) from fx_system_installation seed
    order by kind
  `)).rows;
}
