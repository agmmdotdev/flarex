import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { createPGliteSharedScopeAuthorityProvisioner, type PGliteFlarexPersistence } from "../../src/database/pglite";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { registerFileScopedPersistenceTests } from "./fileScopedPersistenceScenario";
import { useFileScopedPGliteRuntimePersistence, useFileScopedPGliteCommitSchemaPersistence,
  useFileScopedPGliteRedeliverySchedulerPersistence, useFileScopedPGliteScopeAuthorityPersistence,
  useFileScopedPGliteTaskRepairSchedulerPersistence, useFileScopedPGliteRetainedHistorySchedulerPersistence,
  useFileScopedPGliteTransactionSessionPersistence } from "./pgliteTestFixture";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { insertPendingWake, insertWakeHeader, insertWakeScope, WAKE_SCOPE_A, WAKE_EPOCH_A } from "../commit/commitWakeOutboxTestSupport";
import { insertCanonicalAvailableOutcome, insertCanonicalExpiredOutcome, insertOutcomeHeader, insertOutcomeScope } from "../commit/committedPointOutcomeTestSupport";
import { insertSessionTestScope, insertSnapshotLeaseFixture, insertTransactionSessionFixture,
  snapshotLeaseFixture, transactionSessionFixture, transactionSessionIdAt, SESSION_TEST_SCOPE_UUID } from "../execution/session/support/sessionStorage";
import { reserveScopeAuthorityProvisioningReceiptInTransaction } from "../../src/scope/scopeAuthorityProvisioningReceipt";
import { createSuccessfulTerminalPlanValues, storeBaseBackedCoordinatorGraphInTransaction,
  useFileScopedFrameworkCoordinatorPersistence, useFileScopedFrameworkCoordinatorGraphPersistence } from "../installation/frameworkSchema/frameworkCoordinatorRepositoryTestSupport";
import { FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES, FRAMEWORK_COORDINATOR_HISTORY_TABLE_NAMES, readFrameworkCoordinatorMetadataGuards as coordinatorGuards,
  readFrameworkCoordinatorMetadataRowCounts } from "../installation/frameworkSchema/frameworkCoordinatorMetadataStorageTestSupport";
import { ensureFrameworkSchemaTargetNamespaceInTransactionEffect, ensureFrameworkMigrationCollisionDomainInTransactionEffect } from "../../src/installation/migrationCoordination/targetCollisionRepository";
import { ensureRelationalPhysicalNameAssignmentsInTransactionEffect } from "../../src/installation/migrationCoordination/physicalNameAssignmentRepository";
import { runEffect } from "./effectTestRuntime";
import { captureFrameworkSchemaArtifact } from "../../src/installation/frameworkSchema/artifact/canonical";
import { admitFrameworkSchemaArtifactEffect } from "../../src/installation/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from "../../src/installation/frameworkSchema/artifact/repository";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture, useFileScopedFrameworkSchemaArtifactAdmissionPersistence } from
  "../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { useFileScopedPGliteTaskPersistence, useFileScopedPGliteTaskDirectoryPersistence } from "../tasks/taskPGliteFixture";
import { seedTaskSystemParentV1, seedTaskSystemRunAttemptStoreV1 } from "../tasks/taskSystemRunAttemptStoreTestSupport";

