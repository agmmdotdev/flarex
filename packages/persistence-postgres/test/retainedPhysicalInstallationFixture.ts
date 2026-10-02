import { Effect, Result } from "effect";
import type { Client } from "pg";
import { expect } from "vitest";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { capturePayloadPreferenceProfile } from "../src/payloadPreferences/binding";
import { makeFrameworkSchemaTarget, type FrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { frameworkSchemaTargetSnapshot } from "../src/frameworkSchema/target";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { makeFrameworkSchemaArtifactRepository, prepareFrameworkSchemaArtifactAdmission,
  type FrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeCatalogControlSessionStarter } from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import type { PostgresFrameworkMigrationOptions } from "../src/migrationCoordination/postgresTarget";
import type { FrameworkFreshInstallationRequest, FrameworkInstallerPolicy } from "../src/migrationCoordination/installer";
import { installRetainedPhysicalProfile, type RetainedPhysicalProfileInstallationFailure,
  type InstallationMigrationJournal } from "../src/postgresInstallationMaintenance";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/storedMetadataRestoration";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

export const retainedPhysicalPolicy: FrameworkInstallerPolicy = { leaseDurationMilliseconds: 120_000,
  lockTimeoutMilliseconds: 2_000, statementTimeoutMilliseconds: 10_000,
  runTimeoutMilliseconds: 120_000, maximumStepsPerCall: 128 };
export const quotePhysicalIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
export interface RetainedPhysicalSelection {
  readonly target: FrameworkSchemaTarget;
  readonly profile: Effect.Success<ReturnType<typeof capturePayloadPreferenceProfile>>;
  readonly repository: FrameworkSchemaArtifactRepository;
  readonly request: FrameworkFreshInstallationRequest;
  readonly requiredStepCount: number;
}
/** Reconstruct authentic owners from the exact original namespace; no cached claims. */
export async function makeRetainedPhysicalSelection(persistence: PostgresFlarexPersistence,
  schemaName: string): Promise<RetainedPhysicalSelection> {
  const target = await runEffect(makeFrameworkSchemaTarget({ database: persistence.drizzle,
    deploymentId: "physical-test", canonicalPhysicalDatabaseIdentity: "physical-test/database",
    physicalLocator: { kind: "shared_database", databaseKey: "primary", schemaName } }));
  const profile = await runEffect(capturePayloadPreferenceProfile("physical-test"));
  const snapshot = frameworkSchemaTargetSnapshot(target);
  if (snapshot === undefined) throw new Error("Missing retained physical target snapshot");
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({ artifact: profile.artifact,
    targetNamespace: snapshot.namespace, physicalLocator: snapshot.physicalLocator }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: profile.artifact, physicalLayout }));
  const repository = Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: persistence.drizzle,
    controlSessionStarter: makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
      driver: makePostgresCatalogControlSessionDriver(persistence.pool) }),
    readTimeoutMilliseconds: 10_000, attemptTimeoutMilliseconds: 10_000,
    recoveryTimeoutMilliseconds: 10_000, lockTimeoutMilliseconds: 2_000 }));
  return { target, profile, repository, requiredStepCount: plan.frame.steps.length, request: {
    artifactIdentity: profile.artifact.identity, attemptId: "physical-install", leaseOwnerId: "physical-owner" } };
}
export interface RetainedPhysicalFixture extends RetainedPhysicalSelection {
  readonly owner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>;
  readonly runtime: Awaited<ReturnType<typeof createProtectedFileScopedPostgresFixture>>;
  readonly journal: InstallationMigrationJournal;
  readonly operation: (options?: PostgresFrameworkMigrationOptions, policy?: Partial<FrameworkInstallerPolicy>) =>
    Effect.Effect<RestoredFrameworkSchemaAvailabilityHead, RetainedPhysicalProfileInstallationFailure>;
  readonly install: (options?: PostgresFrameworkMigrationOptions) => Promise<RestoredFrameworkSchemaAvailabilityHead>;
}
export async function withRetainedPhysicalFixture(run: (fixture: RetainedPhysicalFixture) => Promise<void>): Promise<void> {
  const owner = await createFileScopedPostgresFixture();
  const failures: unknown[] = [];
  try {
    const runtime = await createProtectedFileScopedPostgresFixture("fullProof", owner);
    try {
      await runtime.persistence.query("insert into deployments (deployment_id, project_id) values ('physical-test', 'physical-project')");
      const selected = await makeRetainedPhysicalSelection(runtime.persistence, owner.schemaName);
      await runEffect(admitFrameworkSchemaArtifactEffect(selected.repository,
        Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(selected.profile.artifact))));
      const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable };
      const operation: RetainedPhysicalFixture["operation"] = (options, policy) => installRetainedPhysicalProfile({
        config: owner.persistence.pool.options, schemaName: owner.schemaName, database: runtime.persistence.drizzle,
        target: selected.target, artifactRepository: selected.repository, requests: [selected.request, selected.request],
        policy: { ...retainedPhysicalPolicy, ...policy }, journal, runtimeDatabases: [runtime.persistence.drizzle],
        ...(options === undefined ? {} : { options }) });
      await run({ owner, runtime, ...selected, journal, operation, install: options => runEffect(operation(options)) });
    } catch (cause) { failures.push(cause); }
    finally {
      try { await runtime.dispose(); } catch (cause) { failures.push(cause); }
    }
  } catch (cause) { failures.push(cause); }
  finally {
    try { await owner.dispose(); } catch (cause) { failures.push(cause); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Retained physical fixture operation and cleanup failed.");
}
export async function physicalLedger(fixture: RetainedPhysicalFixture) {
  const receipts = await fixture.owner.persistence.query<{ id: string; bytes: string }>(
    "select receipt_storage_id::text as id, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
  const publications = await fixture.owner.persistence.query<{ installation: number; readiness: number; history: number; head: number }>(`select
    (select count(*)::integer from fx_system_framework_schema_installation) as installation,
    (select count(*)::integer from fx_system_framework_schema_readiness) as readiness,
    (select count(*)::integer from fx_system_framework_schema_availability_history) as history,
    (select count(*)::integer from fx_system_framework_schema_availability_head) as head`);
  return { receipts: receipts.rows, publications: publications.rows };
}
/** Committed structural settlement, including the event and collision fencing head. */
export async function physicalSettlementLedger(fixture: RetainedPhysicalFixture) {
  const events = await fixture.owner.persistence.query<{ row: unknown }>(
    "select to_jsonb(e) as row from fx_system_framework_migration_event e order by event_storage_id");
  const heads = await fixture.owner.persistence.query<{ row: unknown }>(
    "select to_jsonb(h) as row from fx_system_framework_migration_collision_head h order by collision_storage_id");
  const relations = await fixture.owner.persistence.query<{ name: string }>(
    "select relname as name from pg_catalog.pg_class where relnamespace=$1::regnamespace and relname like 'fxrt_%' order by relname",
    [fixture.owner.schemaName]);
  return { ...await physicalLedger(fixture), events: events.rows, heads: heads.rows, relations: relations.rows };
}
export async function waitForPhysicalReceiptWaiter(fixture: RetainedPhysicalFixture, pid: number | undefined): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await fixture.owner.persistence.query(`select 1 from pg_catalog.pg_stat_activity
      where pid=$1 and wait_event_type='Lock' and query ilike '%insert into%fx_system_framework_migration_step_receipt%'`, [pid]);
    if (result.rows.length === 1) return;
    await new Promise<void>(resolve => { setTimeout(resolve, 10); });
  }
  throw new Error("Fixed physical installer did not reach its observed receipt lock wait");
}
/** Match the stored maintenance PID and backend_start, not a reusable PID alone. */
export async function assertPhysicalPredecessorClosed(fixture: RetainedPhysicalFixture, predecessor?: Client): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    const result = await fixture.owner.persistence.query(`select 1 from pg_catalog.pg_stat_activity a
      join fx_system_installation i on a.pid=i.maintenance_pid and a.backend_start=i.maintenance_backend_start`);
    if (result.rows.length === 0) {
      if (predecessor !== undefined) await expect(predecessor.query("create table late_physical_predecessor (id integer)")).rejects.toBeDefined();
      return;
    }
    await new Promise<void>(resolve => { setTimeout(resolve, 10); });
  }
  throw new Error("The exact maintenance predecessor backend remained live after settlement");
}
