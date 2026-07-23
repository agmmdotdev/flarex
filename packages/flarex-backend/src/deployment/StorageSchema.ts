type DeploymentSqlBinding = string | number | null;

export interface DeploymentSchemaSql {
  exec(statement: string, ...bindings: DeploymentSqlBinding[]): unknown;
}

export function initializeDeploymentStorage(sql: DeploymentSchemaSql): void {
  sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tables (
        table_id INTEGER PRIMARY KEY,
        table_name TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        schema_json TEXT,
        partition_rule_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexes (
        index_id INTEGER PRIMARY KEY,
        table_id INTEGER NOT NULL,
        index_name TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        state TEXT NOT NULL,
        UNIQUE(table_id, index_name)
      );
      CREATE TABLE IF NOT EXISTS functions (
        function_path TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        visibility TEXT NOT NULL,
        args_json TEXT,
        returns_json TEXT,
        route_json TEXT,
        partition_json TEXT,
        position_json TEXT
      );
      CREATE TABLE IF NOT EXISTS pushes (
        push_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        source_package_json TEXT NOT NULL,
        schema_json TEXT,
        functions_json TEXT,
        codegen_analysis_json TEXT,
        error TEXT,
        diagnostics_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_artifact_upload_attempts_v2 (
        upload_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL CHECK (generation > 0),
        mutation_fence INTEGER NOT NULL CHECK (mutation_fence >= 0),
        state TEXT NOT NULL CHECK (state IN ('open', 'closing', 'finalized', 'abandoned')),
        next_module_ordinal INTEGER NOT NULL CHECK (next_module_ordinal >= 0),
        last_module_path TEXT,
        current_module_json TEXT,
        module_frontier_json TEXT NOT NULL,
        counters_json TEXT NOT NULL,
        ceilings_json TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        pending_command_json TEXT,
        last_command_id TEXT NOT NULL,
        last_command_digest TEXT NOT NULL CHECK (length(last_command_digest) = 64),
        last_receipt_json TEXT NOT NULL,
        completed_root_digest TEXT CHECK (
          completed_root_digest IS NULL OR length(completed_root_digest) = 64
        ),
        completed_selector_digest TEXT CHECK (
          completed_selector_digest IS NULL OR length(completed_selector_digest) = 64
        ),
        CHECK (last_module_path IS NULL OR length(last_module_path) > 0),
        CHECK (
          (state = 'finalized' AND completed_root_digest IS NOT NULL AND completed_selector_digest IS NOT NULL)
          OR
          (state <> 'finalized' AND completed_selector_digest IS NULL)
        )
      );
      CREATE TABLE IF NOT EXISTS semantic_artifact_upload_attempts_v1 (
        semantic_upload_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL CHECK (generation > 0),
        mutation_fence INTEGER NOT NULL CHECK (mutation_fence >= 0),
        state TEXT NOT NULL CHECK (state IN ('open', 'closing', 'finalized', 'abandoned')),
        attempt_frame_hex TEXT NOT NULL CHECK (
          length(attempt_frame_hex) > 0 AND length(attempt_frame_hex) % 2 = 0
        ),
        attempt_sha256 TEXT NOT NULL CHECK (length(attempt_sha256) = 64),
        project_id TEXT NOT NULL CHECK (length(project_id) > 0),
        deployment_id TEXT NOT NULL CHECK (length(deployment_id) > 0),
        deployment_created_at TEXT NOT NULL CHECK (length(deployment_created_at) > 0),
        source_upload_id TEXT NOT NULL,
        source_generation INTEGER NOT NULL CHECK (source_generation > 0),
        source_mutation_fence INTEGER NOT NULL CHECK (source_mutation_fence >= 0),
        source_root_sha256 TEXT NOT NULL CHECK (length(source_root_sha256) = 64),
        source_selector_sha256 TEXT NOT NULL CHECK (length(source_selector_sha256) = 64),
        next_block_ordinal INTEGER NOT NULL CHECK (next_block_ordinal >= 0),
        stream_byte_length INTEGER NOT NULL CHECK (stream_byte_length >= 0),
        line_feed_count INTEGER NOT NULL CHECK (line_feed_count >= 0),
        last_block_digest TEXT CHECK (
          last_block_digest IS NULL OR length(last_block_digest) = 64
        ),
        last_block_frame_byte_length INTEGER CHECK (
          last_block_frame_byte_length IS NULL OR last_block_frame_byte_length > 0
        ),
        tree_frontier_json TEXT NOT NULL,
        ceilings_json TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        pending_command_json TEXT,
        last_command_id TEXT NOT NULL,
        last_command_digest TEXT NOT NULL CHECK (length(last_command_digest) = 64),
        last_receipt_json TEXT NOT NULL,
        completed_root_digest TEXT CHECK (
          completed_root_digest IS NULL OR length(completed_root_digest) = 64
        ),
        completed_selector_digest TEXT CHECK (
          completed_selector_digest IS NULL OR length(completed_selector_digest) = 64
        ),
        FOREIGN KEY (source_upload_id)
          REFERENCES source_artifact_upload_attempts_v2(upload_id)
          ON DELETE RESTRICT,
        CHECK (
          (state = 'finalized' AND completed_root_digest IS NOT NULL
            AND completed_selector_digest IS NOT NULL AND pending_command_json IS NULL)
          OR
          (state <> 'finalized' AND completed_root_digest IS NULL
            AND completed_selector_digest IS NULL)
        ),
        CHECK (
          (state = 'closing' AND pending_command_json IS NOT NULL)
          OR
          (state = 'open')
          OR
          (state IN ('finalized', 'abandoned') AND pending_command_json IS NULL)
        )
      );
    `);
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN position_json TEXT");
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN route_json TEXT");
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN partition_json TEXT");
  ensureColumn(sql, "ALTER TABLE pushes ADD COLUMN codegen_analysis_json TEXT");
  ensureColumn(sql, "ALTER TABLE pushes ADD COLUMN diagnostics_json TEXT");
  sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", "schema_version", "0");
  sql.exec(
    "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
    "source_artifact_upload_v2_schema_version",
    "1",
  );
  sql.exec(
    "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
    "semantic_artifact_upload_v1_schema_version",
    "1",
  );
}

function ensureColumn(sql: DeploymentSchemaSql, statement: string): void {
  try {
    sql.exec(statement);
  } catch {
    // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
  }
}
