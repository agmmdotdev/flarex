import type { Pool, PoolClient } from "pg";
import { Schema } from "effect";

/** This profile is deliberately limited to the three physical storage suites.
 * Child-first DELETE retains every FK, trigger and migration-installed seed. */
export const postgresStorageResetTables = [
  "fx_app_edge_current", "fx_app_edge_adjacency_version",
  "fx_app_index_entry_current", "fx_app_index_entry_rev",
  "fx_app_row_current", "fx_app_row_rev",
  "fx_control_index_definition", "fx_control_index", "fx_control_table",
  "fx_system_scope_execution_authority", "fx_system_scope_clock",
  "fx_control_scope_provisioning", "fx_control_scope", "deployments",
] as const;

const snapshotDecoder = Schema.decodeUnknownSync(Schema.Struct({ seal: Schema.String,
  generation: Schema.BigIntFromString }));
const tablesDecoder = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ tablename: Schema.String })));
const statisticsCapabilityDecoder = Schema.decodeUnknownSync(Schema.Struct({ supported: Schema.Boolean }));

/** Older servers keep the existing fresh-file fixture rather than attempting to
 * restore planner state through catalog writes or adjusted cost settings. */
export async function supportsPostgresStorageStatisticsReset(admin: Pool): Promise<boolean> {
  const result = await admin.query(`select
    pg_catalog.to_regprocedure('pg_catalog.pg_clear_relation_stats(text,text)') is not null and
    pg_catalog.to_regprocedure('pg_catalog.pg_clear_attribute_stats(text,text,text,boolean)') is not null as supported`);
  return statisticsCapabilityDecoder(result.rows[0]).supported;
}
function quoted(name: string): string { return `"${name.replaceAll('"', '""')}"`; }
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

/** An opaque fixture inventory, not a replacement installation verifier. Exclude
 * physical/statistics hints changed by VACUUM/ANALYZE, retaining definitions,
 * ownership, ACLs, constraints, triggers, functions, types and sequence state. */
function catalogSnapshot(schemaName: string): string {
  const namespace = literal(schemaName);
  return `select kind, coalesce(jsonb_agg(payload order by payload), '[]'::jsonb) as payload from (
    select 'namespace' as kind, to_jsonb(n) as payload from pg_namespace n where n.nspname=${namespace}
    union all select 'class', to_jsonb(c) - array['relfilenode','relpages','reltuples','relallvisible',
      'relallfrozen','relfrozenxid','relminmxid'] from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=${namespace}
    union all select 'attribute', to_jsonb(a) - 'attcacheoff' from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=${namespace} and a.attnum>0
    union all select 'default', to_jsonb(a) from pg_attrdef a join pg_class c on c.oid=a.adrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=${namespace}
    union all select 'constraint', to_jsonb(c) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname=${namespace}
    union all select 'index', to_jsonb(i) from pg_index i join pg_class c on c.oid=i.indexrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=${namespace}
    union all select 'trigger', to_jsonb(t) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=${namespace}
    union all select 'function', to_jsonb(p) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=${namespace}
    union all select 'type', to_jsonb(t) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname=${namespace}
    union all select 'enum', to_jsonb(e) from pg_enum e join pg_type t on t.oid=e.enumtypid
      join pg_namespace n on n.oid=t.typnamespace where n.nspname=${namespace}
    union all select 'sequence', to_jsonb(s) from pg_sequences s where s.schemaname=${namespace}
  ) fixture_catalog group by kind order by kind`;
}