describe.each([
  {
    name: "Task",
    usePersistence: useFileScopedPGliteTaskPersistence,
    seed: seedTaskSystemRunAttemptStoreV1,
    dependencyTableSql: `create table fixture_task_reset_ref (
        scope_id text, run_id text,
        foreign key (scope_id, run_id) references fx_system_durable_task_run_v1 (scope_id, run_id))`,
    dependencyRowsSql: `insert into fixture_task_reset_ref
        select scope_id, run_id from fx_system_durable_task_run_v1`,
  },
  {
    name: "Task directory",
    usePersistence: useFileScopedPGliteTaskDirectoryPersistence,
    seed: async (persistence: PGliteFlarexPersistence) => {
      const parent = await seedTaskSystemParentV1(persistence);
      await seedTaskSystemRunAttemptStoreV1(persistence, { parent });
    },
    dependencyTableSql: `create table fixture_task_reset_ref (
        scope_id text references fx_control_scope (id))`,
    dependencyRowsSql: `insert into fixture_task_reset_ref
        select id from fx_control_scope`,
  },
])("file-scoped PGlite $name fixture", ({ usePersistence, seed, dependencyTableSql, dependencyRowsSql }) => {
  const withPersistence = usePersistence();

  it("resets Task seeds with constraints enabled and rebuilds after an unexpected dependant", async () => {
    let previous: PGliteFlarexPersistence | undefined;
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    let preResetSeeds: Awaited<ReturnType<typeof seededRows>> = [];
    let populated: Awaited<ReturnType<typeof taskFixtureRows>> = [];
    await withPersistence(async persistence => {
      previous = persistence;
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      expect(await taskFixtureRows(persistence)).toEqual([]);
      await seed(persistence);
    });

    await expect(withPersistence(async persistence => {
      expect(persistence).not.toBe(previous);
      const prior = previous;
      if (prior === undefined) throw new Error("Missing previous Task fixture");
      expect(() => preparedHostTestRuntime(prior.drizzle)).toThrow("no open host runtime");
      expect(preparedHostTestRuntime(persistence.drizzle)).toBeDefined();
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await taskFixtureRows(persistence)).toEqual([]);
      await seed(persistence);
      previous = persistence;
      await persistence.query(dependencyTableSql);
      await persistence.query(dependencyRowsSql);
      await persistence.query("delete from fx_system_retained_history_scheduler");
      populated = await taskFixtureRows(persistence);
      preResetSeeds = await seededRows(persistence);
      expect(preResetSeeds).toHaveLength(4);
    })).rejects.toMatchObject({ code: "23503" });
    if (previous === undefined) throw new Error("Missing failed Task fixture");
    expect(await taskFixtureRows(previous)).toEqual(populated);
    expect(await seededRows(previous)).toEqual(preResetSeeds);

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await taskFixtureRows(persistence)).toEqual([]);
      expect((await persistence.query("select to_regclass('fixture_task_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
      await seed(persistence);
    });
  });
});

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
    const seed = async (persistence: PGliteFlarexPersistence) => {
      await insertCurrentScopeClockFixture(persistence.drizzle, scope);
      await insertWakeScope(persistence, { scopeUuid: WAKE_SCOPE_A, epochUuid: WAKE_EPOCH_A, lastCommitSeq: 1n });
      await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
      await insertPendingWake(persistence, { scopeUuid: WAKE_SCOPE_A, epochUuid: WAKE_EPOCH_A, commitSeq: 1n });
      await insertOutcomeScope(persistence);
      await insertOutcomeHeader(persistence);
      await insertCanonicalAvailableOutcome(persistence, { requestKey: "fixture_available" });
      await insertCanonicalExpiredOutcome(persistence, { requestKey: "fixture_expired" });
    };
    const counts = async (persistence: PGliteFlarexPersistence) => (await persistence.query(`
      select 'header' as kind, count(*)::int as count from fx_system_commit
      union all select 'wake', count(*)::int from fx_system_commit_wake
      union all select 'row_change', count(*)::int from fx_system_commit_app_row_change
      union all select 'relation_change', count(*)::int from fx_system_commit_relation_adjacency_change
      union all select 'outcome', count(*)::int from fx_system_idempotency
      order by kind
    `)).rows;
    const emptyCounts = [
      { kind: "header", count: 0 }, { kind: "outcome", count: 0 },
      { kind: "relation_change", count: 0 }, { kind: "row_change", count: 0 }, { kind: "wake", count: 0 },
    ];
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    let previous: PGliteFlarexPersistence | undefined;
    let populated: Awaited<ReturnType<typeof counts>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await seed(persistence);
      populated = await counts(persistence);
      expect(populated).toEqual([
        { kind: "header", count: 2 }, { kind: "outcome", count: 2 },
        { kind: "relation_change", count: 0 }, { kind: "row_change", count: 0 }, { kind: "wake", count: 1 },
      ]);
    });

    await expect(withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await persistence.getScopeClock(scope.scopeId)).toBeNull();
      expect((await persistence.query("select scope_id from fx_system_scope_execution_authority")).rows).toEqual([]);
      expect(await counts(persistence)).toEqual(emptyCounts);
      await seed(persistence);
      previous = persistence;
      await persistence.query("delete from fx_system_retained_history_scheduler");
      await persistence.query(`create table fixture_storage_reset_ref (
        scope_id text references fx_system_scope_clock (scope_id))`);
      await persistence.query("insert into fixture_storage_reset_ref values ($1)", [scope.scopeId]);
    })).rejects.toMatchObject({ code: "23503" });
    if (previous === undefined) throw new Error("Missing failed commit fixture");
    expect(await counts(previous)).toEqual(populated);
    expect(await previous.getScopeClock(scope.scopeId)).not.toBeNull();

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await persistence.getScopeClock(scope.scopeId)).toBeNull();
      expect(await counts(persistence)).toEqual(emptyCounts);
      expect((await persistence.query("select to_regclass('fixture_storage_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
    });
  });
});

