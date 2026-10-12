import { createHash } from "node:crypto";
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  type ExtractTablesWithRelations,
  type RelationalSchemaConfig,
  fillPlaceholders,
  type Query,
} from "drizzle-orm";
import { PgDatabase, PgDialect, PgPreparedQuery, PgSession, type PgQueryResultHKT, type PreparedQueryConfig } from "drizzle-orm/pg-core";
import type { SelectedFieldsOrdered } from "drizzle-orm/pg-core/query-builders/select.types";
import { QueryPromise } from "drizzle-orm/query-promise";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  NodePgSession,
  NodePgTransaction,
} from "drizzle-orm/node-postgres/session";
import type { Client, PoolClient } from "pg";

type NativeQueryMetadata = Parameters<PgSession["prepareQuery"]>[5];
type NativeCacheConfig = Parameters<PgSession["prepareQuery"]>[6];
/** Source-private fixed statement description. It carries no client, session,
 * bindings or authority verdict; every command binds the actual checkout. */
export interface NativePhysicalCommand<Value> {
  readonly statement: Query;
  readonly orderedFields: SelectedFieldsOrdered | undefined;
  readonly statementName: string | undefined;
  readonly mapResult: (rows: unknown[][]) => Value;
}
export type NativePhysicalCommandSession = Pick<PgSession, "prepareQuery">;

export function executeNativePhysicalCommand<Value>(session: NativePhysicalCommandSession,
  command: NativePhysicalCommand<Value>, bindings: Record<string, unknown>): Promise<Value> {
  return session.prepareQuery<PreparedQueryConfig & { execute: Value }>(command.statement,
    command.orderedFields, command.statementName, true, command.mapResult).execute(bindings);
}
type NativeReadPreparation = Readonly<{
  query: Query;
  fields: SelectedFieldsOrdered | undefined;
  joinsNotNullableMap: Record<string, boolean> | undefined;
  queryMetadata: NativeQueryMetadata;
  cacheConfig: NativeCacheConfig;
  isResponseInArrayMode: boolean;
  statementName?: string;
}>;

/** PgSelectBase._prepare writes this native runtime property after preparation.
 * The installed declaration omits it; this subclass names that exact contract. */
class NativeReadCapture<Config extends PreparedQueryConfig> extends PgPreparedQuery<Config> {
  declare joinsNotNullableMap: Record<string, boolean> | undefined;
  constructor(query: Query, readonly fields: SelectedFieldsOrdered | undefined,
    readonly capturedMetadata: NativeQueryMetadata, readonly capturedCacheConfig: NativeCacheConfig,
    readonly isResponseInArrayMode: boolean) {
    super(query, undefined, capturedMetadata, capturedCacheConfig);
  }
  override execute(): Promise<Config["execute"]> {
    throw new Error("Native read compilation cannot execute a database statement");
  }
  preparation(): NativeReadPreparation {
    if (this.authToken !== undefined) throw new Error("Static metadata reads cannot retain an authentication token");
    return Object.freeze({ query: this.getQuery(), fields: this.fields,
      joinsNotNullableMap: this.joinsNotNullableMap, queryMetadata: this.capturedMetadata,
      cacheConfig: this.capturedCacheConfig, isResponseInArrayMode: this.isResponseInArrayMode });
  }
}

/** Compilation has no client or transport. All selection ordering, SQL rendering
 * and join metadata are produced by the installed native select preparation. */
class NativeReadCompilationSession extends PgSession {
  captured: NativeReadCapture<PreparedQueryConfig> | undefined;
  override prepareQuery<Config extends PreparedQueryConfig = PreparedQueryConfig>(
    query: Query, fields: SelectedFieldsOrdered | undefined, _name: string | undefined,
    isResponseInArrayMode: boolean, customResultMapper?: (rows: unknown[][]) => Config["execute"],
    queryMetadata?: NativeQueryMetadata, cacheConfig?: NativeCacheConfig,
  ): PgPreparedQuery<Config> {
    if (customResultMapper !== undefined) throw new Error("Static metadata reads require the native row mapper");
    const captured = new NativeReadCapture<Config>(query, fields, queryMetadata, cacheConfig, isResponseInArrayMode);
    this.captured = captured;
    return captured;
  }
  override transaction<Value>(): Promise<Value> {
    throw new Error("Native read compilation cannot open a transaction");
  }
}