export async function createPostgresStorageReset(admin: Pool, schemaName: string, migrationsSchema: string,
  expectedSeal: string | null) {
  const tables = tablesDecoder((await admin.query(`select tablename from pg_tables where schemaname=$1 order by tablename`, [schemaName])).rows);
  if (!postgresStorageResetTables.every(name => tables.some(row => row.tablename === name))) {
    throw new Error("Postgres storage reset profile is missing installed tables");
  }
  const outside = tables.filter(({ tablename }) => !postgresStorageResetTables.some(name => name === tablename));
  const data = outside.map(({ tablename }) => {
    const row = tablename === "fx_system_prepared_metadata_epoch" ? "to_jsonb(r) - 'generation'" : "to_jsonb(r)";
    return `select ${literal(tablename)} as name, coalesce(jsonb_agg(${row} order by ${row}), '[]'::jsonb) as payload
      from ${quoted(schemaName)}.${quoted(tablename)} r`;
  });
  data.push(`select 'migration journal', coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)), '[]'::jsonb)
    from ${quoted(migrationsSchema)}.__drizzle_migrations r`);
  const snapshotSql = `select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'catalog', (select jsonb_agg(to_jsonb(c) order by kind) from (${catalogSnapshot(schemaName)}) c),
    'outside', (select jsonb_agg(to_jsonb(d) order by name) from (${data.join(" union all ")}) d)
  )::text, 'UTF8')), 'hex') as seal, (select generation::text from ${quoted(schemaName)}.fx_system_prepared_metadata_epoch where singleton_id=1) as generation`;
  const capture = async (client: Pool | PoolClient) => {
    const result = await client.query(snapshotSql);
    const row = snapshotDecoder(result.rows[0]);
    return row;
  };
  const assertEmpty = async (client: Pool | PoolClient) => {
    const result = await client.query<{ dirty: boolean }>(`select ${postgresStorageResetTables.map(name =>
      `exists(select 1 from ${quoted(schemaName)}.${quoted(name)})`).join(" or ")} as dirty`);
    if (result.rows[0]?.dirty !== false) throw new Error("Postgres storage schema still contains profile rows");
  };
  const relationFilter = `c.relnamespace=${literal(schemaName)}::regnamespace and
    (c.relname=any(array[${postgresStorageResetTables.map(literal).join(",")}]) or c.oid in
      (select i.indexrelid from pg_index i join pg_class t on t.oid=i.indrelid
        where t.relnamespace=${literal(schemaName)}::regnamespace and
          t.relname=any(array[${postgresStorageResetTables.map(literal).join(",")}])) )`;
  const restorePhysicalState = async () => {
    // DELETE and empty ANALYZE retain planner history. Native owner operations
    // restore both physical storage and statistics without disabling guards.
    await admin.query(`vacuum (full) ${postgresStorageResetTables.map(table => `${quoted(schemaName)}.${quoted(table)}`).join(", ")}`);
    await admin.query(`select pg_catalog.pg_clear_attribute_stats(${literal(schemaName)},c.relname,a.attname,false)
      from pg_class c join pg_attribute a on a.attrelid=c.oid where ${relationFilter} and a.attnum>0 and not a.attisdropped;
      select pg_catalog.pg_clear_relation_stats(${literal(schemaName)},c.relname) from pg_class c where ${relationFilter}`);
  };
  await assertEmpty(admin);
  // A rewrite materializes migration-added missing defaults. Canonicalize the
  // empty fresh schema before sealing, retaining full attribute/default guards.
  if (expectedSeal === null) await restorePhysicalState();
  const baseline = await capture(admin);
  if (expectedSeal !== null && expectedSeal !== baseline.seal) throw new Error("Postgres storage schema or baseline data changed before reuse");
  let generation = baseline.generation;
  const verify = async (client: Pool | PoolClient) => {
    const current = await capture(client);
    if (current.seal !== baseline.seal || current.generation < generation) {
      throw new Error("Postgres storage fixture changed outside its reset profile");
    }
    generation = current.generation;
  };
  return { seal: baseline.seal, verify: async () => { await verify(admin); await assertEmpty(admin); },
    async reset() {
      const client = await admin.connect();
      let destroy = false;
      try {
        await client.query("begin");
        await verify(client);
        await client.query(postgresStorageResetTables.map(table => `delete from ${quoted(schemaName)}.${quoted(table)}`).join(";\n"));
        await verify(client);
        await assertEmpty(client);
        await client.query("commit");
      } catch (cause: unknown) {
        try { await client.query("rollback"); }
        catch (cleanup: unknown) { destroy = true; throw new AggregateError([cause, cleanup], "Storage reset and rollback failed"); }
        throw cause;
      } finally { client.release(destroy); }
      await restorePhysicalState();
      await verify(admin);
      await assertEmpty(admin);
    },
  };
}
