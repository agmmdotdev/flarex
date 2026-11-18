import { Client } from "pg";
import { Schema } from "effect";

const Counter = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const IntegerCounter = Counter.check(Schema.isInt());
const RetrievalDatabaseIdentitySchema = Schema.Struct({ database: Schema.String, dbid: IntegerCounter });
export type RetrievalDatabaseIdentity = typeof RetrievalDatabaseIdentitySchema.Type;
const decodeDatabaseIdentities = Schema.decodeUnknownSync(Schema.Array(RetrievalDatabaseIdentitySchema));
const RetrievalServerStatementSchema = Schema.Struct({
  userid: IntegerCounter, dbid: IntegerCounter, queryid: Schema.String.check(Schema.isPattern(/^-?\d+$/)),
  toplevel: Schema.Boolean, query: Schema.NullOr(Schema.String),
  calls: IntegerCounter, plans: IntegerCounter, stats_since: Schema.String,
  total_plan_time: Counter, total_exec_time: Counter,
  rows: IntegerCounter, shared_blks_hit: IntegerCounter, shared_blks_read: IntegerCounter,
  shared_blks_dirtied: IntegerCounter, shared_blks_written: IntegerCounter,
  temp_blks_read: IntegerCounter, temp_blks_written: IntegerCounter,
});
export type RetrievalServerStatement = typeof RetrievalServerStatementSchema.Type;
const decodeStatements = Schema.decodeUnknownSync(Schema.Array(RetrievalServerStatementSchema));
const decodeSettings = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  name: Schema.String, setting: Schema.NullOr(Schema.String), unit: Schema.NullOr(Schema.String),
})));
const RetrievalServerInfo = Schema.Struct({
  stats_reset: Schema.String, dealloc: IntegerCounter,
});
const decodeInfo = Schema.decodeUnknownSync(Schema.Array(RetrievalServerInfo));
const SettingObservation = Schema.Union([
  Schema.Struct({ status: Schema.Literal("observed"), value: Schema.String }),
  Schema.Struct({ status: Schema.Literal("unavailable"), reason: Schema.Literal("restrictedOrUnknownSetting") }),
]);
const RuntimeSettings = Schema.Struct({
  database: Schema.String, role: Schema.String, dbid: IntegerCounter, userid: IntegerCounter,
  pid: IntegerCounter, settings: Schema.Record(Schema.String, SettingObservation),
});
const decodeRuntimeSettings = Schema.decodeUnknownSync(Schema.Array(RuntimeSettings));
/** Select catalog identities observed on the actual runtime pools, not URL
 * path spelling. PostgreSQL connection URLs may encode the database name. */
export function selectRetrievalServerDatabases(expectedNativeDatabase: string,
  native: typeof RuntimeSettings.Type, flarex: typeof RuntimeSettings.Type,
  control: typeof RuntimeSettings.Type): readonly RetrievalDatabaseIdentity[] {
  if (native.database !== expectedNativeDatabase)
    throw new Error("Actual native database differs from selected existing database");
  if (flarex.database !== control.database || flarex.dbid !== control.dbid)
    throw new Error("Flarex runtime and control database identities differ");
  if (native.database === flarex.database || native.dbid === flarex.dbid)
    throw new Error("Native and Flarex retrieval databases must be distinct");
  return [{ database: native.database, dbid: native.dbid }, { database: flarex.database, dbid: flarex.dbid }];
}

/** The observer must see the same selected catalog identities as the actual
 * runtime pools. Missing names or another cluster's OIDs refuse coverage. */
export function verifyRetrievalServerCatalogCoverage(selected: readonly RetrievalDatabaseIdentity[], rows: unknown) {
  const catalog = decodeDatabaseIdentities(rows);
  if (catalog.length !== selected.length || selected.some(expected =>
    catalog.filter(actual => actual.database === expected.database && actual.dbid === expected.dbid).length !== 1))
    throw new Error("Observer catalog does not cover authenticated retrieval database identities");
  return catalog;
}