class BoundNativeRead<Value> extends QueryPromise<Value> {
  private boundQuery: PgPreparedQuery<PreparedQueryConfig & { execute: Value }> | undefined;
  constructor(private readonly preparation: () => NativeReadPreparation, private readonly database: FlarexMetadataDatabase,
    private readonly bindings: Record<string, unknown>, raw: boolean) {
    super();
    // Native db.execute prepares eagerly; preserve construction throws before
    // the domain's Promise-failure boundary, while transport stays lazy.
    if (raw) this.boundQuery = this.prepareExecution();
  }
  toSQL() {
    const { query } = this.preparation();
    return { sql: query.sql, params: fillPlaceholders(query.params, this.bindings) };
  }
  getQuery() {
    const { query } = this.preparation();
    return { ...query, params: fillPlaceholders(query.params, this.bindings) };
  }
  private prepareExecution() {
    const prepared = this.preparation();
    // Same assignment as native PgSelectBase._prepare; both native drivers use
    // this map to collapse nullable nested selections, without a custom mapper.
    const query: PgPreparedQuery<PreparedQueryConfig & { execute: Value }> & Pick<NativeReadPreparation, "joinsNotNullableMap"> = Object.assign(
      this.database._.session.prepareQuery<PreparedQueryConfig & { execute: Value }>(prepared.query, prepared.fields,
        prepared.statementName, prepared.isResponseInArrayMode, undefined, prepared.queryMetadata, prepared.cacheConfig),
      { joinsNotNullableMap: prepared.joinsNotNullableMap },
    );
    return query;
  }
  override execute(): Promise<Value> {
    return (this.boundQuery ?? this.prepareExecution()).execute(this.bindings);
  }
}

/** Private persistence mechanics for code-defined named reads. Retains no
 * session, client, bindings, rows, clocks or readiness result across calls.
 * The result type comes from the native select/raw statement, never a supplied
 * row type. Raw mode retains native eager preparation with lazy transport. */
export function defineNativeMetadataRead<Statement extends
  { prepare(name: string): PgPreparedQuery<PreparedQueryConfig> } | { execute(): Promise<unknown> }
>(build: (database: FlarexMetadataDatabase) => Statement, mode: "select" | "raw" = "select", name?: string) {
  type Value = Statement extends { prepare(name: string): infer Prepared extends PgPreparedQuery<PreparedQueryConfig> }
    ? Awaited<ReturnType<Prepared["execute"]>>
    : Statement extends { execute(): Promise<infer RawValue> } ? RawValue : never;
  let preparation: NativeReadPreparation | undefined;
  const compile = () => {
    if (preparation !== undefined) return preparation;
    const dialect = new PgDialect();
    const session = new NativeReadCompilationSession(dialect);
    const database = new PgDatabase<PgQueryResultHKT, FlarexMetadataDatabase["_"]["fullSchema"]>(dialect, session, undefined);
    const statement = build(database);
    if ((mode === "select") !== ("prepare" in statement))
      throw new Error("Native metadata read mode does not match its statement");
    // Native execute(SQL) already prepares synchronously, without executing.
    // Select builders defer this exact step until their public prepare call.
    if ("prepare" in statement) statement.prepare("compile_static_metadata_read");
    const captured = session.captured;
    if (captured === undefined) throw new Error("Native metadata read did not prepare a statement");
    const native = captured.preparation();
    preparation = name === undefined ? native : Object.freeze({ ...native,
      statementName: `${name}_${createHash("sha256").update(native.query.sql).digest("hex").slice(0, 40)}` });
    return preparation;
  };
  return (database: FlarexMetadataDatabase, bindings: Record<string, unknown>) => new BoundNativeRead<Value>(compile, database, bindings, mode === "raw");
}

/** Compile code-defined metadata once; each checkout binds a fresh session.
 * Construct each full-schema view only when that checkout first requests it. */
export function makePhysicalSessionAccess<
  FullSchema extends Record<string, unknown>,
>(fullSchema: FullSchema) {
  type Tables = ExtractTablesWithRelations<FullSchema>;
  const extracted = extractTablesRelationalConfig<Tables>(
    fullSchema,
    createTableRelationsHelpers,
  );
  const schema = {
    fullSchema,
    schema: extracted.tables,
    tableNamesMap: extracted.tableNamesMap,
  } satisfies RelationalSchemaConfig<Tables>;
  const dialect = new PgDialect();
  return (client: Client | PoolClient) => {
    let session: NodePgSession<FullSchema, Tables> | undefined;
    const getSession = () => session ??= new NodePgSession<FullSchema, Tables>(client, dialect, schema);
    let database: NodePgDatabase<FullSchema> | undefined;
    let transaction: NodePgTransaction<FullSchema, Tables> | undefined;
    return {
      get session() { return getSession(); },
      get database() {
        return database ??= new NodePgDatabase<FullSchema>(dialect, getSession(), schema);
      },
      get transaction() {
        return transaction ??= new NodePgTransaction<FullSchema, Tables>(dialect, getSession(), schema);
      },
    };
  };
}
