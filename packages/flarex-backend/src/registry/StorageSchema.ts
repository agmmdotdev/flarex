type RegistrySqlBinding = string | number | null;

export interface RegistrySchemaSql {
  exec(statement: string, ...bindings: RegistrySqlBinding[]): unknown;
}

export function initializeRegistryStorage(sql: RegistrySchemaSql): void {
  sql.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        deployment_id TEXT PRIMARY KEY,
        slug TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        schema_version INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deployments_by_slug ON deployments(slug);
    `);
}