/** A successful retrieval requires observed server work from its actual lane.
 * Keep all roles; a SECURITY DEFINER owner may execute nested work. */
export function requireRetrievalServerObservedCalls(database: RetrievalDatabaseIdentity,
  statements: readonly Pick<RetrievalServerStatement, "dbid" | "calls">[] | undefined) {
  if (statements === undefined || !statements.some(entry => entry.dbid === database.dbid && entry.calls > 0))
    throw new Error(`No observed server calls for successful retrieval in ${database.database}`);
}
const settingNames = ["server_version", "search_path", "statement_timeout", "lock_timeout", "fsync", "synchronous_commit", "full_page_writes", "shared_preload_libraries",
  "compute_query_id", "track_activities", "track_io_timing", "log_line_prefix", "pg_stat_statements.track_utility",
  "pg_stat_statements.track", "pg_stat_statements.track_planning", "track_functions",
  "auto_explain.log_min_duration", "auto_explain.log_nested_statements", "auto_explain.log_analyze"];

/** Runs on the actual native manager or Flarex persistence pool, outside every
 * request interval. Native callers provide their existing manager.execute. */
export async function readRetrievalRuntimeSettings(execute: (sql: string) => Promise<unknown>) {
  const result = decodeRuntimeSettings(await execute(`select current_database() as database,
    current_user as role, (select oid::int from pg_database where datname = current_database()) as dbid,
    (select oid::int from pg_roles where rolname = current_user) as userid, pg_backend_pid() as pid,
    (select json_object_agg(names.name, case when config.setting is null
      then json_build_object('status', 'unavailable', 'reason', 'restrictedOrUnknownSetting')
      else json_build_object('status', 'observed', 'value', config.setting) end)
     from unnest(array[${settingNames.map(name => `'${name}'`).join(",")}]) as names(name)
     left join pg_settings config on config.name = names.name) as settings`));
  const first = result[0];
  if (first === undefined || result.length !== 1) throw new Error("Missing actual retrieval runtime settings");
  return first;
}

export interface RetrievalServerSnapshot {
  readonly info: readonly (typeof RetrievalServerInfo.Type)[];
  readonly statements: readonly RetrievalServerStatement[];
}

export async function openRetrievalServerObserver(connectionString: string,
  databases: readonly RetrievalDatabaseIdentity[], options?: Readonly<{ includeQueryText?: boolean; maxStatements?: number;
    connectionTimeoutMs?: number; queryTimeoutMs?: number }>) {
  const maximum = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })))(
    options?.maxStatements ?? 100_000);
  const timeout = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30_000 })));
  const client = new Client({ connectionString, application_name: "native-retrieval-diagnostics",
    connectionTimeoutMillis: timeout(options?.connectionTimeoutMs ?? 0), query_timeout: timeout(options?.queryTimeoutMs ?? 0) });
  try {
    await client.connect();
    const observerIdentity = await readRetrievalRuntimeSettings(async sql => (await client.query(sql)).rows);
    if (databases.some(database => database.database === observerIdentity.database || database.dbid === observerIdentity.dbid))
      throw new Error("Retrieval diagnostics must connect outside the selected isolated databases");
    const catalog = verifyRetrievalServerCatalogCoverage(databases, (await client.query(
      "select datname as database, oid::int as dbid from pg_database where datname = any($1::text[]) order by datname",
      [databases.map(database => database.database)])).rows);
    const settings = decodeSettings((await client.query(
      `select names.name, config.setting, config.unit
       from unnest($1::text[]) as names(name)
       left join pg_settings config on config.name = names.name order by names.name`,
      [settingNames])).rows).map(entry => ({ name: entry.name, unit: entry.unit,
        observation: entry.setting === null
          ? { status: "unavailable" as const, reason: "restrictedOrUnknownSetting" as const }
          : { status: "observed" as const, value: entry.setting } }));
    return {
      settings, observerIdentity,
      coverage: { databases: catalog, executingRoles: "all roles in root-exclusive isolated databases" },
      async snapshot(): Promise<RetrievalServerSnapshot> {
        // The isolated databases are root-exclusive. Include SECURITY DEFINER
        // owners as well as login roles, and exclude this observer's database.
        // No global or database reset; nested statements remain independent.
        const info = decodeInfo((await client.query("select stats_reset::text, dealloc::float8 from pg_stat_statements_info")).rows);
        if (info.length !== 1) throw new Error("Missing PostgreSQL statement statistics epoch");
        const statements = decodeStatements((await client.query(
          `select s.userid::int, s.dbid::int, s.queryid::text, s.toplevel, s.query,
            s.calls::float8, s.plans::float8, s.stats_since::text, s.total_plan_time, s.total_exec_time, s.rows::float8,
            s.shared_blks_hit::float8, s.shared_blks_read::float8,
            s.shared_blks_dirtied::float8, s.shared_blks_written::float8,
            s.temp_blks_read::float8, s.temp_blks_written::float8
           from pg_stat_statements(${options?.includeQueryText !== false}) s
           where s.dbid = any($1::oid[])
           order by s.userid, s.dbid, s.queryid, s.toplevel limit ${maximum + 1}`, [catalog.map(database => database.dbid)])).rows);
        if (statements.length > maximum) throw new Error("PostgreSQL statement observation capacity exceeded");
        return { info, statements };
      },
      close: () => client.end(),
    };
  } catch (cause) {
    try { await client.end(); }
    catch (cleanup) { throw new AggregateError([cause, cleanup], "Retrieval observer setup and cleanup failed"); }
    throw cause;
  }
}