describe("file-scoped PGlite transaction session fixture", { concurrent: false }, () => {
  const withPersistence = useFileScopedPGliteTransactionSessionPersistence();

  it("clears leases before sessions and rolls back all rows when scope reset is refused", async () => {
    const seed = async (persistence: PGliteFlarexPersistence) => {
      await insertSessionTestScope(persistence);
      const sessionId = transactionSessionIdAt(901);
      await insertTransactionSessionFixture(persistence, transactionSessionFixture(sessionId));
      await insertSnapshotLeaseFixture(persistence, snapshotLeaseFixture(sessionId));
    };
    const counts = async (persistence: PGliteFlarexPersistence) => (await persistence.query(`
      select 'authority' as kind, count(*)::int as count from fx_system_scope_execution_authority
      union all select 'clock', count(*)::int from fx_system_scope_clock
      union all select 'lease', count(*)::int from fx_system_snapshot_lease
      union all select 'session', count(*)::int from fx_system_tx_session
      order by kind
    `)).rows;
    const emptyCounts = ["authority", "clock", "lease", "session"].map(kind => ({ kind, count: 0 }));
    const populatedCounts = emptyCounts.map(row => ({ ...row, count: 1 }));
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    let previous: PGliteFlarexPersistence | undefined;
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await seed(persistence);
      expect(await counts(persistence)).toEqual(populatedCounts);
    });

    await expect(withPersistence(async persistence => {
      expect(await counts(persistence)).toEqual(emptyCounts);
      expect(await seededRows(persistence)).toEqual(baseline);
      await seed(persistence);
      previous = persistence;
      await persistence.query("delete from fx_system_retained_history_scheduler");
      await persistence.query(`create table fixture_session_reset_ref (
        scope_id text references fx_system_scope_clock (scope_id))`);
      await persistence.query("insert into fixture_session_reset_ref values ($1)", [`scope_${SESSION_TEST_SCOPE_UUID}`]);
    })).rejects.toMatchObject({ code: "23503" });
    if (previous === undefined) throw new Error("Missing failed session fixture");
    expect(await counts(previous)).toEqual(populatedCounts);

    await withPersistence(async persistence => {
      expect(await counts(persistence)).toEqual(emptyCounts);
      expect(await seededRows(persistence)).toEqual(baseline);
      expect((await persistence.query("select to_regclass('fixture_session_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
    });
  });
});

describe.each([
  { profile: "redelivery", tableName: "fx_system_point_mutation_redelivery_scheduler", usePersistence: useFileScopedPGliteRedeliverySchedulerPersistence },
  { profile: "Task repair", tableName: "fx_system_durable_task_repair_scheduler_v1", usePersistence: useFileScopedPGliteTaskRepairSchedulerPersistence },
  { profile: "retained history", tableName: "fx_system_retained_history_scheduler", usePersistence: useFileScopedPGliteRetainedHistorySchedulerPersistence },
])("file-scoped PGlite $profile scheduler fixture", { concurrent: false }, ({ tableName, usePersistence }) => {
  const withPersistence = usePersistence();

  it("restores the exact migration seed after the singleton is deleted", async () => {
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await persistence.query(`delete from ${tableName}`);
    });
    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
    });
  });
});

