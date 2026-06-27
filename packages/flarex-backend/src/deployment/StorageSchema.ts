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
    `);
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN position_json TEXT");
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN route_json TEXT");
  ensureColumn(sql, "ALTER TABLE functions ADD COLUMN partition_json TEXT");
  ensureColumn(sql, "ALTER TABLE pushes ADD COLUMN codegen_analysis_json TEXT");
  ensureColumn(sql, "ALTER TABLE pushes ADD COLUMN diagnostics_json TEXT");
  sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", "schema_version", "0");
}

function ensureColumn(sql: DeploymentSchemaSql, statement: string): void {
  try {
    sql.exec(statement);
  } catch {
    // Durable Object SQLite has no IF NOT EXISTS for ADD COLUMN.
  }
}