export function retrievalServerDifference(before: RetrievalServerSnapshot,
  after: RetrievalServerSnapshot) {
  if (before.info[0]?.stats_reset !== after.info[0]?.stats_reset || before.info[0]?.dealloc !== after.info[0]?.dealloc)
    throw new Error("PostgreSQL statement statistics reset or deallocated during retrieval interval");
  const key = (entry: RetrievalServerStatement) => `${entry.userid}/${entry.dbid}/${entry.queryid}/${entry.toplevel}`;
  const previous = new Map(before.statements.map(entry => [key(entry), entry]));
  const present = new Set(after.statements.map(key));
  if (before.statements.some(entry => !present.has(key(entry))))
    throw new Error("PostgreSQL statement statistics lost entries during retrieval interval");
  const counters = ["calls", "plans", "total_plan_time", "total_exec_time", "rows", "shared_blks_hit", "shared_blks_read",
    "shared_blks_dirtied", "shared_blks_written", "temp_blks_read", "temp_blks_written"] as const;
  return after.statements.flatMap(entry => {
    const old = previous.get(key(entry));
    if (old !== undefined && entry.stats_since !== old.stats_since)
      throw new Error("PostgreSQL statement statistics entry reset during retrieval interval");
    const calls = entry.calls - (old?.calls ?? 0);
    if (counters.some(counter => entry[counter] < (old?.[counter] ?? 0)))
      throw new Error("PostgreSQL statement statistics counter decreased during retrieval interval");
    if (counters.every(counter => entry[counter] === (old?.[counter] ?? 0))) return [];
    return [{ ...entry, calls,
      plans: entry.plans - (old?.plans ?? 0),
      total_plan_time: entry.total_plan_time - (old?.total_plan_time ?? 0),
      total_exec_time: entry.total_exec_time - (old?.total_exec_time ?? 0),
      rows: entry.rows - (old?.rows ?? 0),
      shared_blks_hit: entry.shared_blks_hit - (old?.shared_blks_hit ?? 0),
      shared_blks_read: entry.shared_blks_read - (old?.shared_blks_read ?? 0),
      shared_blks_dirtied: entry.shared_blks_dirtied - (old?.shared_blks_dirtied ?? 0),
      shared_blks_written: entry.shared_blks_written - (old?.shared_blks_written ?? 0),
      temp_blks_read: entry.temp_blks_read - (old?.temp_blks_read ?? 0),
      temp_blks_written: entry.temp_blks_written - (old?.temp_blks_written ?? 0) }];
  });
}
