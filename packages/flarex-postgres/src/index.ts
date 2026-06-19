export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface FlarexSqlClient {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface FlarexPersistenceTx extends FlarexSqlClient {}

export interface FlarexPersistence extends FlarexSqlClient {
  check(): Promise<FlarexPersistenceCheck>;
  migrate(): Promise<FlarexMigrationResult>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export interface FlarexMigration {
  version: number;
  name: string;
  sql: string;
}

export interface FlarexMigrationResult {
  applied: FlarexMigration[];
}

export const FLAREX_MIGRATIONS: readonly FlarexMigration[] = [
  {
    version: 1,
    name: "convex_style_multitenant_persistence",
    sql: `
      create table if not exists deployments (
        deployment_id text primary key,
        project_id text not null,
        active_package_id text,
        active_schema_version bigint not null default 0,
        created_at timestamptz not null default now()
      );

      create table if not exists documents (
        deployment_id text not null,
        id bytea not null,
        ts bigint not null,
        table_id bytea not null,
        json_value bytea not null,
        deleted boolean not null default false,
        prev_ts bigint,
        primary key (deployment_id, ts, table_id, id)
      );

      create index if not exists documents_by_table_and_id
        on documents (deployment_id, table_id, id, ts);

      create index if not exists documents_by_table_ts_and_id
        on documents (deployment_id, table_id, ts, id);

      create table if not exists indexes (
        deployment_id text not null,
        index_id bytea not null,
        ts bigint not null,
        key_prefix bytea not null,
        key_suffix bytea,
        key_sha256 bytea not null,
        deleted boolean,
        table_id bytea,
        document_id bytea,
        primary key (deployment_id, index_id, key_sha256, ts)
      );

      create index if not exists indexes_by_index_id_key_prefix_key_sha256
        on indexes (deployment_id, index_id, key_prefix, key_sha256);

      create table if not exists leases (
        deployment_id text primary key,
        ts bigint not null
      );

      create table if not exists read_only (
        deployment_id text primary key
      );

      create table if not exists persistence_globals (
        deployment_id text not null,
        key text not null,
        json_value bytea not null,
        primary key (deployment_id, key)
      );

      create table if not exists commits (
        deployment_id text not null,
        ts bigint not null,
        source text not null,
        write_summary jsonb not null,
        committed_at timestamptz not null default now(),
        primary key (deployment_id, ts)
      );

      create table if not exists outbox (
        deployment_id text not null,
        ts bigint not null,
        sequence bigint not null,
        event jsonb not null,
        delivered_at timestamptz,
        primary key (deployment_id, ts, sequence)
      );
    `,
  },
];

export async function runMigrations(
  client: FlarexSqlClient,
  migrations: readonly FlarexMigration[] = FLAREX_MIGRATIONS,
): Promise<FlarexMigrationResult> {
  await client.exec(`
    create table if not exists flarex_schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const applied: FlarexMigration[] = [];

  for (const migration of migrations) {
    const existing = await client.query<{ version: number }>(
      "select version from flarex_schema_migrations where version = $1",
      [migration.version],
    );

    if (existing.rows.length > 0) {
      continue;
    }

    await client.exec(migration.sql);
    await client.query(
      "insert into flarex_schema_migrations (version, name) values ($1, $2)",
      [migration.version, migration.name],
    );
    applied.push(migration);
  }

  return { applied };
}
