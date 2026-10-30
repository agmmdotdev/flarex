import { Cause, Effect, Schema } from "effect";
import { CorePersistenceError } from "../../core/contracts";
import type { CoreSqlDriver } from "./driver";

const namespaceSchema = Schema.NonEmptyString.check(Schema.makeFilter(value =>
  /^[a-z][a-z0-9_]{0,62}$/.test(value)
    && value !== "public" && !value.startsWith("pg_") && value !== "information_schema"
    ? undefined : "Expected an explicitly owned core persistence namespace",
));
const decodeNamespace = Schema.decodeUnknownEffect(namespaceSchema);
const decodeMarker = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array })));
const isDuplicateNamespace = Schema.is(Schema.Struct({ code: Schema.Literals(["42P06"]) }));
const formatBytes = new TextEncoder().encode("flarex-core-pg/db914cf06/1");

export interface CorePersistenceTarget {
  readonly namespace: string;
}

export interface CorePersistenceTargetData {
  readonly namespace: string;
  readonly driver: CoreSqlDriver;
}

const targets = new WeakMap<CorePersistenceTarget, CorePersistenceTargetData>();

/** Only the installer/verified loader can issue a target accepted by the adapter. */
export function inspectCorePersistenceTarget(target: CorePersistenceTarget): CorePersistenceTargetData | undefined {
  return targets.get(target);
}

function issueTarget(driver: CoreSqlDriver, namespace: string): CorePersistenceTarget {
  const target = Object.freeze({ namespace });
  targets.set(target, Object.freeze({ namespace, driver }));
  return target;
}

export function coreTableName(namespace: string, table: string): string {
  // Namespace is decoded before issuance; table is a code-defined table name.
  return `"${namespace}"."${table}"`;
}

/**
 * Explicit physical maintenance, translated from the pinned PostgreSQL adapter.
 * CREATE SCHEMA deliberately refuses existing/legacy namespaces. All installation
 * statements and its small format anchor are atomic; a failed install can retry.
 */
export const installCorePersistence = Effect.fn("CorePersistence.install")(
  function* (driver: CoreSqlDriver, namespaceInput = "flarex_core") {
    const namespace = yield* decodeNamespace(namespaceInput).pipe(Effect.mapError(cause =>
      new CorePersistenceError({ reason: "invalidTarget", cause }),
    ));
    const table = (name: string) => coreTableName(namespace, name);
    const statements = [
      `CREATE SCHEMA "${namespace}"`,
      `CREATE TABLE ${table("documents")} (
        instance_name TEXT NOT NULL, id BYTEA NOT NULL, ts BIGINT NOT NULL,
        table_id BYTEA NOT NULL, json_value BYTEA NOT NULL,
        deleted BOOLEAN DEFAULT false, prev_ts BIGINT,
        PRIMARY KEY (instance_name, ts, table_id, id))`,
      `CREATE INDEX documents_by_table_and_id ON ${table("documents")} (instance_name, table_id, id, ts)`,
      `CREATE INDEX documents_by_table_ts_and_id ON ${table("documents")} (instance_name, table_id, ts, id)`,
      `CREATE TABLE ${table("indexes")} (
        instance_name TEXT NOT NULL, index_id BYTEA NOT NULL, ts BIGINT NOT NULL,
        key_prefix BYTEA NOT NULL, key_suffix BYTEA, key_sha256 BYTEA NOT NULL,
        deleted BOOLEAN, table_id BYTEA, document_id BYTEA,
        PRIMARY KEY (instance_name, index_id, key_sha256, ts))`,
      `CREATE INDEX indexes_by_index_id_key_prefix_key_sha256 ON ${table("indexes")}
        (instance_name, index_id, key_prefix, key_sha256)`,
      `CREATE TABLE ${table("leases")} (instance_name TEXT PRIMARY KEY, ts BIGINT NOT NULL)`,
      `CREATE TABLE ${table("read_only")} (instance_name TEXT PRIMARY KEY)`,
      `CREATE TABLE ${table("persistence_globals")} (
        instance_name TEXT NOT NULL, key TEXT NOT NULL, json_value BYTEA NOT NULL,
        PRIMARY KEY (instance_name, key))`,
    ];
    yield* driver.transaction(connection => Effect.gen(function* () {
      for (const statement of statements) yield* connection.query(statement);
      // Empty instance is reserved for the physical-format anchor. Logical
      // persistence instances are nonempty and cannot address it through a port.
      yield* connection.query(`INSERT INTO ${table("persistence_globals")}
        (instance_name, key, json_value) VALUES ('', 'storage_format', $1)`, [formatBytes]);
    }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
      error.reason === "unavailable" && isDuplicateNamespace(error.cause)
        ? new CorePersistenceError({ reason: "invalidTarget", cause: error.cause }) : error,
    )))));
    return issueTarget(driver, namespace);
  },
);

/** Runtime loading performs no DDL and cannot adopt an old five-name format. */
export const loadCorePersistenceTarget = Effect.fn("CorePersistence.loadTarget")(
  function* (driver: CoreSqlDriver, namespaceInput = "flarex_core") {
    const namespace = yield* decodeNamespace(namespaceInput).pipe(Effect.mapError(cause =>
      new CorePersistenceError({ reason: "invalidTarget", cause }),
    ));
    const rows = yield* driver.query(`SELECT json_value FROM ${coreTableName(namespace, "persistence_globals")}
      WHERE instance_name = '' AND key = 'storage_format'`);
    const markers = yield* decodeMarker(rows).pipe(Effect.mapError(cause =>
      new CorePersistenceError({ reason: "invalidTarget", cause }),
    ));
    const marker = markers[0]?.json_value;
    if (markers.length !== 1 || marker === undefined || marker.length !== formatBytes.length
      || !marker.every((value, index) => value === formatBytes[index])) {
      return yield* Effect.fail(new CorePersistenceError({ reason: "invalidTarget" }));
    }
    return issueTarget(driver, namespace);
  },
);