describe("file-scoped PGlite scope authority fixture", () => {
  const withPersistence = useFileScopedPGliteScopeAuthorityPersistence();

  it("clears authority and control rows, preserves seeds and refuses unexpected dependants", async () => {
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
      await createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: { kind: "shared_database", databaseKey: "fixture", schemaName: "public" },
      }).ensure({ deploymentId: "fixture_shared_scope", projectId: "fixture_shared_scope" });
    });

    await expect(withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect((await persistence.query(`
        select 'receipt' as kind, count(*)::int as count from fx_control_scope_provisioning
        union all select 'scope', count(*)::int from fx_control_scope
        union all select 'deployment', count(*)::int from deployments
        union all select 'authority', count(*)::int from fx_system_scope_execution_authority
        union all select 'clock', count(*)::int from fx_system_scope_clock
        order by kind
      `)).rows).toEqual([
        { kind: "authority", count: 0 }, { kind: "clock", count: 0 },
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

describe("file-scoped PGlite framework artifact admission fixture", { concurrent: false }, () => {
  const withPersistence = useFileScopedFrameworkSchemaArtifactAdmissionPersistence();

  it("clears artifact edges atomically, preserves seeds and rebuilds after an unexpected dependant", async () => {
    const deploymentId = "fixture_artifact_admission";
    const dependency = await runEffect(captureFrameworkSchemaArtifact({
      deploymentId, owner: "system", lineageId: "fixture-dependency",
      payloadCodec: { format: "json", version: 1 }, provenance: { source: "fixture-reset" },
      capabilities: [], dependencies: [], payload: {},
    }));
    const parent = await runEffect(captureFrameworkSchemaArtifact({
      deploymentId, owner: "system", lineageId: "fixture-parent",
      payloadCodec: { format: "json", version: 1 }, provenance: { source: "fixture-reset" },
      capabilities: [], dependencies: [dependency.identity], payload: {},
    }));
    const seed = async (persistence: PGliteFlarexPersistence) => {
      await persistence.insertDeploymentMetadata({ deploymentId, projectId: deploymentId });
      const { repository } = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
      for (const artifact of [dependency, parent]) {
        await runEffect(admitFrameworkSchemaArtifactEffect(repository,
          Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact))));
      }
    };
    const counts = async (persistence: PGliteFlarexPersistence) => (await persistence.query(`
      select 'artifact' as kind, count(*)::int as count from fx_control_framework_schema_artifact
      union all select 'dependency', count(*)::int from fx_control_framework_schema_artifact_dependency
      union all select 'deployment', count(*)::int from deployments
      order by kind
    `)).rows;
    let previous: PGliteFlarexPersistence | undefined;
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    await withPersistence(async persistence => {
      previous = persistence;
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      await seed(persistence);
      expect(await counts(persistence)).toEqual([
        { kind: "artifact", count: 2 }, { kind: "dependency", count: 1 }, { kind: "deployment", count: 1 },
      ]);
    });

    await expect(withPersistence(async persistence => {
      expect(persistence).not.toBe(previous);
      const prior = previous;
      if (prior === undefined) throw new Error("Missing previous artifact fixture");
      expect(() => preparedHostTestRuntime(prior.drizzle)).toThrow("no open host runtime");
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await counts(persistence)).toEqual([
        { kind: "artifact", count: 0 }, { kind: "dependency", count: 0 }, { kind: "deployment", count: 0 },
      ]);
      await seed(persistence);
      previous = persistence;
      await persistence.insertScopeMetadata({
        scopeId: ScopeIdSchema.make("scope_fixture_artifact_admission"), deploymentId,
        physicalLocator: { kind: "schema_per_scope", databaseKey: "fixture", schemaName: "fixture_artifact" },
      });
    })).rejects.toMatchObject({ cause: {
      code: "23001", constraint: "fx_control_scope_deployment_id_deployments_deployment_id_fk",
    } });
    if (previous === undefined) throw new Error("Missing failed artifact fixture");
    expect(await counts(previous)).toEqual([
      { kind: "artifact", count: 2 }, { kind: "dependency", count: 1 }, { kind: "deployment", count: 1 },
    ]);

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await counts(persistence)).toEqual([
        { kind: "artifact", count: 0 }, { kind: "dependency", count: 0 }, { kind: "deployment", count: 0 },
      ]);
      expect((await persistence.query("select id from fx_control_scope")).rows).toEqual([]);
    });
  }, 30_000);
});

