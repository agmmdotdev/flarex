import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectApplicationActivationMigrationFailure,
  invalidApplicationActivationWitnessStatements,
  legacyApplicationActivationCutoverSeedStatements,
  LEGACY_ACTIVATION_CUTOVER_ACTIVATION_BYTES,
  LEGACY_ACTIVATION_CUTOVER_ACTIVATION_SHA256,
  LEGACY_ACTIVATION_CUTOVER_HEAD_BYTES,
  LEGACY_ACTIVATION_CUTOVER_HEAD_SHA256,
  LEGACY_ACTIVATION_CUTOVER_READINESS_SHA256,
  LEGACY_ACTIVATION_CUTOVER_REVISION_ID,
  makeApplicationActivationCutoverMigrationFixture,
  makeApplicationActivationMigrationFixture,
  restoreApplicationActivationMigration,
  writeApplicationActivationJournalThrough,
} from "./applicationActivationMigrationSupport";

describe("Application activation migration - PGlite", () => {
  it("upgrades atomically, preserves prior data, rolls back failure, and replays", async () => {
    const fixture = await makeApplicationActivationMigrationFixture("pglite");
    try {
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        58,
      );
      const persistence = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_application_activation",
        projectId: "project_before_application_activation",
      });
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 59,
        tables: 0,
      });
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        59,
      );
      await injectApplicationActivationMigrationFailure(fixture.migrationPath);
      await expect(persistence.migrate()).rejects.toThrow();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 59,
        tables: 0,
      });
      await restoreApplicationActivationMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await inventory(persistence)).toEqual({
        deployments: 1,
        receipts: 60,
        tables: 2,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);

  it("installs both foreign keys in a non-public active schema", async () => {
    const fixture = await makeApplicationActivationMigrationFixture("schema");
    const db = new PGlite();
    try {
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        59,
      );
      await db.exec("create schema fx_application_activation; set search_path to fx_application_activation");
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      const result = await persistence.query<{ count: number }>(`
        select count(*)::int as count
          from information_schema.table_constraints
         where constraint_schema = current_schema()
           and constraint_name = any(array[
             'fx_application_activation_v1_readiness_fk',
             'fx_application_active_head_v1_activation_fk'
           ])
      `);
      expect(result.rows[0]?.count).toBe(2);
    } finally {
      try { await db.close(); } finally { await fixture.cleanup(); }
    }
  }, 180_000);

  it("preserves populated Legacy evidence while cutting over the one activation owner", async () => {
    const fixture = await makeApplicationActivationCutoverMigrationFixture(
      "populated-pglite",
    );
    try {
      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        74,
      );
      const persistence = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      for (const statement of legacyApplicationActivationCutoverSeedStatements()) {
        await persistence.query(statement);
      }
      expect(await cutoverEvidence(persistence, "legacy")).toEqual(
        expectedLegacyCutoverEvidence,
      );

      await writeApplicationActivationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        75,
      );
      await injectApplicationActivationMigrationFailure(fixture.migrationPath);
      await expect(persistence.migrate()).rejects.toThrow();
      expect(await cutoverEvidence(persistence, "legacy")).toEqual(
        expectedLegacyCutoverEvidence,
      );
      expect(await cutoverInventory(persistence)).toEqual({
        receipts: 75,
        currentTables: 0,
        legacyTables: 2,
        currentForeignKeys: 0,
      });
      await restoreApplicationActivationMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await cutoverEvidence(persistence, "current")).toEqual({
        ...expectedLegacyCutoverEvidence,
        readinessContractVersion: 1,
        legacyReadinessSha256: LEGACY_ACTIVATION_CUTOVER_READINESS_SHA256,
        relationWitnessesAbsent: true,
      });
      expect(await cutoverInventory(persistence)).toEqual({
        receipts: 76,
        currentTables: 2,
        legacyTables: 0,
        currentForeignKeys: 4,
      });
      for (const statement of invalidApplicationActivationWitnessStatements()) {
        await expect(persistence.query(statement)).rejects.toThrow();
      }
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);

  it("fresh-installs the current activation owner in a non-public schema", async () => {
    const fixture = await makeApplicationActivationCutoverMigrationFixture(
      "fresh-schema-pglite",
    );
    const db = new PGlite();
    try {
      await db.exec(
        "create schema fx_application_activation_cutover; set search_path to fx_application_activation_cutover",
      );
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      expect(await cutoverInventory(persistence)).toEqual({
        receipts: 76,
        currentTables: 2,
        legacyTables: 0,
        currentForeignKeys: 4,
      });
    } finally {
      try { await db.close(); } finally { await fixture.cleanup(); }
    }
  }, 180_000);
});

