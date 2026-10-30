import { Effect } from "effect";
import type { CoreSqlDriver } from "../../src/database/corePersistence/driver";

/**
 * Frozen physical fixture from c5541e7106550679c209d9f6481791b99d9e9e9f,
 * src/database/corePersistence/target.ts. This is an old-format test input,
 * not another current installer or a recreation of the old database engine.
 */
export const installC554PhysicalFixture = Effect.fn("PhysicalFixture.installC554")(function* (
  driver: CoreSqlDriver, namespace: string,
) {
  const table = (name: string) => `"${namespace}"."${name}"`;
  const statements = [
    `CREATE SCHEMA "${namespace}"`,
    `CREATE TABLE ${table("documents")} (instance_name TEXT NOT NULL,id BYTEA NOT NULL,ts BIGINT NOT NULL,
      table_id BYTEA NOT NULL,json_value BYTEA NOT NULL,deleted BOOLEAN DEFAULT false,prev_ts BIGINT,
      PRIMARY KEY(instance_name,ts,table_id,id))`,
    `CREATE INDEX documents_by_table_and_id ON ${table("documents")} (instance_name,table_id,id,ts)`,
    `CREATE INDEX documents_by_table_ts_and_id ON ${table("documents")} (instance_name,table_id,ts,id)`,
    `CREATE TABLE ${table("indexes")} (instance_name TEXT NOT NULL,index_id BYTEA NOT NULL,ts BIGINT NOT NULL,
      key_prefix BYTEA NOT NULL,key_suffix BYTEA,key_sha256 BYTEA NOT NULL,deleted BOOLEAN,table_id BYTEA,document_id BYTEA,
      PRIMARY KEY(instance_name,index_id,key_sha256,ts))`,
    `CREATE INDEX indexes_by_index_id_key_prefix_key_sha256 ON ${table("indexes")} (instance_name,index_id,key_prefix,key_sha256)`,
    `CREATE TABLE ${table("leases")} (instance_name TEXT PRIMARY KEY,ts BIGINT NOT NULL)`,
    `CREATE TABLE ${table("read_only")} (instance_name TEXT PRIMARY KEY)`,
    `CREATE TABLE ${table("persistence_globals")} (instance_name TEXT NOT NULL,key TEXT NOT NULL,json_value BYTEA NOT NULL,
      PRIMARY KEY(instance_name,key))`,
  ];
  yield* driver.transaction(connection => Effect.gen(function* () {
    for (const statement of statements) yield* connection.query(statement);
    yield* connection.query(`INSERT INTO ${table("persistence_globals")} VALUES ('','storage_format',$1)`,
      [new TextEncoder().encode("flarex-core-pg/db914cf06/1")]);
  }));
});