describe.each(["roots", "graph"] as const)("file-scoped PGlite framework coordinator %s fixture", profile => {
  const withPersistence = profile === "roots"
    ? useFileScopedFrameworkCoordinatorPersistence()
    : useFileScopedFrameworkCoordinatorGraphPersistence();

  it("clears the guarded graph, preserves seeds and rebuilds after restrictive reset failure", async () => {
    const values = await createSuccessfulTerminalPlanValues();
    let baseline: Awaited<ReturnType<typeof seededRows>> = [];
    let guards: Awaited<ReturnType<typeof coordinatorGuards>> = [];
    let previous: PGliteFlarexPersistence | undefined;
    await withPersistence(async persistence => {
      previous = persistence;
      baseline = await seededRows(persistence);
      expect(baseline).toHaveLength(5);
      guards = await coordinatorGuards(persistence);
      expect([...new Set(guards.map(guard => guard.table_name))].sort()).toEqual(FRAMEWORK_COORDINATOR_HISTORY_TABLE_NAMES);
      expect(guards.every(guard => guard.enabled === "O")).toBe(true);
      await persistence.drizzle.transaction(async transaction => {
        if (profile === "graph") {
          await storeBaseBackedCoordinatorGraphInTransaction(transaction, values);
        } else {
          const target = await runEffect(ensureFrameworkSchemaTargetNamespaceInTransactionEffect(transaction, values.targetValue));
          const collision = await runEffect(ensureFrameworkMigrationCollisionDomainInTransactionEffect(transaction, target, values.planValue));
          await runEffect(ensureRelationalPhysicalNameAssignmentsInTransactionEffect(transaction, collision, values.physicalLayout.nameAssignments));
        }
      });
      if (profile === "graph") {
        expect((await persistence.query("select count(*)::int as count from fx_system_framework_migration_plan_base")).rows)
          .toEqual([{ count: 1 }]);
      }
    });

    await expect(withPersistence(async persistence => {
      expect(persistence).not.toBe(previous);
      const prior = previous;
      if (prior === undefined) throw new Error("Missing previous coordinator fixture");
      expect(() => preparedHostTestRuntime(prior.drizzle)).toThrow("no open host runtime");
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await coordinatorGuards(persistence)).toEqual(guards);
      expect(await readFrameworkCoordinatorMetadataRowCounts(persistence)).toEqual(
        FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES.map(table_name => ({ table_name, count: 0 })),
      );
      previous = persistence;
      await persistence.drizzle.transaction(transaction => runEffect(
        ensureFrameworkSchemaTargetNamespaceInTransactionEffect(transaction, values.targetValue),
      ));
      await persistence.query(`create table fixture_coordinator_reset_ref (
        target_storage_id bigint references fx_system_framework_schema_target_namespace (target_namespace_storage_id))`);
      await persistence.query(`insert into fixture_coordinator_reset_ref
        select target_namespace_storage_id from fx_system_framework_schema_target_namespace`);
      await persistence.query("delete from fx_system_retained_history_scheduler");
    })).rejects.toMatchObject({ errors: [
      { cause: { code: "23503" } }, { cause: { code: "25P02" } },
    ] });
    if (previous === undefined) throw new Error("Missing failed coordinator fixture");
    expect(await coordinatorGuards(previous)).toEqual(guards);

    await withPersistence(async persistence => {
      expect(await seededRows(persistence)).toEqual(baseline);
      expect(await coordinatorGuards(persistence)).toEqual(guards);
      expect((await persistence.query("select to_regclass('fixture_coordinator_reset_ref') as relation")).rows)
        .toEqual([{ relation: null }]);
    });
  });
});

async function taskFixtureRows(persistence: PGliteFlarexPersistence) {
  return (await persistence.query<{ kind: string; value: unknown }>(`
    select 'definition' as kind, to_jsonb(seed) as value from fx_system_durable_task_definition_revision_v1 seed
    union all select 'run', to_jsonb(seed) from fx_system_durable_task_run_v1 seed
    union all select 'attempt', to_jsonb(seed) from fx_system_durable_task_attempt_identity_v1 seed
    union all select 'effect', to_jsonb(seed) from fx_system_durable_task_requested_effect_v1 seed
    union all select 'pending', to_jsonb(seed) from fx_system_durable_task_compute_pending_v1 seed
    union all select 'authority', to_jsonb(seed) from fx_system_scope_execution_authority seed
    union all select 'clock', to_jsonb(seed) from fx_system_scope_clock seed
    union all select 'provisioning', to_jsonb(seed) from fx_control_scope_provisioning seed
    union all select 'scope', to_jsonb(seed) from fx_control_scope seed
    union all select 'deployment', to_jsonb(seed) from deployments seed
    order by kind, value
  `)).rows;
}

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
