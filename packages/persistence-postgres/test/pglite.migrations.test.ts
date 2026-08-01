import {
  cp,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

import { createPGlitePersistence } from "../src/pglite";
import {
  insertSessionTestScope,
  insertTransactionSessionFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

describe("createPGlitePersistence", () => {
  it("checks connectivity", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.check()).resolves.toEqual({ status: "ok" });
  });

  it("runs Drizzle Kit migrations idempotently", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.migrate()).resolves.toBeUndefined();
    await expect(persistence.migrate()).resolves.toBeUndefined();

    const tables = await persistence.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `,
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "commits",
      "deployment_packages",
      "deployments",
      "document_freshness_versions",
      "documents",
      "freshness_processed_events",
      "fx_app_index_entry_current",
      "fx_app_index_entry_rev",
      "fx_app_row_current",
      "fx_app_row_rev",
      "fx_app_unique_key",
      "fx_control_index",
      "fx_control_index_definition",
      "fx_control_schema_version",
      "fx_control_schema_version_index_binding",
      "fx_control_scope",
      "fx_control_scope_provisioning",
      "fx_control_table",
      "fx_system_application_revision_request_v1",
      "fx_system_application_revision_v1",
      "fx_system_commit",
      "fx_system_commit_app_row_change",
      "fx_system_declarative_v2_activation_head",
      "fx_system_declarative_v2_activation_revision",
      "fx_system_declarative_v2_candidate",
      "fx_system_declarative_v2_candidate_projection",
      "fx_system_declarative_v2_diagnostic",
      "fx_system_declarative_v2_frontier_entry",
      "fx_system_declarative_v2_function_group_entry",
      "fx_system_declarative_v2_function_group_manifest",
      "fx_system_declarative_v2_import_edge",
      "fx_system_declarative_v2_link_node",
      "fx_system_declarative_v2_module_summary",
      "fx_system_declarative_v2_page_manifest",
      "fx_system_declarative_v2_registration",
      "fx_system_declarative_v2_runtime_projection",
      "fx_system_declarative_v2_runtime_projection_module",
      "fx_system_declarative_v2_verdict",
      "fx_system_declarative_v2_verifier_attempt",
      "fx_system_declarative_v2_verifier_attempt_v2",
      "fx_system_declarative_v2_verifier_command_authority_v1",
      "fx_system_declarative_v2_verifier_command_v2",
      "fx_system_declarative_v2_verifier_evidence_page_v2",
      "fx_system_idempotency",
      "fx_system_index_build_state",
      "fx_system_outbox",
      "fx_system_point_mutation_redelivery_scheduler",
      "fx_system_scope_clock",
      "fx_system_snapshot_lease",
      "fx_system_tx_execution_claim",
      "fx_system_tx_journal",
      "fx_system_tx_journal_latest_receipt",
      "fx_system_tx_journal_point",
      "fx_system_tx_journal_write_event",
      "fx_system_tx_session",
      "indexes",
      "invoke_session_document_reads",
      "invoke_session_document_writes",
      "invoke_session_index_reads",
      "invoke_session_table_reads",
      "invoke_sessions",
      "leases",
      "live_query_connections",
      "live_query_deliveries",
      "live_query_subscriptions",
      "outbox",
      "persistence_globals",
      "read_only",
      "table_freshness_versions",
    ]);

    const migrationTables = await persistence.query<{
      table_schema: string;
      table_name: string;
    }>(
      `
        select table_schema, table_name
        from information_schema.tables
        where table_name = '__drizzle_migrations'
      `,
    );

    expect(migrationTables.rows).toEqual([
      {
        table_schema: "drizzle",
        table_name: "__drizzle_migrations",
      },
    ]);
  });

  it("upgrades legacy deployment metadata without backfilling scopes", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-scope-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0016-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_scope_catalog",
        projectId: "project_before_scope_catalog",
      });
      await expect(
        previousPersistence.query(
          `select id from fx_control_scope limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(
        currentPersistence.getDeploymentMetadata(
          "deployment_before_scope_catalog",
        ),
      ).resolves.toMatchObject({
        deploymentId: "deployment_before_scope_catalog",
        projectId: "project_before_scope_catalog",
      });
      await expect(
        currentPersistence.getScopeMetadataByDeploymentId(
          "deployment_before_scope_catalog",
        ),
      ).resolves.toBeNull();
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades existing scopes without backfilling clock authority", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-clock-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0017-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_scope_clock",
        projectId: "project_before_scope_clock",
      });
      const scopeId = ScopeIdSchema.make("scope_before_scope_clock");
      await previousPersistence.insertScopeMetadata({
        scopeId,
        deploymentId: "deployment_before_scope_clock",
        physicalLocator: {
          kind: "shared_database",
          databaseKey: "primary",
          schemaName: "public",
        },
      });
      await expect(
        previousPersistence.query(
          `select scope_id from fx_system_scope_clock limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(
        currentPersistence.getScopeMetadata(scopeId),
      ).resolves.toMatchObject({
        scopeId,
        deploymentId: "deployment_before_scope_clock",
      });
      await expect(
        currentPersistence.getScopeClock(scopeId),
      ).resolves.toBeNull();
      const clockCount = await currentPersistence.query<{ count: string }>(
        `select count(*)::text as count from fx_system_scope_clock`,
      );
      expect(clockCount.rows).toEqual([{ count: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades split scopes without inventing provisioning receipts", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-receipt-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0018-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_scope_receipt",
        projectId: "project_before_scope_receipt",
      });
      const scopeId = ScopeIdSchema.make("scope_before_scope_receipt");
      await previousPersistence.insertScopeMetadata({
        scopeId,
        deploymentId: "deployment_before_scope_receipt",
        physicalLocator: {
          kind: "schema_per_scope",
          databaseKey: "primary",
          schemaName: "fx_before_scope_receipt",
        },
      });
      await expect(
        previousPersistence.query(
          `select scope_id from fx_control_scope_provisioning limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.getScopeMetadata(scopeId)).resolves.toMatchObject({
        scopeId,
        deploymentId: "deployment_before_scope_receipt",
        physicalLocator: {
          kind: "schema_per_scope",
          databaseKey: "primary",
          schemaName: "fx_before_scope_receipt",
        },
      });
      const receiptCount = await currentPersistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_scope_provisioning`,
      );
      expect(receiptCount.rows).toEqual([{ count: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds the stable table catalog without inventing legacy mappings", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-table-catalog-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0019-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_table_catalog",
        projectId: "project_before_table_catalog",
      });
      await expect(
        previousPersistence.query(
          `select table_id from fx_control_table limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(
        currentPersistence.getDeploymentMetadata(
          "deployment_before_table_catalog",
        ),
      ).resolves.toMatchObject({
        deploymentId: "deployment_before_table_catalog",
        projectId: "project_before_table_catalog",
      });
      const catalogCount = await currentPersistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_table`,
      );
      expect(catalogCount.rows).toEqual([{ count: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds immutable schema artifacts without backfilling deployments", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-schema-artifact-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0020-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_schema_artifact",
        projectId: "project_before_schema_artifact",
      });
      await previousPersistence.query(`
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values
          ('deployment_before_schema_artifact', 1, 'app', 'users')
      `);
      await expect(
        previousPersistence.query(
          `select schema_version_id from fx_control_schema_version limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(
        currentPersistence.getDeploymentMetadata(
          "deployment_before_schema_artifact",
        ),
      ).resolves.toMatchObject({
        deploymentId: "deployment_before_schema_artifact",
        projectId: "project_before_schema_artifact",
      });
      const stableTables = await currentPersistence.query<{
        table_id: number;
        namespace: string;
        logical_name: string;
      }>(`
        select table_id, namespace, logical_name
        from fx_control_table
        where deployment_id = 'deployment_before_schema_artifact'
      `);
      expect(stableTables.rows).toEqual([
        { table_id: 1, namespace: "app", logical_name: "users" },
      ]);
      const artifactCount = await currentPersistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_schema_version`,
      );
      expect(artifactCount.rows).toEqual([{ count: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds the logical index catalog without inventing index identities", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-index-catalog-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0021-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_index_catalog",
        projectId: "project_before_index_catalog",
      });
      await previousPersistence.query(`
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values
          ('deployment_before_index_catalog', 1, 'app', 'users')
      `);
      await previousPersistence.query(`
        insert into fx_control_schema_version
          (
            deployment_id,
            schema_version_id,
            version,
            manifest_codec_version,
            manifest_json,
            manifest_bytes,
            manifest_sha256
          )
        values
          (
            'deployment_before_index_catalog',
            'schema_before_index_catalog',
            1,
            1,
            '{}'::jsonb,
            decode('7b7d', 'hex'),
            decode(repeat('00', 32), 'hex')
          )
      `);
      await expect(
        previousPersistence.query(
          `select logical_index_id from fx_control_index limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(
        currentPersistence.getDeploymentMetadata(
          "deployment_before_index_catalog",
        ),
      ).resolves.toMatchObject({
        deploymentId: "deployment_before_index_catalog",
        projectId: "project_before_index_catalog",
      });
      const preserved = await currentPersistence.query<{
        table_count: string;
        artifact_count: string;
        index_count: string;
      }>(`
        select
          (select count(*)::text from fx_control_table) as table_count,
          (select count(*)::text from fx_control_schema_version) as artifact_count,
          (select count(*)::text from fx_control_index) as index_count
      `);
      expect(preserved.rows).toEqual([
        { table_count: "1", artifact_count: "1", index_count: "0" },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds immutable index definitions without inventing generations or bindings", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-index-definition-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0022-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.insertDeploymentMetadata({
        deploymentId: "deployment_before_index_definition",
        projectId: "project_before_index_definition",
      });
      await previousPersistence.query(`
        insert into fx_control_table
          (deployment_id, table_id, namespace, logical_name)
        values
          ('deployment_before_index_definition', 1, 'app', 'users')
      `);
      await previousPersistence.query(`
        insert into fx_control_index
          (deployment_id, logical_index_id, table_id, descriptor)
        values
          ('deployment_before_index_definition', 1, 1, 'by_email')
      `);
      await previousPersistence.query(`
        insert into fx_control_schema_version
          (
            deployment_id,
            schema_version_id,
            version,
            manifest_codec_version,
            manifest_json,
            manifest_bytes,
            manifest_sha256
          )
        values
          (
            'deployment_before_index_definition',
            'schema_before_index_definition',
            1,
            1,
            '{}'::jsonb,
            decode('7b7d', 'hex'),
            decode(repeat('00', 32), 'hex')
          )
      `);
      await expect(
        previousPersistence.query(
          `select index_definition_id from fx_control_index_definition limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const preserved = await currentPersistence.query<{
        table_count: string;
        logical_index_count: string;
        schema_count: string;
        definition_count: string;
        binding_count: string;
      }>(`
        select
          (select count(*)::text from fx_control_table) as table_count,
          (select count(*)::text from fx_control_index) as logical_index_count,
          (select count(*)::text from fx_control_schema_version) as schema_count,
          (select count(*)::text from fx_control_index_definition) as definition_count,
          (
            select count(*)::text
            from fx_control_schema_version_index_binding
          ) as binding_count
      `);
      expect(preserved.rows).toEqual([
        {
          table_count: "1",
          logical_index_count: "1",
          schema_count: "1",
          definition_count: "0",
          binding_count: "0",
        },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds fenced index build state without inventing per-scope builds", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-index-build-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0023-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.query(`
        insert into fx_system_scope_clock
          (
            scope_id,
            storage_generation,
            storage_generation_fence,
            last_commit_seq,
            last_outbox_seq,
            epoch
          )
        values ('scope_before_index_build', 'flarexdb_v1', 7, 11, 13, 'epoch-before-build')
      `);
      await expect(
        previousPersistence.query(
          `select index_definition_id from fx_system_index_build_state limit 1`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const preserved = await currentPersistence.query<{
        clock_count: string;
        build_count: string;
        fence: string;
        commit_seq: string;
      }>(`
        select
          (select count(*)::text from fx_system_scope_clock) as clock_count,
          (select count(*)::text from fx_system_index_build_state) as build_count,
          storage_generation_fence::text as fence,
          last_commit_seq::text as commit_seq
        from fx_system_scope_clock
        where scope_id = 'scope_before_index_build'
      `);
      expect(preserved.rows).toEqual([
        {
          clock_count: "1",
          build_count: "0",
          fence: "7",
          commit_seq: "11",
        },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds native scope projections and empty app-row storage compatibly", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-app-row-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0024-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values
          (
            'scope_40000000-0000-0000-0000-000000000001',
            'flarexdb_v1',
            'epoch_40000000-0000-0000-0000-000000000002'
          ),
          ('scope_before_app_rows', 'legacy_v1', 'epoch-before-app-rows')
      `);
      await expect(
        previousPersistence.query(`select scope_uuid from fx_system_scope_clock`),
      ).rejects.toThrow();
      await expect(
        previousPersistence.query(`select count(*) from fx_app_row_rev`),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const preserved = await currentPersistence.query<{
        scope_id: string;
        scope_uuid: string | null;
        epoch_uuid: string | null;
      }>(`
        select scope_id, scope_uuid::text, epoch_uuid::text
        from fx_system_scope_clock
        order by scope_id
      `);
      expect(preserved.rows).toEqual([
        {
          scope_id: "scope_40000000-0000-0000-0000-000000000001",
          scope_uuid: "40000000-0000-0000-0000-000000000001",
          epoch_uuid: "40000000-0000-0000-0000-000000000002",
        },
        {
          scope_id: "scope_before_app_rows",
          scope_uuid: null,
          epoch_uuid: null,
        },
      ]);
      const appRows = await currentPersistence.query<{
        revision_count: string;
        current_count: string;
      }>(`
        select
          (select count(*)::text from fx_app_row_rev) as revision_count,
          (select count(*)::text from fx_app_row_current) as current_count
      `);
      expect(appRows.rows).toEqual([
        { revision_count: "0", current_count: "0" },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds empty transaction-session authorities without changing S06 data", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-session-upgrade-"));
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0025-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, last_commit_seq, epoch)
        values
          (
            'scope_62000000-0000-0000-0000-000000000001',
            'flarexdb_v1',
            1,
            'epoch_62000000-0000-0000-0000-000000000002'
          ),
          ('scope_before_sessions', 'legacy_v1', 0, 'epoch-before-sessions')
      `);
      await previousPersistence.query(`
        insert into fx_app_row_rev
          (scope_uuid, table_id, row_id, commit_seq, write_epoch_uuid,
           schema_version_id, creation_time, value_codec_version, is_tombstone)
        values
          ('62000000-0000-0000-0000-000000000001', 1,
           decode('62000000000000000000000000000003', 'hex'), 1,
           '62000000-0000-0000-0000-000000000002', 'schema_before_sessions',
           1, 1, true)
      `);
      await previousPersistence.query(`
        insert into fx_app_row_current
          (scope_uuid, table_id, row_id, commit_seq)
        values
          ('62000000-0000-0000-0000-000000000001', 1,
           decode('62000000000000000000000000000003', 'hex'), 1)
      `);
      await expect(
        previousPersistence.query(`select count(*) from fx_system_tx_session`),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const preserved = await currentPersistence.query<{
        clocks: string;
        revisions: string;
        current_rows: string;
        sessions: string;
        leases: string;
      }>(`
        select
          (select count(*)::text from fx_system_scope_clock) as clocks,
          (select count(*)::text from fx_app_row_rev) as revisions,
          (select count(*)::text from fx_app_row_current) as current_rows,
          (select count(*)::text from fx_system_tx_session) as sessions,
          (select count(*)::text from fx_system_snapshot_lease) as leases
      `);
      expect(preserved.rows).toEqual([
        {
          clocks: "2",
          revisions: "1",
          current_rows: "1",
          sessions: "0",
          leases: "0",
        },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("rolls back a failed S07 migration receipt and recovers cleanly", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-session-failure-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0025-journal.json",
    );
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const migrationName = "0026_wooden_white_queen.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await copyFile(
        previousJournal,
        resolve(migrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previousPersistence.migrate();
      await copyFile(currentJournal, resolve(migrationsFolder, "meta/_journal.json"));

      const realMigration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_s07_deliberate_missing_table;\n`,
        "utf8",
      );
      const failingPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(failingPersistence.migrate()).rejects.toThrow();

      const absent = await failingPersistence.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_name in ('fx_system_tx_session', 'fx_system_snapshot_lease')
        order by table_name
      `);
      expect(absent.rows).toEqual([]);
      const receipts = await failingPersistence.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "26" }]);

      await copyFile(resolve(currentMigrationsFolder, migrationName), copiedMigration);
      const recoveredPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      const recovered = await recoveredPersistence.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_name in ('fx_system_tx_session', 'fx_system_snapshot_lease')
        order by table_name
      `);
      expect(recovered.rows).toEqual([
        { table_name: "fx_system_snapshot_lease" },
        { table_name: "fx_system_tx_session" },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades completed S07 clocks without changing copied session evidence", async () => {
    const testRoot = await mkdtemp(
      resolve(tmpdir(), "flarex-revocation-epoch-upgrade-"),
    );
    const previousMigrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0026-journal.json",
    );
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, previousMigrationsFolder, {
        recursive: true,
      });
      await copyFile(
        previousJournal,
        resolve(previousMigrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder: previousMigrationsFolder,
      });
      await previousPersistence.migrate();
      await insertSessionTestScope(previousPersistence);
      const sessionId = transactionSessionIdAt(27);
      await insertTransactionSessionFixture(
        previousPersistence,
        transactionSessionFixture(sessionId, {
          authorizationRevocationEpoch: "17",
        }),
      );
      await expect(
        previousPersistence.query(
          `select authorization_revocation_epoch from fx_system_scope_clock`,
        ),
      ).rejects.toThrow();

      const currentPersistence = await createPGlitePersistence({ db });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const preserved = await currentPersistence.query<{
        clock_epoch: string;
        session_epoch: string;
      }>(
        `
          select
            clock.authorization_revocation_epoch::text as clock_epoch,
            session.authorization_revocation_epoch::text as session_epoch
          from fx_system_scope_clock as clock
          join fx_system_tx_session as session
            on session.scope_uuid = clock.scope_uuid
          where session.session_id = $1
        `,
        [sessionId],
      );
      expect(preserved.rows).toEqual([
        { clock_epoch: "0", session_epoch: "17" },
      ]);

      await currentPersistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values
          ('scope_after_revocation_epoch', 'legacy_v1', 'epoch-after-revocation')
      `);
      const defaulted = await currentPersistence.query<{ epoch: string }>(`
        select authorization_revocation_epoch::text as epoch
        from fx_system_scope_clock
        where scope_id = 'scope_after_revocation_epoch'
      `);
      expect(defaulted.rows).toEqual([{ epoch: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("rolls back a failed S07-A migration receipt and recovers cleanly", async () => {
    const testRoot = await mkdtemp(
      resolve(tmpdir(), "flarex-revocation-epoch-failure-"),
    );
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const previousJournal = resolve(
      packageRoot,
      "test/fixtures/drizzle-through-0026-journal.json",
    );
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const migrationName = "0027_graceful_silver_fox.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await copyFile(
        previousJournal,
        resolve(migrationsFolder, "meta/_journal.json"),
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values
          ('scope_before_revocation_epoch', 'legacy_v1', 'epoch-before-revocation')
      `);
      await copyFile(
        currentJournal,
        resolve(migrationsFolder, "meta/_journal.json"),
      );

      const realMigration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_s07a_deliberate_missing_table;\n`,
        "utf8",
      );
      const failingPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(failingPersistence.migrate()).rejects.toThrow();

      const absent = await failingPersistence.query<{ column_name: string }>(`
        select column_name
        from information_schema.columns
        where table_name = 'fx_system_scope_clock'
          and column_name = 'authorization_revocation_epoch'
          and table_schema = current_schema()
      `);
      expect(absent.rows).toEqual([]);
      const unchanged = await failingPersistence.query<{ epoch: string }>(`
        select epoch
        from fx_system_scope_clock
        where scope_id = 'scope_before_revocation_epoch'
      `);
      expect(unchanged.rows).toEqual([{ epoch: "epoch-before-revocation" }]);
      const failedReceipts = await failingPersistence.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(failedReceipts.rows).toEqual([{ count: "27" }]);

      await copyFile(
        resolve(currentMigrationsFolder, migrationName),
        copiedMigration,
      );
      const recoveredPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      const recovered = await recoveredPersistence.query<{ epoch: string }>(`
        select authorization_revocation_epoch::text as epoch
        from fx_system_scope_clock
        where scope_id = 'scope_before_revocation_epoch'
      `);
      expect(recovered.rows).toEqual([{ epoch: "0" }]);
      const recoveredReceipts = await recoveredPersistence.query<{
        count: string;
      }>(`select count(*)::text as count from drizzle.__drizzle_migrations`);
      expect(recoveredReceipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds the four empty C03 attempt tables to an existing 0027 database", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-c03-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const previousJournal = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const parsedJournal = JSON.parse(
        await readFile(currentJournal, "utf8"),
      ) as { entries?: Array<{ idx?: number }> };
      if (!Array.isArray(parsedJournal.entries)) {
        throw new Error("Current Drizzle journal is missing its entries array.");
      }
      parsedJournal.entries = parsedJournal.entries.filter(
        (entry) => entry.idx !== undefined && entry.idx < 28,
      );
      await writeFile(
        previousJournal,
        `${JSON.stringify(parsedJournal, null, 2)}\n`,
        "utf8",
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previousPersistence.migrate();
      await previousPersistence.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values
          ('scope_before_c03', 'legacy_v1', 'epoch-before-c03')
      `);
      await expect(
        previousPersistence.query(`select count(*) from fx_system_tx_journal`),
      ).rejects.toThrow();

      await copyFile(currentJournal, previousJournal);
      const currentPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      await expect(currentPersistence.migrate()).resolves.toBeUndefined();
      const tables = await currentPersistence.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_tx_journal',
            'fx_system_tx_journal_latest_receipt',
            'fx_system_tx_journal_point',
            'fx_system_tx_journal_write_event'
          )
        order by table_name
      `);
      expect(tables.rows).toEqual([
        { table_name: "fx_system_tx_journal" },
        { table_name: "fx_system_tx_journal_latest_receipt" },
        { table_name: "fx_system_tx_journal_point" },
        { table_name: "fx_system_tx_journal_write_event" },
      ]);
      const eventEvidenceColumn = await currentPersistence.query<{
        column_default: string | null;
        is_nullable: string;
      }>(`
        select column_default, is_nullable
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_tx_journal'
          and column_name = 'material_write_event_evidence_bytes'
      `);
      expect(eventEvidenceColumn.rows).toHaveLength(1);
      expect(eventEvidenceColumn.rows[0]?.is_nullable).toBe("NO");
      expect(eventEvidenceColumn.rows[0]?.column_default).toContain("0");
      const eventEvidenceCheck = await currentPersistence.query<{
        definition: string;
      }>(`
        select pg_get_constraintdef(constraint_row.oid) as definition
        from pg_constraint constraint_row
        join pg_class relation on relation.oid = constraint_row.conrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = current_schema()
          and relation.relname = 'fx_system_tx_journal'
          and constraint_row.conname =
            'fx_system_tx_journal_material_write_event_evidence_bytes_check'
      `);
      expect(eventEvidenceCheck.rows).toHaveLength(1);
      expect(eventEvidenceCheck.rows[0]?.definition).toContain("67108864");
      const preserved = await currentPersistence.query<{ count: string }>(`
        select count(*)::text as count
        from fx_system_scope_clock
        where scope_id = 'scope_before_c03'
      `);
      expect(preserved.rows).toEqual([{ count: "1" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("rolls back a failed C03 migration receipt and recovers cleanly", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-c03-failure-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0028_glossy_galactus.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const parsedJournal = JSON.parse(
        await readFile(currentJournal, "utf8"),
      ) as { entries?: Array<{ idx?: number }> };
      if (!Array.isArray(parsedJournal.entries)) {
        throw new Error("Current Drizzle journal is missing its entries array.");
      }
      parsedJournal.entries = parsedJournal.entries.filter(
        (entry) => entry.idx !== undefined && entry.idx < 28,
      );
      await writeFile(
        temporaryJournal,
        `${JSON.stringify(parsedJournal, null, 2)}\n`,
        "utf8",
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previousPersistence.migrate();
      await copyFile(currentJournal, temporaryJournal);

      const realMigration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_c03_deliberate_missing_table;\n`,
        "utf8",
      );
      const failingPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(failingPersistence.migrate()).rejects.toThrow();
      const absent = await failingPersistence.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
          and table_name like 'fx_system_tx_journal%'
      `);
      expect(absent.rows).toEqual([]);
      const failedReceipts = await failingPersistence.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(failedReceipts.rows).toEqual([{ count: "28" }]);

      await copyFile(
        resolve(currentMigrationsFolder, migrationName),
        copiedMigration,
      );
      const recoveredPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      const recovered = await recoveredPersistence.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name like 'fx_system_tx_journal%'
      `);
      expect(recovered.rows).toEqual([{ count: "4" }]);
      const recoveredReceipts = await recoveredPersistence.query<{
        count: string;
      }>(`select count(*)::text as count from drizzle.__drizzle_migrations`);
      expect(recoveredReceipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades through 0034 atomically, replays it idempotently, and bootstraps exactly one scheduler row", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-redelivery-scheduler-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0034_point_mutation_redelivery_scheduler.sql";
    const copiedMigrationPath = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries) ||
        parsedJournal.entries.length < 1
      ) {
        throw new Error("Expected a nonempty Drizzle migration journal.");
      }
      const previousJournal = {
        ...parsedJournal,
        entries: parsedJournal.entries.filter((entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < 34
        ),
      };
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify(previousJournal, null, 2)}\n`,
        "utf8",
      );
      const previousPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previousPersistence.migrate();
      const before = await previousPersistence.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_point_mutation_redelivery_scheduler'
      `);
      expect(before.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const realMigration = await readFile(copiedMigrationPath, "utf8");
      await writeFile(
        copiedMigrationPath,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_b0_deliberate_missing_table;\n`,
        "utf8",
      );
      const failingPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(failingPersistence.migrate()).rejects.toThrow();
      const afterFailure = await failingPersistence.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_point_mutation_redelivery_scheduler'
      `);
      expect(afterFailure.rows).toEqual([{ count: "0" }]);
      const failedReceipts = await failingPersistence.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(failedReceipts.rows).toEqual([{ count: "34" }]);

      await writeFile(copiedMigrationPath, realMigration, "utf8");
      const recoveredPersistence = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      await expect(recoveredPersistence.migrate()).resolves.toBeUndefined();
      const recovered = await recoveredPersistence.query<{
        scheduler_key: string;
        scheduler_state: string;
        run_fence: string;
      }>(`
        select
          scheduler_key,
          scheduler_state,
          run_fence::text as run_fence
        from fx_system_point_mutation_redelivery_scheduler
      `);
      expect(recovered.rows).toEqual([{
        scheduler_key: "point_mutation_redelivery_v1",
        scheduler_state: "idle",
        run_fence: "0",
      }]);
      const recoveredReceipts = await recoveredPersistence.query<{
        count: string;
      }>(`select count(*)::text as count from drizzle.__drizzle_migrations`);
      expect(recoveredReceipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades 0034 to inert Declarative V2 tables without enrolling an activation head", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-dv2-s0-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries) ||
        parsedJournal.entries.length < 1
      ) {
        throw new Error("Expected a nonempty Drizzle migration journal.");
      }
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify({
          ...parsedJournal,
          entries: parsedJournal.entries.filter((entry) =>
            isNonArrayRecord(entry) &&
            typeof entry.idx === "number" &&
            entry.idx < 35
          ),
        }, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previous.migrate();
      const before = await previous.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name like 'fx_system_declarative_v2_%'
          and table_name not like '%\\_v2' escape '\\'
      `);
      expect(before.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const current = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await current.migrate();
      await current.migrate();
      const after = await current.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name like 'fx_system_declarative_v2_%'
          and table_name not like '%\\_v2' escape '\\'
      `);
      expect(after.rows).toEqual([{ count: "18" }]);
      const constraints = await current.query<{
        check_count: string;
        foreign_key_count: string;
      }>(`
        select
          count(*) filter (where contype = 'c')::text as check_count,
          count(*) filter (where contype = 'f')::text as foreign_key_count
        from pg_constraint
        where conname like 'fx_dv2_%'
          and conname not like '%\\_v2\\_%' escape '\\'
      `);
      expect(constraints.rows).toEqual([{
        check_count: "58",
        foreign_key_count: "25",
      }]);
      const heads = await current.query<{ count: string }>(`
        select count(*)::text as count
        from fx_system_declarative_v2_activation_head
      `);
      expect(heads.rows).toEqual([{ count: "0" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds isolated V2 verifier progress storage without reinterpreting populated V1 rows", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-dv2-b2-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries) ||
        parsedJournal.entries.length < 1
      ) {
        throw new Error("Expected a nonempty Drizzle migration journal.");
      }
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify({
          ...parsedJournal,
          entries: parsedJournal.entries.filter((entry) =>
            isNonArrayRecord(entry) &&
            typeof entry.idx === "number" &&
            entry.idx < 36
          ),
        }, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previous.migrate();
      await previous.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, epoch)
        values
          ('scope_dv2_v1_preserved', 'flarexdb_v1', 'epoch-dv2-v1')
      `);
      await previous.query(`
        insert into fx_system_declarative_v2_candidate (
          scope_id,
          candidate_sha256,
          storage_generation,
          storage_generation_fence,
          epoch,
          frame_codec_version,
          frame_byte_length,
          frame_sha256,
          frame_bytes
        ) values (
          'scope_dv2_v1_preserved',
          decode(repeat('11', 32), 'hex'),
          'flarexdb_v1',
          1,
          'epoch-dv2-v1',
          1,
          1,
          decode(repeat('11', 32), 'hex'),
          decode('00', 'hex')
        )
      `);
      await previous.query(`
        insert into fx_system_declarative_v2_verifier_attempt (
          scope_id,
          attempt_sha256,
          candidate_sha256,
          lifecycle,
          identity_codec_version,
          identity_byte_length,
          identity_sha256,
          identity_bytes,
          ceilings_codec_version,
          ceilings_byte_length,
          ceilings_sha256,
          ceilings_bytes,
          usage_codec_version,
          usage_byte_length,
          usage_sha256,
          usage_bytes,
          progress_codec_version,
          progress_byte_length,
          progress_sha256,
          progress_bytes
        ) values (
          'scope_dv2_v1_preserved',
          decode(repeat('22', 32), 'hex'),
          decode(repeat('11', 32), 'hex'),
          'open',
          1,
          1,
          decode(repeat('22', 32), 'hex'),
          decode('00', 'hex'),
          1,
          1,
          decode(repeat('33', 32), 'hex'),
          decode('00', 'hex'),
          1,
          1,
          decode(repeat('44', 32), 'hex'),
          decode('00', 'hex'),
          1,
          1,
          decode(repeat('55', 32), 'hex'),
          decode('00', 'hex')
        )
      `);
      await expect(previous.query(
        `select count(*) from fx_system_declarative_v2_verifier_attempt_v2`,
      )).rejects.toThrow();

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const current = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await current.migrate();
      await current.migrate();

      const v2Tables = await current.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_declarative_v2_verifier_attempt_v2',
            'fx_system_declarative_v2_verifier_command_v2',
            'fx_system_declarative_v2_verifier_evidence_page_v2'
          )
        order by table_name
      `);
      expect(v2Tables.rows).toEqual([
        { table_name: "fx_system_declarative_v2_verifier_attempt_v2" },
        { table_name: "fx_system_declarative_v2_verifier_command_v2" },
        { table_name: "fx_system_declarative_v2_verifier_evidence_page_v2" },
      ]);
      const v2Rows = await current.query<{ count: string }>(`
        select (
          (select count(*) from fx_system_declarative_v2_verifier_attempt_v2)
          + (select count(*) from fx_system_declarative_v2_verifier_command_v2)
          + (select count(*) from fx_system_declarative_v2_verifier_evidence_page_v2)
        )::text as count
      `);
      expect(v2Rows.rows).toEqual([{ count: "0" }]);
      const preserved = await current.query<{
        attempt_count: string;
        candidate_count: string;
      }>(`
        select
          (
            select count(*)::text
            from fx_system_declarative_v2_verifier_attempt
            where scope_id = 'scope_dv2_v1_preserved'
          ) as attempt_count,
          (
            select count(*)::text
            from fx_system_declarative_v2_candidate
            where scope_id = 'scope_dv2_v1_preserved'
          ) as candidate_count
      `);
      expect(preserved.rows).toEqual([{
        attempt_count: "1",
        candidate_count: "1",
      }]);
      const constraints = await current.query<{
        check_count: string;
        foreign_key_count: string;
        restrict_foreign_key_count: string;
      }>(`
        select
          count(*) filter (where contype = 'c')::text as check_count,
          count(*) filter (where contype = 'f')::text as foreign_key_count,
          count(*) filter (
            where contype = 'f' and confdeltype = 'r'
          )::text as restrict_foreign_key_count
        from pg_constraint
        where conname like 'fx_dv2_%_v2_%'
      `);
      expect(constraints.rows).toEqual([{
        check_count: "24",
        foreign_key_count: "3",
        restrict_foreign_key_count: "3",
      }]);
      const constraintNames = await current.query<{
        conname: string;
      }>(`
        select conname
        from pg_constraint
        where conname like 'fx_dv2_%_v2_%'
        order by conname
      `);
      expect(constraintNames.rows.map((row) => row.conname)).toEqual([
        "fx_dv2_attempt_v2_candidate_fk",
        "fx_dv2_attempt_v2_ceilings_frame_check",
        "fx_dv2_attempt_v2_digest_check",
        "fx_dv2_attempt_v2_fence_check",
        "fx_dv2_attempt_v2_identity_frame_check",
        "fx_dv2_attempt_v2_lease_check",
        "fx_dv2_attempt_v2_lifecycle_check",
        "fx_dv2_attempt_v2_pending_check",
        "fx_dv2_attempt_v2_progress_frame_check",
        "fx_dv2_attempt_v2_settled_check",
        "fx_dv2_attempt_v2_timestamps_check",
        "fx_dv2_attempt_v2_usage_frame_check",
        "fx_dv2_command_v2_attempt_fk",
        "fx_dv2_command_v2_budget_frame_check",
        "fx_dv2_command_v2_identity_check",
        "fx_dv2_command_v2_page_tail_check",
        "fx_dv2_command_v2_reservation_check",
        "fx_dv2_command_v2_reservation_frame_check",
        "fx_dv2_command_v2_reservation_unique",
        "fx_dv2_command_v2_settlement_check",
        "fx_dv2_page_v2_command_fk",
        "fx_dv2_page_v2_created_check",
        "fx_dv2_page_v2_identity_check",
        "fx_dv2_page_v2_manifest_frame_check",
        "fx_dv2_page_v2_payload_check",
        "fx_dv2_page_v2_predecessor_check",
        "fx_dv2_page_v2_range_check",
        "fx_dv2_page_v2_roots_check",
      ]);
      const indexes = await current.query<{
        indexname: string;
        indexdef: string;
      }>(`
        select indexname, indexdef
        from pg_indexes
        where schemaname = current_schema()
          and tablename in (
            'fx_system_declarative_v2_verifier_attempt_v2',
            'fx_system_declarative_v2_verifier_command_v2',
            'fx_system_declarative_v2_verifier_evidence_page_v2'
          )
        order by indexname
      `);
      expect(indexes.rows).toHaveLength(4);
      expect(indexes.rows.map((row) => row.indexdef)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("(scope_id, attempt_sha256)"),
          expect.stringContaining("(scope_id, attempt_sha256, sequence)"),
          expect.stringContaining(
            "(scope_id, attempt_sha256, sequence, page_ordinal)",
          ),
          expect.stringContaining(
            "(scope_id, attempt_sha256, sequence, reservation_sha256, command_kind)",
          ),
        ]),
      );
      const attemptValues = `
        'scope_dv2_v1_preserved',
        decode(repeat('66', 32), 'hex'),
        decode(repeat('11', 32), 'hex'),
        'open',
        2, 1, decode(repeat('66', 32), 'hex'), decode('00', 'hex'),
        2, 1, decode(repeat('67', 32), 'hex'), decode('00', 'hex'),
        2, 1, decode(repeat('68', 32), 'hex'), decode('00', 'hex'),
        2, 1, decode(repeat('69', 32), 'hex'), decode('00', 'hex')
      `;
      const attemptColumns = `
        scope_id, attempt_sha256, candidate_sha256, lifecycle,
        identity_codec_version, identity_byte_length, identity_sha256,
        identity_bytes, ceilings_codec_version, ceilings_byte_length,
        ceilings_sha256, ceilings_bytes, usage_codec_version,
        usage_byte_length, usage_sha256, usage_bytes, progress_codec_version,
        progress_byte_length, progress_sha256, progress_bytes
      `;
      await expect(current.query(`
        insert into fx_system_declarative_v2_verifier_attempt_v2 (
          ${attemptColumns}, settled_sequence
        ) values (${attemptValues}, 1)
      `)).rejects.toThrow();
      await current.query(`
        insert into fx_system_declarative_v2_verifier_attempt_v2 (
          ${attemptColumns}
        ) values (${attemptValues})
      `);
      await expect(current.query(`
        update fx_system_declarative_v2_verifier_attempt_v2
        set
          writer_owner_id = '00000000-0000-0000-0000-000000000001',
          writer_fence = 2,
          lease_updated_at = now(),
          lease_expires_at = now() + interval '1 minute',
          pending_kind = 'parse_module',
          pending_sequence = 1,
          pending_reservation_sha256 = decode(repeat('70', 32), 'hex'),
          pending_reserved_by_fence = 1,
          pending_started_at = now()
        where scope_id = 'scope_dv2_v1_preserved'
      `)).rejects.toThrow();
      const commandColumns = `
        scope_id, attempt_sha256, sequence, command_kind, reservation_sha256,
        reservation_codec_version, reservation_byte_length,
        reservation_frame_sha256, reservation_bytes,
        command_budget_codec_version, command_budget_byte_length,
        command_budget_sha256, command_budget_bytes, reserved_by_fence,
        reserved_at
      `;
      const commandValues = `
        'scope_dv2_v1_preserved',
        decode(repeat('66', 32), 'hex'),
        1,
        'parse_module',
        decode(repeat('70', 32), 'hex'),
        2, 1, decode(repeat('70', 32), 'hex'), decode('00', 'hex'),
        2, 1, decode(repeat('71', 32), 'hex'), decode('00', 'hex'),
        1,
        now()
      `;
      await expect(current.query(`
        insert into fx_system_declarative_v2_verifier_command_v2 (
          ${commandColumns}, page_count
        ) values (${commandValues}, 1)
      `)).rejects.toThrow();
      await current.query(`
        insert into fx_system_declarative_v2_verifier_command_v2 (
          ${commandColumns}
        ) values (${commandValues})
      `);
      await expect(current.query(`
        update fx_system_declarative_v2_verifier_command_v2
        set
          output_manifest_codec_version = 2,
          output_manifest_byte_length = 1,
          output_manifest_sha256 = decode(repeat('75', 32), 'hex'),
          output_manifest_bytes = decode('00', 'hex'),
          command_usage_codec_version = 2,
          command_usage_byte_length = 1,
          command_usage_sha256 = decode(repeat('76', 32), 'hex'),
          command_usage_bytes = decode('00', 'hex'),
          resulting_usage_codec_version = 2,
          resulting_usage_byte_length = 1,
          resulting_usage_sha256 = decode(repeat('77', 32), 'hex'),
          resulting_usage_bytes = decode('00', 'hex'),
          next_progress_codec_version = 2,
          next_progress_byte_length = 1,
          next_progress_sha256 = decode(repeat('78', 32), 'hex'),
          next_progress_bytes = decode('00', 'hex'),
          receipt_codec_version = 2,
          receipt_byte_length = 1,
          receipt_sha256 = decode(repeat('79', 32), 'hex'),
          receipt_bytes = decode('00', 'hex'),
          settled_at = reserved_at
        where scope_id = 'scope_dv2_v1_preserved'
      `)).rejects.toThrow();
      await expect(current.query(`
        insert into fx_system_declarative_v2_verifier_evidence_page_v2 (
          scope_id, attempt_sha256, sequence, command_kind,
          reservation_sha256, page_ordinal, page_sha256,
          first_evidence_ordinal, evidence_count, first_diagnostic_ordinal,
          diagnostic_count, predecessor_page_sha256,
          cumulative_diagnostics_root_sha256, manifest_codec_version,
          manifest_byte_length, manifest_sha256, manifest_bytes,
          payload_codec_version, payload_byte_length, payload_sha256,
          payload_bytes
        ) values (
          'scope_dv2_v1_preserved',
          decode(repeat('66', 32), 'hex'),
          1,
          'parse_module',
          decode(repeat('70', 32), 'hex'),
          1,
          decode(repeat('72', 32), 'hex'),
          1,
          1,
          0,
          0,
          null,
          decode(repeat('73', 32), 'hex'),
          2,
          1,
          decode(repeat('72', 32), 'hex'),
          decode('00', 'hex'),
          1,
          1,
          decode(repeat('74', 32), 'hex'),
          decode('00', 'hex')
        )
      `)).rejects.toThrow();
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds inactive revision registration without activating a candidate", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-fsv02-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries)
      ) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify({
          ...parsedJournal,
          entries: parsedJournal.entries.filter((entry) =>
            isNonArrayRecord(entry) &&
            typeof entry.idx === "number" &&
            entry.idx < 37
          ),
        }, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previous.migrate();
      await expect(previous.query(
        `select count(*) from fx_system_application_revision_v1`,
      )).rejects.toThrow();
      const previousReceipts = await previous.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(previousReceipts.rows).toEqual([{ count: "37" }]);

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const current = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await current.migrate();
      await current.migrate();
      const tables = await current.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_application_revision_v1',
            'fx_system_application_revision_request_v1'
          )
        order by table_name
      `);
      expect(tables.rows).toEqual([
        { table_name: "fx_system_application_revision_request_v1" },
        { table_name: "fx_system_application_revision_v1" },
      ]);
      const heads = await current.query<{ count: string }>(
        `select count(*)::text as count
         from fx_system_declarative_v2_activation_head`,
      );
      expect(heads.rows).toEqual([{ count: "0" }]);
      const currentReceipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(currentReceipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades 0039 to S10 atomically and replays the index sidecars", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s10-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0040_lush_tenebrous.sql";
    const copiedMigrationPath = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries)
      ) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      const previousJournal = {
        ...parsedJournal,
        entries: parsedJournal.entries.filter((entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < 40
        ),
      };
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify(previousJournal, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previous.migrate();
      await expect(previous.query(
        `select count(*) from fx_app_index_entry_rev`,
      )).rejects.toThrow();

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const realMigration = await readFile(copiedMigrationPath, "utf8");
      await writeFile(
        copiedMigrationPath,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_s10_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow(
        /fx_s10_deliberate_missing_table/,
      );
      const afterFailure = await failing.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_app_index_entry_rev',
            'fx_app_index_entry_current'
          )
      `);
      expect(afterFailure.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedMigrationPath, realMigration, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const tables = await current.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_app_index_entry_rev',
            'fx_app_index_entry_current'
          )
        order by table_name
      `);
      expect(tables.rows).toEqual([
        { table_name: "fx_app_index_entry_current" },
        { table_name: "fx_app_index_entry_rev" },
      ]);
      const receipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades 0040 to S11 atomically and replays the unique-key authority", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s11-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0041_hard_spyke.sql";
    const copiedMigrationPath = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries)
      ) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      const previousJournal = {
        ...parsedJournal,
        entries: parsedJournal.entries.filter((entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < 41
        ),
      };
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify(previousJournal, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder,
      });
      await previous.migrate();
      await expect(previous.query(
        `select count(*) from fx_app_unique_key`,
      )).rejects.toThrow();

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const realMigration = await readFile(copiedMigrationPath, "utf8");
      await writeFile(
        copiedMigrationPath,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_s11_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow(
        /fx_s11_deliberate_missing_table/,
      );
      const afterFailure = await failing.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_app_unique_key'
      `);
      expect(afterFailure.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedMigrationPath, realMigration, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const constraints = await current.query<{ constraint_name: string }>(`
        select constraint_name
        from information_schema.table_constraints
        where table_schema = current_schema()
          and table_name = 'fx_app_unique_key'
          and constraint_name in (
            'fx_app_unique_key_pk',
            'fx_app_unique_key_owner_unique',
            'fx_app_unique_key_scope_clock_fk',
            'fx_app_unique_key_row_revision_fk'
          )
        order by constraint_name
      `);
      expect(constraints.rows).toEqual([
        { constraint_name: "fx_app_unique_key_owner_unique" },
        { constraint_name: "fx_app_unique_key_pk" },
        { constraint_name: "fx_app_unique_key_row_revision_fk" },
        { constraint_name: "fx_app_unique_key_scope_clock_fk" },
      ]);
      const receipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("adds the C08 row-validation index over populated S10 current entries", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-c08-index-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(currentJournalPath, "utf8");
      const parsedJournal: unknown = JSON.parse(currentJournalText);
      if (
        !isNonArrayRecord(parsedJournal) ||
        !Array.isArray(parsedJournal.entries)
      ) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      const previousJournal = {
        ...parsedJournal,
        entries: parsedJournal.entries.filter((entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < 42
        ),
      };
      await writeFile(
        copiedJournalPath,
        `${JSON.stringify(previousJournal, null, 2)}\n`,
        "utf8",
      );
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await previous.query(`
        insert into fx_system_scope_clock
          (scope_id, storage_generation, storage_generation_fence,
           last_commit_seq, last_outbox_seq, epoch)
        values
          ('scope_c0842000-0000-0000-0000-000000000001',
           'flarexdb_v1', 1, 1, 0,
           'epoch_c0842000-0000-0000-0000-000000000001');
      `);
      await previous.query(`
        insert into fx_app_row_rev
          (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
           write_epoch_uuid, schema_version_id, creation_time,
           value_codec_version, is_tombstone, value_json, value_bytes,
           value_sha256)
        values
          ('c0842000-0000-0000-0000-000000000001', 1,
           decode(repeat('11', 16), 'hex'), 1, null,
           'c0842000-0000-0000-0000-000000000001', 'schema_c08_upgrade',
           1, 1, false, '{}'::jsonb, decode('00', 'hex'),
           decode(repeat('aa', 32), 'hex'));
      `);
      await previous.query(`
        insert into fx_app_index_entry_rev
          (scope_uuid, index_definition_id, table_id, key_codec_version,
           physical_spec_sha256, encoded_key, key_sha256, row_id,
           commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
        values
          ('c0842000-0000-0000-0000-000000000001', 1, 1, 1,
           decode(repeat('bb', 32), 'hex'), decode('10', 'hex'),
           decode(repeat('cc', 32), 'hex'),
           decode(repeat('11', 16), 'hex'), 1, null,
           'c0842000-0000-0000-0000-000000000001', false);
      `);
      await previous.query(`
        insert into fx_app_index_entry_current
          (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
        values
          ('c0842000-0000-0000-0000-000000000001', 1,
           decode('10', 'hex'), decode(repeat('11', 16), 'hex'), 1);
      `);
      const before = await previous.query<{ count: string }>(`
        select count(*)::text as count
        from pg_indexes
        where schemaname = current_schema()
          and indexname =
            'fx_app_index_entry_current_scope_definition_row_idx'
      `);
      expect(before.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedJournalPath, currentJournalText, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const after = await current.query<{ count: string; indexdef: string }>(`
        select
          (select count(*)::text from fx_app_index_entry_current) as count,
          indexdef
        from pg_indexes
        where schemaname = current_schema()
          and indexname =
            'fx_app_index_entry_current_scope_definition_row_idx'
      `);
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]?.count).toBe("1");
      expect(after.rows[0]?.indexdef).toContain(
        "(scope_uuid, index_definition_id, row_id)",
      );
      const receipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "43" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });
});
