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
import { seedTaskComputeDeliverySchemaV1 } from
  "./taskComputeDeliverySchemaV1TestSupport";
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
      "fx_app_edge_adjacency_version",
      "fx_app_edge_current",
      "fx_app_index_entry_current",
      "fx_app_index_entry_rev",
      "fx_app_row_current",
      "fx_app_row_rev",
      "fx_app_unique_key",
      "fx_control_application_manifest_schema_binding",
      "fx_control_application_schema_authority_v1",
      "fx_control_bound_application_schema",
      "fx_control_edge_definition",
      "fx_control_index",
      "fx_control_index_definition",
      "fx_control_relation",
      "fx_control_schema_relation_binding",
      "fx_control_schema_unique_constraint_set",
      "fx_control_schema_version",
      "fx_control_schema_version_index_binding",
      "fx_control_schema_version_unique_constraint_binding",
      "fx_control_scope",
      "fx_control_scope_provisioning",
      "fx_control_table",
      "fx_control_unique_constraint",
      "fx_control_unique_constraint_definition",
      "fx_system_app_schema_candidate_validation",
      "fx_system_application_action_invocation_v1",
      "fx_system_application_activation",
      "fx_system_application_active_head",
      "fx_system_application_analysis_v1",
      "fx_system_application_candidate_v1",
      "fx_system_application_function",
      "fx_system_application_function_v1",
      "fx_system_application_publication",
      "fx_system_application_publication_v1",
      "fx_system_application_readiness",
      "fx_system_application_readiness_function",
      "fx_system_application_readiness_function_v1",
      "fx_system_application_readiness_relation",
      "fx_system_application_readiness_v1",
      "fx_system_application_relation_semantic_readiness",
      "fx_system_application_relation_semantic_validation",
      "fx_system_application_revision_schema",
      "fx_system_application_revision_schema_v1",
      "fx_system_application_revision_v2",
      "fx_system_application_task_catalog",
      "fx_system_application_task_catalog_v1",
      "fx_system_application_task_definition",
      "fx_system_application_task_definition_v1",
      "fx_system_commit",
      "fx_system_commit_app_row_change",
      "fx_system_durable_task_attempt_identity_v1",
      "fx_system_durable_task_compute_cancellation_v1",
      "fx_system_durable_task_compute_dispatch_v1",
      "fx_system_durable_task_compute_pending_v1",
      "fx_system_durable_task_definition_revision_v1",
      "fx_system_durable_task_repair_scheduler_v1",
      "fx_system_durable_task_requested_effect_v1",
      "fx_system_durable_task_run_request_v1",
      "fx_system_durable_task_run_v1",
      "fx_system_edge_definition_build",
      "fx_system_edge_definition_readiness",
      "fx_system_external_effect_attempt_v1",
      "fx_system_idempotency",
      "fx_system_index_build_state",
      "fx_system_outbox",
      "fx_system_physical_definition_lifecycle",
      "fx_system_point_mutation_redelivery_scheduler",
      "fx_system_retained_history_scheduler",
      "fx_system_scope_clock",
      "fx_system_snapshot_lease",
      "fx_system_tx_execution_claim",
      "fx_system_tx_journal",
      "fx_system_tx_journal_index_range",
      "fx_system_tx_journal_latest_receipt",
      "fx_system_tx_journal_point",
      "fx_system_tx_journal_relation_incoming",
      "fx_system_tx_journal_write_event",
      "fx_system_tx_session",
      "fx_system_unique_constraint_set_build",
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

    const edgeBuildConstraints = await persistence.query<{
      constraint_name: string;
      definition: string;
    }>(
      `select conname constraint_name, pg_get_constraintdef(oid) definition
         from pg_constraint
        where conname in (
          'fx_system_edge_definition_build_count_check',
          'fx_system_edge_definition_build_scope_fk',
          'fx_system_edge_definition_readiness_build_fk'
        )
        order by conname`,
    );
    expect(edgeBuildConstraints.rows.map((row) => row.constraint_name)).toEqual([
      "fx_system_edge_definition_build_count_check",
      "fx_system_edge_definition_build_scope_fk",
      "fx_system_edge_definition_readiness_build_fk",
    ]);
    const progressCheck = edgeBuildConstraints.rows.find((row) =>
      row.constraint_name === "fx_system_edge_definition_build_count_check"
    )?.definition ?? "";
    expect(progressCheck).toContain("processed_source_count = 0");
    expect(progressCheck).toContain(
      "validated_source_count = processed_source_count",
    );
    const edgeBuildIndexes = await persistence.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where tablename = 'fx_system_edge_definition_readiness'
        order by indexname`,
    );
    expect(edgeBuildIndexes.rows.map((row) => row.indexname)).toContain(
      "fx_system_edge_definition_readiness_digest_unique",
    );

    const semanticConstraints = await persistence.query<{
      constraint_name: string;
      definition: string;
    }>(
      `select conname constraint_name, pg_get_constraintdef(oid) definition
         from pg_constraint
        where conname in (
          'fx_app_relation_semantic_validation_count_check',
          'fx_app_relation_semantic_validation_lineage_check',
          'fx_app_relation_semantic_validation_scope_fk',
          'fx_app_relation_semantic_validation_physical_fk',
          'fx_app_relation_semantic_readiness_head_fk',
          'fx_app_relation_semantic_readiness_physical_fk',
          'fx_app_relation_semantic_readiness_origin_fk',
          'fx_app_relation_semantic_readiness_lineage_check',
          'fx_app_relation_semantic_readiness_receipt_check'
        )
        order by conname`,
    );
    expect(semanticConstraints.rows.map((row) => row.constraint_name))
      .toEqual([
        "fx_app_relation_semantic_readiness_head_fk",
        "fx_app_relation_semantic_readiness_lineage_check",
        "fx_app_relation_semantic_readiness_origin_fk",
        "fx_app_relation_semantic_readiness_physical_fk",
        "fx_app_relation_semantic_readiness_receipt_check",
        "fx_app_relation_semantic_validation_count_check",
        "fx_app_relation_semantic_validation_lineage_check",
        "fx_app_relation_semantic_validation_physical_fk",
        "fx_app_relation_semantic_validation_scope_fk",
      ]);
    for (const constraintName of [
      "fx_app_relation_semantic_validation_lineage_check",
      "fx_app_relation_semantic_readiness_lineage_check",
    ]) {
      const definition = semanticConstraints.rows.find((row) =>
        row.constraint_name === constraintName
      )?.definition ?? "";
      expect(definition).toContain(
        "origin_semantic_attempt_fence IS NOT NULL",
      );
      expect(definition).toContain(
        "origin_schema_version_id <> schema_version_id",
      );
      expect(definition).toContain(
        "physical_origin_schema_version_id <> schema_version_id",
      );
      expect(definition).not.toContain(
        "origin_schema_version_id = physical_origin_schema_version_id",
      );
      expect(definition).not.toContain(
        "origin_relation_ordinal = physical_origin_relation_ordinal",
      );
    }
    const semanticOriginFk = semanticConstraints.rows.find((row) =>
      row.constraint_name === "fx_app_relation_semantic_readiness_origin_fk"
    )?.definition ?? "";
    expect(semanticOriginFk).toContain(
      "FOREIGN KEY (scope_id, origin_schema_version_id, origin_relation_ordinal, origin_semantic_attempt_fence, origin_semantic_readiness_sha256)",
    );
    expect(semanticOriginFk).toContain(
      "REFERENCES fx_system_application_relation_semantic_readiness(scope_id, schema_version_id, relation_ordinal, attempt_fence, readiness_sha256)",
    );
    expect(semanticOriginFk).toContain("ON DELETE RESTRICT");
    const semanticHeadFk = semanticConstraints.rows.find((row) =>
      row.constraint_name === "fx_app_relation_semantic_readiness_head_fk"
    )?.definition ?? "";
    expect(semanticHeadFk).toContain(
      "FOREIGN KEY (scope_id, schema_version_id, relation_ordinal)",
    );
    expect(semanticHeadFk).toContain(
      "REFERENCES fx_system_application_relation_semantic_validation(scope_id, schema_version_id, relation_ordinal)",
    );
    expect(semanticHeadFk).toContain("ON DELETE RESTRICT");
    for (const constraintName of [
      "fx_app_relation_semantic_validation_physical_fk",
      "fx_app_relation_semantic_readiness_physical_fk",
    ]) {
      const definition = semanticConstraints.rows.find((row) =>
        row.constraint_name === constraintName
      )?.definition ?? "";
      expect(definition).toContain(
        "FOREIGN KEY (scope_id, edge_definition_id, physical_attempt_fence)",
      );
      expect(definition).toContain(
        "REFERENCES fx_system_edge_definition_readiness(scope_id, edge_definition_id, attempt_fence)",
      );
      expect(definition).toContain("ON DELETE RESTRICT");
    }
    const receiptCheck = semanticConstraints.rows.find((row) =>
      row.constraint_name === "fx_app_relation_semantic_readiness_receipt_check"
    )?.definition ?? "";
    expect(receiptCheck).toContain("receipt_codec_version = 1");
    expect(receiptCheck).toContain(
      "octet_length(receipt_bytes) >= 1",
    );
    expect(receiptCheck).toContain(
      "octet_length(receipt_bytes) <= 16384",
    );
    const semanticIndexes = await persistence.query<{ indexname: string }>(
      `select indexname
         from pg_indexes
        where tablename = 'fx_system_application_relation_semantic_readiness'
        order by indexname`,
    );
    expect(semanticIndexes.rows.map((row) => row.indexname)).toEqual([
      "fx_app_relation_semantic_readiness_digest_unique",
      "fx_app_relation_semantic_readiness_origin_unique",
      "fx_app_relation_semantic_readiness_pk",
    ]);
  });

  it("upgrades existing Task rows to the explicit Legacy definition generation", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-task-generation-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const journalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(journalPath, "utf8");
      const journal = JSON.parse(currentJournalText) as {
        entries?: Array<{ idx?: number }>;
      };
      if (!Array.isArray(journal.entries)) {
        throw new Error("Current Drizzle journal is missing its entries array.");
      }
      journal.entries = journal.entries.filter(entry =>
        entry.idx !== undefined && entry.idx < 63
      );
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await seedTaskComputeDeliverySchemaV1(previous, undefined, {
        legacySchema: true,
      });
      await writeFile(
        journalPath,
        migrationJournalBefore(currentJournalText, 64),
        "utf8",
      );
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const upgraded = await current.query<{
        run_generation: string;
        run_application_digest: Uint8Array | null;
        dispatch_generation: string;
        dispatch_application_digest: Uint8Array | null;
      }>(`
        select
          run.definition_generation as run_generation,
          run.application_task_runtime_target_sha256 as run_application_digest,
          dispatch.definition_generation as dispatch_generation,
          dispatch.application_task_runtime_target_sha256 as dispatch_application_digest
        from fx_system_durable_task_run_v1 as run
        join fx_system_durable_task_compute_dispatch_v1 as dispatch
          on dispatch.scope_id = run.scope_id and dispatch.run_id = run.run_id
      `);
      expect(upgraded.rows).toEqual([{
        run_generation: "legacy_definition_v1",
        run_application_digest: null,
        dispatch_generation: "legacy_definition_v1",
        dispatch_application_digest: null,
      }]);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set definition_generation = 'unknown'
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set task_definition_revision_id = null
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set definition_generation = 'application_v1',
            task_definition_revision_id = null,
            application_task_runtime_target_sha256 = null
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set definition_generation = 'application_v1',
            application_task_runtime_target_sha256 = decode(repeat('ab', 32), 'hex')
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set task_definition_revision_id = null
      `)).rejects.toThrow(/fx_task_compute_dispatch_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set definition_generation = 'application_v1',
            task_definition_revision_id = null,
            application_task_runtime_target_sha256 = null
      `)).rejects.toThrow(/fx_task_compute_dispatch_v1_identity_check/);
      await expect(current.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set definition_generation = 'application_v1',
            application_task_runtime_target_sha256 = decode(repeat('ab', 32), 'hex')
      `)).rejects.toThrow(/fx_task_compute_dispatch_v1_identity_check/);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("backfills pre-principal Application runs and enforces exact principal evidence", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-task-principal-upgrade-",
    ));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const journalPath = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const currentJournalText = await readFile(journalPath, "utf8");
      await writeFile(
        journalPath,
        migrationJournalBefore(currentJournalText, 66),
        "utf8",
      );
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      const seeded = await seedTaskComputeDeliverySchemaV1(previous, undefined, {
        principalSchema: false,
      });
      await previous.query("set session_replication_role = replica");
      try {
        await previous.query(`
          insert into fx_system_application_revision_schema_v1
            (scope_id, revision_id, deployment_id,
             application_schema_sha256, schema_version_id, schema_version,
             schema_manifest_sha256, schema_binding_sha256)
          values
            ($1, 'apprev_task_store_v1', $2,
             decode(repeat('61', 32), 'hex'), 'schema_task_store_v1', 1,
             decode(repeat('62', 32), 'hex'), decode(repeat('63', 32), 'hex'))
        `, [seeded.scopeId, seeded.deploymentId]);
      } finally {
        await previous.query("set session_replication_role = origin");
      }
      await previous.query(`
        update fx_system_durable_task_run_v1
        set definition_generation = 'application_v1',
            task_definition_revision_id = null,
            application_task_runtime_target_sha256 =
              decode(repeat('ab', 32), 'hex'),
            creation_authority_bytes = convert_to(
              '{"authority":{"runtimeTarget":{"revisionId":"apprev_task_store_v1"}}}',
              'UTF8'
            ),
            creation_authority_byte_length = octet_length(convert_to(
              '{"authority":{"runtimeTarget":{"revisionId":"apprev_task_store_v1"}}}',
              'UTF8'
            ))
      `);
      await previous.query(`
        update fx_system_durable_task_compute_dispatch_v1
        set definition_generation = 'application_v1',
            task_definition_revision_id = null,
            application_task_runtime_target_sha256 =
              decode(repeat('ab', 32), 'hex')
      `);

      await writeFile(journalPath, currentJournalText, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const upgraded = await current.query<{
        application_revision_id: string | null;
        generation: string;
        codec: string | null;
        digest: Uint8Array | null;
      }>(`
        select application_revision_id,
               execution_principal_generation as generation,
               execution_principal_codec as codec,
               execution_principal_sha256 as digest
        from fx_system_durable_task_run_v1
      `);
      expect(upgraded.rows).toEqual([{
        application_revision_id: "apprev_task_store_v1",
        generation: "legacy_absent",
        codec: null,
        digest: null,
      }]);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_generation = 'present_v1'
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
      await current.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_generation = 'present_v1',
            execution_principal_kind = 'authenticated_user',
            execution_principal_codec =
              'flarex.task-execution-principal-reference.v1',
            execution_principal_store =
              'flarex.task-execution-principal-object-store.v1',
            execution_principal_value_codec = 'flarex-value/v1',
            execution_principal_object_key =
              'durable-task-principal/v1/sha256/' || repeat('cd', 32),
            execution_principal_byte_length = 23,
            execution_principal_sha256 = decode(repeat('cd', 32), 'hex'),
            execution_principal_retention = 'run_lifetime'
      `);
      await expect(current.query(`
        update fx_system_durable_task_run_v1
        set execution_principal_object_key =
          'durable-task-principal/v1/sha256/' || repeat('ef', 32)
      `)).rejects.toThrow(/fx_task_run_v1_identity_check/);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("upgrades a pre-0060 legacy transaction session without changing its authority", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-aa-r6-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const copiedJournal = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const parsed: unknown = JSON.parse(await readFile(currentJournal, "utf8"));
      if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
        throw new Error("Current Drizzle journal is missing its entries array.");
      }
      await writeFile(copiedJournal, `${JSON.stringify({
        ...parsed,
        entries: parsed.entries.filter(entry =>
          isNonArrayRecord(entry) && typeof entry.idx === "number" &&
          entry.idx < 60
        ),
      }, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertSessionTestScope(previous);
      const sessionId = transactionSessionIdAt(60);
      await insertTransactionSessionFixture(
        previous,
        transactionSessionFixture(sessionId),
      );

      await copyFile(currentJournal, copiedJournal);
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      const row = await current.query<{
        generation: string;
        package_id: string | null;
        artifact_id: string | null;
        application_authority: string | null;
      }>(`
        select execution_authority_generation as generation,
               package_id,
               artifact_id,
               application_execution_authority_json::text as application_authority
          from fx_system_tx_session
         where session_id = $1
      `, [sessionId]);
      expect(row.rows).toEqual([{
        generation: "legacy_dynamic_worker_v1",
        package_id: "package_session_v1",
        artifact_id: `artifact_${"a".repeat(32)}`,
        application_authority: null,
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("upgrades a pre-0062 legacy action row without changing its authority", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-action-aa-r6-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const copiedJournal = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();
    const scopeId = "scope_00000000-0000-4000-8000-000000000062";

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const parsed: unknown = JSON.parse(await readFile(currentJournal, "utf8"));
      if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
        throw new Error("Current Drizzle journal is missing its entries array.");
      }
      await writeFile(copiedJournal, `${JSON.stringify({
        ...parsed,
        entries: parsed.entries.filter(entry =>
          isNonArrayRecord(entry) && typeof entry.idx === "number" &&
          entry.idx < 62
        ),
      }, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await previous.query(`alter table
        fx_system_application_action_invocation_v1
        drop constraint fx_action_invocation_v1_scope_fk`);
      await previous.query(`alter table
        fx_system_application_action_invocation_v1
        drop constraint fx_action_invocation_v1_revision_fk`);
      await previous.query(`
        insert into fx_system_application_action_invocation_v1 (
          scope_id, scope_epoch, storage_generation_fence, request_key,
          invocation_id, request_identity_sha256, action_binding_sha256,
          application_revision_id, candidate_sha256, action_function_path,
          execution_identity_sha256, compatibility_date, host_policy_sha256,
          argument_store_identity, argument_codec_identity,
          argument_object_key, argument_byte_length, argument_sha256,
          lifecycle
        ) values (
          $1, 'epoch-action-62', 1, 'legacy-action-request-62',
          '00000000-0000-4000-8000-000000000062', decode(repeat('11', 32), 'hex'),
          decode(repeat('22', 32), 'hex'), 'legacy-action-revision-62',
          decode(repeat('33', 32), 'hex'), 'actions:legacy',
          decode(repeat('44', 32), 'hex'), '2026-08-13',
          decode(repeat('55', 32), 'hex'),
          'flarex.r2/execution-evidence-body/v1',
          'flarex.codec/canonical-flarex-value/v1',
          'execution-evidence-body/v1/action_arguments/legacy-62', 1,
          decode(repeat('66', 32), 'hex'), 'admitted'
        )
      `, [scopeId]);

      await writeFile(
        copiedJournal,
        migrationJournalBefore(await readFile(currentJournal, "utf8"), 64),
        "utf8",
      );
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      const row = await current.query<{
        generation: string;
        revision_id: string | null;
        candidate_sha256: string | null;
        action_binding_sha256: string | null;
        application_authority: string | null;
      }>(`
        select execution_authority_generation as generation,
               application_revision_id as revision_id,
               encode(candidate_sha256, 'hex') as candidate_sha256,
               encode(action_binding_sha256, 'hex') as action_binding_sha256,
               application_execution_authority_json::text as application_authority
          from fx_system_application_action_invocation_v1
         where request_key = 'legacy-action-request-62'
      `);
      expect(row.rows).toEqual([{
        generation: "legacy_candidate_bound_v1",
        revision_id: "legacy-action-revision-62",
        candidate_sha256: "33".repeat(32),
        action_binding_sha256: "22".repeat(32),
        application_authority: null,
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

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
      expect(recoveredReceipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
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
      expect(recovered.rows).toEqual([{ count: "6" }]);
      const recoveredReceipts = await recoveredPersistence.query<{
        count: string;
      }>(`select count(*)::text as count from drizzle.__drizzle_migrations`);
      expect(recoveredReceipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
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
      expect(recoveredReceipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
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

      await writeFile(
        copiedJournalPath,
        migrationJournalBefore(currentJournalText, 64),
        "utf8",
      );
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
      expect(after.rows).toEqual([{ count: "9" }]);
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
        check_count: "31",
        foreign_key_count: "17",
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

  it("adds isolated V2 verifier progress storage without reinterpreting candidate authority", async () => {
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
      await expect(previous.query(
        `select count(*) from fx_system_declarative_v2_verifier_attempt_v2`,
      )).rejects.toThrow();

      await writeFile(
        copiedJournalPath,
        migrationJournalBefore(currentJournalText, 64),
        "utf8",
      );
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
      const preserved = await current.query<{ candidate_count: string }>(`
        select
          (
            select count(*)::text
            from fx_system_declarative_v2_candidate
            where scope_id = 'scope_dv2_v1_preserved'
          ) as candidate_count
      `);
      expect(preserved.rows).toEqual([{
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

      await writeFile(
        copiedJournalPath,
        migrationJournalBefore(currentJournalText, 64),
        "utf8",
      );
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
      expect(currentReceipts.rows).toEqual([{
        count: "64",
      }]);
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
      expect(receipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
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
      expect(receipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
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
      expect(receipts.rows).toEqual([{
        count: await currentMigrationReceiptCount(),
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("replaces empty dormant V1 verdict ownership atomically and replays 0043", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-fsv04-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const migrationPath = resolve(
      migrationsFolder,
      "0043_clever_grim_reaper.sql",
    );
    const db = new PGlite();
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const journalText = await readFile(currentJournalPath, "utf8");
      const parsed: unknown = JSON.parse(journalText);
      if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      await writeFile(copiedJournalPath, `${JSON.stringify({
        ...parsed,
        entries: parsed.entries.filter(entry =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" && entry.idx < 43
        ),
      }, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      const oldForeignKey = await previous.query<{ target: string }>(`
        select confrelid::regclass::text as target
        from pg_constraint
        where conname = 'fx_dv2_verdict_attempt_fk'
      `);
      expect(oldForeignKey.rows[0]?.target).toContain(
        "fx_system_declarative_v2_verifier_attempt",
      );
      await writeFile(
        copiedJournalPath,
        migrationJournalBefore(journalText, 64),
        "utf8",
      );
      const realMigration = await readFile(migrationPath, "utf8");
      await writeFile(
        migrationPath,
        `${realMigration}\n--> statement-breakpoint\nselect * from fx_fsv04_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow(
        /fx_fsv04_deliberate_missing_table/,
      );
      const afterRollback = await failing.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_declarative_v2_verdict'
          and column_name = 'revision_id'
      `);
      expect(afterRollback.rows).toEqual([{ count: "0" }]);
      await writeFile(migrationPath, realMigration, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const ownership = await current.query<{
        revision_column: string;
        attempt_target: string;
        revision_target: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'fx_system_declarative_v2_verdict'
              and column_name = 'revision_id') as revision_column,
          (select confrelid::regclass::text from pg_constraint
            where conname = 'fx_dv2_verdict_attempt_fk') as attempt_target,
          (select confrelid::regclass::text from pg_constraint
            where conname = 'fx_dv2_verdict_revision_fk') as revision_target,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(ownership.rows).toEqual([{
        revision_column: "1",
        attempt_target: "fx_system_declarative_v2_verifier_attempt_v2",
        revision_target: "fx_system_application_revision_v1",
        receipts: "64",
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("fails 0043 before replacing non-empty dormant V1 verdict ownership", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-fsv04-legacy-"));
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
      const journalText = await readFile(currentJournalPath, "utf8");
      const parsed: unknown = JSON.parse(journalText);
      if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      await writeFile(copiedJournalPath, `${JSON.stringify({
        ...parsed,
        entries: parsed.entries.filter(entry =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" && entry.idx < 43
        ),
      }, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await previous.query(`alter table fx_system_declarative_v2_verdict
        drop constraint fx_dv2_verdict_attempt_fk`);
      await previous.query(`alter table fx_system_declarative_v2_verdict
        drop constraint fx_dv2_verdict_candidate_fk`);
      await previous.query(`
        insert into fx_system_declarative_v2_verdict
          (scope_id, attempt_sha256, candidate_sha256, verdict_sha256,
           verdict, failure_code, frame_codec_version, frame_byte_length,
           frame_sha256, frame_bytes)
        values
          ('scope_legacy_fsv04', decode(repeat('11', 32), 'hex'),
           decode(repeat('22', 32), 'hex'), decode(repeat('33', 32), 'hex'),
           'ready', null, 1, 1, decode(repeat('33', 32), 'hex'),
           decode('00', 'hex'))
      `);
      await writeFile(copiedJournalPath, journalText, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await expect(current.migrate()).rejects.toThrow(
        /migration 0043 cannot replace legacy declarative V2 verdict rows/,
      );
      const unchanged = await current.query<{
        rows: string;
        revision_column: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from fx_system_declarative_v2_verdict) as rows,
          (select count(*)::text from information_schema.columns
            where table_schema = current_schema()
              and table_name = 'fx_system_declarative_v2_verdict'
              and column_name = 'revision_id') as revision_column,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(unchanged.rows).toEqual([{
        rows: "1",
        revision_column: "0",
        receipts: "43",
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("upgrades 0049 atomically and replays the unique-set build authority", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-c08-b1a-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const copiedMigrationPath = resolve(
      migrationsFolder,
      "0049_friendly_runaways.sql",
    );
    const db = new PGlite();
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const journalText = await readFile(currentJournalPath, "utf8");
      const parsed: unknown = JSON.parse(journalText);
      if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
        throw new Error("Expected a Drizzle migration journal.");
      }
      await writeFile(copiedJournalPath, `${JSON.stringify({
        ...parsed,
        entries: parsed.entries.filter((entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < 49
        ),
      }, null, 2)}\n`, "utf8");
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      const absent = await previous.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_control_schema_unique_constraint_set',
            'fx_system_unique_constraint_set_build'
          )
      `);
      expect(absent.rows).toEqual([{ count: "0" }]);

      await writeFile(copiedJournalPath, journalText, "utf8");
      const migrationText = await readFile(copiedMigrationPath, "utf8");
      await writeFile(
        copiedMigrationPath,
        `${migrationText}\n--> statement-breakpoint\nselect * from fx_c08_b1a_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow(
        /fx_c08_b1a_deliberate_missing_table/,
      );
      const rolledBack = await failing.query<{
        table_count: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.tables
            where table_schema = current_schema()
              and table_name in (
                'fx_control_schema_unique_constraint_set',
                'fx_system_unique_constraint_set_build'
              )) as table_count,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(rolledBack.rows).toEqual([{
        table_count: "0",
        receipts: "49",
      }]);

      await writeFile(copiedMigrationPath, migrationText, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const installed = await current.query<{
        table_count: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.tables
            where table_schema = current_schema()
              and table_name in (
                'fx_control_schema_unique_constraint_set',
                'fx_system_unique_constraint_set_build'
              )) as table_count,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(installed.rows).toEqual([{
        table_count: "2",
        receipts: await currentMigrationReceiptCount(),
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("installs 0065 atomically without changing existing scheduler state", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-o11-f1-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const copiedMigrationPath = resolve(
      migrationsFolder,
      "0065_omniscient_prism.sql",
    );
    const db = new PGlite();
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const journalText = await readFile(currentJournalPath, "utf8");
      await writeFile(
        copiedJournalPath,
        migrationJournalBefore(journalText, 65),
        "utf8",
      );
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await previous.query(`
        update fx_system_point_mutation_redelivery_scheduler
        set run_fence = 7
      `);

      await writeFile(copiedJournalPath, journalText, "utf8");
      const migrationText = await readFile(copiedMigrationPath, "utf8");
      await writeFile(
        copiedMigrationPath,
        `${migrationText}\n--> statement-breakpoint\nselect * from fx_o11_f1_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow(
        /fx_o11_f1_deliberate_missing_table/,
      );
      const rolledBack = await failing.query<{
        table_count: string;
        point_fence: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.tables
            where table_schema = current_schema()
              and table_name = 'fx_system_retained_history_scheduler')
            as table_count,
          (select run_fence::text
            from fx_system_point_mutation_redelivery_scheduler) as point_fence,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(rolledBack.rows).toEqual([{
        table_count: "0",
        point_fence: "7",
        receipts: "65",
      }]);

      await writeFile(copiedMigrationPath, migrationText, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await current.migrate();
      await current.migrate();
      const installed = await current.query<{
        scheduler_key: string;
        scheduler_state: string;
        run_fence: string;
        checkpoint_sequence: string;
        point_fence: string;
        receipts: string;
      }>(`
        select scheduler_key, scheduler_state, run_fence::text,
          checkpoint_sequence::text,
          (select run_fence::text
            from fx_system_point_mutation_redelivery_scheduler) as point_fence,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
        from fx_system_retained_history_scheduler
      `);
      expect(installed.rows).toEqual([{
        scheduler_key: "retained_history_maintenance_v1",
        scheduler_state: "idle",
        run_fence: "0",
        checkpoint_sequence: "0",
        point_fence: "7",
        receipts: await currentMigrationReceiptCount(),
      }]);
      await expect(current.query(`
        insert into fx_system_retained_history_scheduler
          (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
        values ('wrong_key', 'idle', 0, 0)
      `)).rejects.toThrow();
      const unchanged = await current.query<{ count: string }>(`
        select count(*)::text as count
        from fx_system_retained_history_scheduler
      `);
      expect(unchanged.rows).toEqual([{ count: "1" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 30_000);
});

function migrationJournalBefore(
  journalText: string,
  exclusiveIndex: number,
): string {
  const parsed: unknown = JSON.parse(journalText);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  return `${JSON.stringify({
    ...parsed,
    entries: parsed.entries.filter(entry =>
      isNonArrayRecord(entry) &&
      typeof entry.idx === "number" &&
      entry.idx < exclusiveIndex
    ),
  }, null, 2)}\n`;
}

async function currentMigrationReceiptCount(): Promise<string> {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const journalText = await readFile(
    resolve(packageRoot, "drizzle/meta/_journal.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(journalText);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  return String(parsed.entries.length);
}
