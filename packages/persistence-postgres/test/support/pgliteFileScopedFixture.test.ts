import { describe, expect, it } from "vitest";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { registerFileScopedPersistenceTests } from "./fileScopedPersistenceScenario";
import { useFileScopedPGliteRuntimePersistence, useFileScopedPGliteCommitSchemaPersistence,
  useFileScopedPGliteRedeliverySchedulerPersistence, useFileScopedPGliteControlScopePersistence } from "./pgliteTestFixture";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { insertPendingWake, insertWakeHeader, insertWakeScope, WAKE_SCOPE_A, WAKE_EPOCH_A } from "../commit/commitWakeOutboxTestSupport";
import { reserveScopeAuthorityProvisioningReceiptInTransaction } from "../../src/scope/scopeAuthorityProvisioningReceipt";

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

describe("file-scoped PGlite storage and commit schema fixture", () => {
  const withPersistence = useFileScopedPGliteCommitSchemaPersistence();

  it("resets scope authority atomically, preserves seeds and rebuilds after an unexpected dependant", async () => {
    const scope = { scopeId: ScopeIdSchema.make("scope_72000000-0000-4000-8000-000000000001"),
      epoch: ScopeEpochSchema.make("epoch_72000000-0000-4000-8000-000000000002") };
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await insertCurrentScopeClockFixture(persistence.drizzle, scope);
      await insertWakeScope(persistence, { scopeUuid: WAKE_SCOPE_A, epochUuid: WAKE_EPOCH_A, lastCommitSeq: 1n });
      await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
      await insertPendingWake(persistence, { scopeUuid: WAKE_SCOPE_A, epochUuid: WAKE_EPOCH_A, commitSeq: 1n });
    });

    await expect(withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await persistence.getScopeClock(scope.scopeId)).toBeNull();
      expect((await persistence.query("select scope_id from fx_system_scope_execution_authority")).rows).toEqual([]);
      expect((await persistence.query(`
        select 'header' as kind, count(*)::int as count from fx_system_commit
        union all select 'wake', count(*)::int from fx_system_commit_wake
        union all select 'row_change', count(*)::int from fx_system_commit_app_row_change
        union all select 'relation_change', count(*)::int from fx_system_commit_relation_adjacency_change
        order by kind
      `)).rows).toEqual([
        { kind: "header", count: 0 }, { kind: "relation_change", count: 0 },
        { kind: "row_change", count: 0 }, { kind: "wake", count: 0 },
      ]);
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

describe("file-scoped PGlite redelivery scheduler fixture", () => {
  const withPersistence = useFileScopedPGliteRedeliverySchedulerPersistence();

  it("restores the exact migration seed after the singleton is deleted", async () => {
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await persistence.query("delete from fx_system_point_mutation_redelivery_scheduler");
    });
    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
    });
  });
});

describe("file-scoped PGlite control scope fixture", () => {
  const withPersistence = useFileScopedPGliteControlScopePersistence();

  it("clears receipt, scope and deployment rows, preserves seeds and refuses unexpected dependants", async () => {
    const deploymentId = "fixture_control_scope";
    const scopeId = ScopeIdSchema.make("scope_fixture_control_scope");
    const physicalLocator = { kind: "schema_per_scope", databaseKey: "fixture", schemaName: "fixture_control" } as const;
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await persistence.insertDeploymentMetadata({ deploymentId, projectId: deploymentId });
      await persistence.insertScopeMetadata({ scopeId, deploymentId, physicalLocator });
      await persistence.drizzle.transaction(tx => reserveScopeAuthorityProvisioningReceiptInTransaction(tx, {
        scopeId, physicalLocator, candidateInitialEpoch: ScopeEpochSchema.make("epoch_fixture_control_scope"),
      }));
    });

    await expect(withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect((await persistence.query(`
        select 'receipt' as kind, count(*)::int as count from fx_control_scope_provisioning
        union all select 'scope', count(*)::int from fx_control_scope
        union all select 'deployment', count(*)::int from deployments
        order by kind
      `)).rows).toEqual([
        { kind: "deployment", count: 0 }, { kind: "receipt", count: 0 }, { kind: "scope", count: 0 },
      ]);
      await persistence.insertDeploymentMetadata({ deploymentId, projectId: deploymentId });
      await persistence.query("delete from fx_system_retained_history_scheduler");
      await persistence.query(`create table fixture_control_scope_reset_ref (
        deployment_id text references deployments (deployment_id))`);
      await persistence.query("insert into fixture_control_scope_reset_ref values ($1)", [deploymentId]);
    })).rejects.toMatchObject({ code: "23503" });

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect((await persistence.query("select to_regclass('fixture_control_scope_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
      expect(await persistence.getDeploymentMetadata(deploymentId)).toBeNull();
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