const expectedLegacyCutoverEvidence = Object.freeze({
  revisionId: LEGACY_ACTIVATION_CUTOVER_REVISION_ID,
  readinessSha256: LEGACY_ACTIVATION_CUTOVER_READINESS_SHA256,
  activationSha256: LEGACY_ACTIVATION_CUTOVER_ACTIVATION_SHA256,
  activationBytes: LEGACY_ACTIVATION_CUTOVER_ACTIVATION_BYTES,
  headSha256: LEGACY_ACTIVATION_CUTOVER_HEAD_SHA256,
  headBytes: LEGACY_ACTIVATION_CUTOVER_HEAD_BYTES,
});

async function cutoverEvidence(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  tableKind: "legacy" | "current",
) {
  const activationTable = tableKind === "legacy"
    ? "fx_system_application_activation_v1"
    : "fx_system_application_activation";
  const headTable = tableKind === "legacy"
    ? "fx_system_application_active_head_v1"
    : "fx_system_application_active_head";
  const currentProjection = tableKind === "current"
    ? `,
       a.readiness_contract_version as "readinessContractVersion",
       encode(a.legacy_readiness_sha256, 'hex') as "legacyReadinessSha256",
       (a.relation_readiness_sha256 is null
         and a.relation_set_readiness_sha256 is null
         and a.relation_count is null
         and h.relation_set_readiness_sha256 is null
         and h.relation_count is null) as "relationWitnessesAbsent"`
    : "";
  const result = await persistence.query(`
    select a.revision_id as "revisionId",
           encode(a.readiness_sha256, 'hex') as "readinessSha256",
           encode(a.activation_sha256, 'hex') as "activationSha256",
           convert_from(a.activation_bytes, 'UTF8') as "activationBytes",
           encode(h.head_sha256, 'hex') as "headSha256",
           convert_from(h.head_bytes, 'UTF8') as "headBytes"
           ${currentProjection}
      from ${activationTable} a
      join ${headTable} h
        on h.scope_id = a.scope_id
       and h.activation_sequence = a.activation_sequence
  `);
  return result.rows[0];
}

async function cutoverInventory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    receipts: number;
    currentTables: number;
    legacyTables: number;
    currentForeignKeys: number;
  }>(`
    select
      (select count(*)::int from drizzle.__drizzle_migrations) as "receipts",
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_activation',
            'fx_system_application_active_head'
          )) as "currentTables",
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_activation_v1',
            'fx_system_application_active_head_v1'
          )) as "legacyTables",
      (select count(*)::int from information_schema.table_constraints
        where constraint_schema = current_schema()
          and constraint_name = any(array[
            'fx_application_activation_legacy_readiness_fk',
            'fx_application_activation_relation_readiness_fk',
            'fx_application_active_head_activation_fk',
            'fx_application_active_head_relation_readiness_fk'
          ])) as "currentForeignKeys"
  `);
  return result.rows[0];
}

async function inventory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{
    deployments: number;
    receipts: number;
    tables: number;
  }>(`
    select
      (select count(*)::int from deployments) as deployments,
      (select count(*)::int from drizzle.__drizzle_migrations) as receipts,
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_activation_v1',
            'fx_system_application_active_head_v1'
          )) as tables
  `);
  return result.rows[0];
}
