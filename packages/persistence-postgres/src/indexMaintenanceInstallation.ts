import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds,
  fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations } from "./schema";
import { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "./indexMaintenancePublishers";
export { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "./indexMaintenancePublishers";

const obligationTables = [fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations];
const builds = [fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const names = (columns: readonly PgColumn[]) => columns.map(column => quote(column.name)).join(",");
const compile = (value: SQL, table: PgTable) => new PgDialect().sqlToQuery(value).sql.replaceAll(`${quote(getTableName(table))}.`, "");
const normalizeExpression = (value: string) => value.replaceAll("::text", "")
  .replace(/\b(and|or|is|not|null)\b/g, token => token.toUpperCase()).replace(/[\s()"]/g, "");

/** Exact ordinary lifecycle columns. Table grants must be revoked before these
 * column grants are installed; the activation binding has no ordinary writer. */
export const INDEX_MAINTENANCE_BUILD_PERMISSIONS = builds.map(table => Object.freeze({
  tableName: getTableName(table),
  bindingColumn: table.maintenanceActivationSequence.name,
  writableColumns: Object.values(getTableColumns(table)).filter(column => column !== table.maintenanceActivationSequence).map(column => column.name),
}));
export const INDEX_MAINTENANCE_OBLIGATION_TABLES = obligationTables.map(table => getTableName(table));

const immutableBody = `BEGIN
  RAISE EXCEPTION 'Maintenance opening obligations are immutable' USING ERRCODE = '55000';
END;`;
const maintainedDeleteBody = `BEGIN
  IF OLD.${quote(fxSystemIndexBuildStates.maintenanceActivationSequence.name)} IS NOT NULL THEN
    RAISE EXCEPTION 'Maintained builds cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;`;
export const INDEX_MAINTENANCE_GUARD_FUNCTIONS = [
  { name: "fx_guard_maintenance_obligation", signature: "", body: immutableBody },
  { name: "fx_guard_maintained_build_delete", signature: "", body: maintainedDeleteBody },
] as const;

const createObligationTable = (table: PgTable) => {
  const config = getTableConfig(table);
  const definitions = [
    ...config.columns.map(column => `${quote(column.name)} ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}`),
    ...config.primaryKeys.map(key => `CONSTRAINT ${quote(key.getName())} PRIMARY KEY (${names(key.columns)})`),
    ...config.uniqueConstraints.map(key => `CONSTRAINT ${quote(key.getName()!)} UNIQUE (${names(key.columns)})`),
    ...config.checks.map(check => `CONSTRAINT ${quote(check.name)} CHECK (${compile(check.value, table)})`),
  ];
  return `CREATE TABLE IF NOT EXISTS %1$I.${quote(config.name)} (${definitions.join(",\n")});\nREVOKE ALL ON TABLE %1$I.${quote(config.name)} FROM PUBLIC;`;
};
const openingKeys = builds.map(table => {
  const key = getTableConfig(table).foreignKeys.find(candidateKey => candidateKey.getName().endsWith("maintenance_opening_fk"));
  if (key === undefined) throw new Error("Typed maintenance build lacks its opening foreign key");
  return key;
});
const stageKeys = openingKeys.map(key => {
  const reference = key.reference();
  return `IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = format('%I.%I',target_schema,'${getTableName(key.table)}')::pg_catalog.regclass AND conname = '${key.getName()}') THEN
    EXECUTE format('ALTER TABLE %1$I.${quote(getTableName(key.table))} ADD CONSTRAINT ${quote(key.getName())} FOREIGN KEY (${names(reference.columns)}) REFERENCES %1$I.${quote(getTableName(reference.foreignTable))} (${names(reference.foreignColumns)}) ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID',target_schema);
  END IF;`;
});

// Historical frame projection belongs only to the final conversion refusal.
// Runtime readers consume the typed record directly; canonical-byte and genuine
// control authentication stay with the strict bounded converter.
const legacyFrameProjection = (ordinal: number) => {
  const table = obligationTables[ordinal]!;
  const columns = getTableColumns(table);
  const field = (name: keyof typeof columns) => `o.${quote(columns[name]!.name)}`;
  const entries = [
    ["format", `'flarex.${ordinal === 0 ? "index" : "unique"}-maintenance'`], ["version", "1"],
    ["scopeId", field("scopeId")], ["storageGeneration", field("storageGeneration")],
    ["storageGenerationFence", `${field("storageGenerationFence")}::text`], ["epoch", field("epoch")],
    ["tableId", field("tableId")], ["physicalSpecSha256Hex", `pg_catalog.encode(${field("physicalSpecSha256")},'hex')`],
    ["deploymentId", field("deploymentId")], ["schemaVersionId", field("schemaVersionId")],
    ["attemptFence", `${field("attemptFence")}::text`], ["openedCommitSeq", `${field("openedCommitSeq")}::text`],
    ["activationSequence", `${field("activationSequence")}::text`], ["headSha256", `pg_catalog.encode(${field("headSha256")},'hex')`],
    ...(ordinal === 0 ? [
      ["indexDefinitionId", `o.${quote(fxSystemIndexMaintenanceObligations.indexDefinitionId.name)}`],
      ["firstReadableCommitSeq", `o.${quote(fxSystemIndexMaintenanceObligations.firstReadableCommitSeq.name)}::text`],
      ["schemaManifestSha256", `pg_catalog.encode(o.${quote(fxSystemIndexMaintenanceObligations.schemaManifestSha256.name)},'hex')`],
    ] : [
      ["uniqueConstraintDefinitionId", `o.${quote(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId.name)}`],
      ["startCommitSeq", `o.${quote(fxSystemUniqueMaintenanceObligations.startCommitSeq.name)}::text`],
    ]),
  ];
  return `pg_catalog.jsonb_build_object(${entries.map(([name,value]) => `'${name}',${value}`).join(",")})`;
};

/** Fixed staging DDL outside the canonical journal. Legacy bytes survive every
 * conversion unit and cannot be removed by this preparation operation. */
export const TYPED_MAINTENANCE_STAGE_SQL = `DO $stage$
DECLARE target_schema text := current_schema(); relation_name text;
BEGIN
  EXECUTE format($ddl$${obligationTables.map(createObligationTable).join("\n")}$ddl$,target_schema);
  ${stageKeys.join("\n")}
  ${INDEX_MAINTENANCE_GUARD_FUNCTIONS.map(operation => `EXECUTE format($ddl$CREATE OR REPLACE FUNCTION %1$I.${operation.name}() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$${operation.body}$body$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.${operation.name}() FROM PUBLIC',target_schema);`).join("\n")}
  FOREACH relation_name IN ARRAY ARRAY[${obligationTables.map(table => `'${getTableName(table)}'`).join(",")}] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_00_installation_admission') THEN
      EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_require_active_installation()',target_schema,relation_name,target_schema);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_maintenance_immutable') THEN
      EXECUTE format('CREATE TRIGGER fx_maintenance_immutable BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_guard_maintenance_obligation()',target_schema,relation_name,target_schema);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[${builds.map(table => `'${getTableName(table)}'`).join(",")}] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_maintenance_delete') THEN
      EXECUTE format('CREATE TRIGGER fx_maintenance_delete BEFORE DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_guard_maintained_build_delete()',target_schema,relation_name,target_schema);
    END IF;
  END LOOP;
END;
$stage$;`;

/** Appended only after the fixed converter has authenticated the complete
 * retained inventory. No partially converted journal entry can be committed. */
export const TYPED_MAINTENANCE_FINAL_SQL = `${TYPED_MAINTENANCE_STAGE_SQL}
--> statement-breakpoint
ALTER TABLE fx_system_installation_runtime DROP CONSTRAINT fx_system_installation_runtime_access_profile_check;
--> statement-breakpoint
ALTER TABLE fx_system_installation_runtime ADD CONSTRAINT fx_system_installation_runtime_access_profile_check
  CHECK (access_profile IN ('dataRuntime','controlRead','activationWriter'));
--> statement-breakpoint
DO $final$
DECLARE target_schema text := current_schema(); relation_name text; incomplete boolean;
BEGIN
  ${builds.map((table, ordinal) => {
    const obligation = obligationTables[ordinal]!;
    const key = openingKeys[ordinal]!;
    const reference = key.reference();
    return `IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = format('%I.%I',target_schema,'${getTableName(table)}')::pg_catalog.regclass AND attname = 'maintenance_bytes' AND NOT attisdropped) THEN
    EXECUTE format($query$SELECT EXISTS (SELECT 1 FROM %1$I.${quote(getTableName(table))} b LEFT JOIN %1$I.${quote(getTableName(obligation))} o ON ${reference.columns.map((column, index) => `b.${quote(column.name)} = o.${quote(reference.foreignColumns[index]!.name)}`).join(" AND ")}
      WHERE (b.maintenance_activation_sequence IS NULL AND (b.maintenance_bytes IS NOT NULL OR b.maintenance_sha256 IS NOT NULL))
      OR (b.maintenance_activation_sequence IS NOT NULL AND (o.activation_sequence IS NULL OR b.maintenance_bytes IS NULL OR b.maintenance_sha256 IS NULL
        OR pg_catalog.sha256(b.maintenance_bytes) IS DISTINCT FROM b.maintenance_sha256
        OR pg_catalog.convert_from(b.maintenance_bytes,'UTF8')::jsonb IS DISTINCT FROM ${legacyFrameProjection(ordinal)})))$query$,target_schema) INTO incomplete;
    IF incomplete THEN RAISE EXCEPTION 'Typed maintenance conversion is incomplete' USING ERRCODE = '55000'; END IF;
  END IF;
  EXECUTE format('ALTER TABLE %1$I.${quote(getTableName(table))} VALIDATE CONSTRAINT ${quote(key.getName())}',target_schema);
  EXECUTE format('ALTER TABLE %1$I.${quote(getTableName(table))} DROP CONSTRAINT IF EXISTS ${quote(getTableConfig(table).checks.find(check => check.name.endsWith("maintenance_check"))!.name)}',target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I.${quote(getTableName(table))} ADD CONSTRAINT ${quote(getTableConfig(table).checks.find(check => check.name.endsWith("maintenance_check"))!.name)} CHECK (${compile(getTableConfig(table).checks.find(check => check.name.endsWith("maintenance_check"))!.value, table)});$ddl$,target_schema);
  EXECUTE format('ALTER TABLE %1$I.${quote(getTableName(table))} DROP COLUMN IF EXISTS maintenance_bytes, DROP COLUMN IF EXISTS maintenance_sha256',target_schema);`;
  }).join("\n")}
END;
$final$;`;

const checkProof = (schemaName: SQL, table: PgTable, name: string, expression: SQL) => sql`exists (
  select 1 from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid
  where c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and c.relname = ${getTableName(table)}
    and k.conname = ${name} and k.contype = 'c' and k.convalidated and not k.connoinherit
    and pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(k.conbin,k.conrelid),'::text',''),'[[:space:]()"]','','g') = ${normalizeExpression(compile(expression, table))})`;

/** Real columns, keys, exact FK direction/actions and native guard/publisher
 * bodies are attested by installation, outside request-time coverage checks. */
export function indexMaintenanceInstallationSql(schemaName: SQL): SQL<boolean> {
  const columnContracts = [...obligationTables.flatMap(table => Object.values(getTableColumns(table)).map(column => ({ table,column }))),
    ...builds.flatMap((table,ordinal) => {
      const actualColumns = Object.values(getTableColumns(table));
      return [...openingKeys[ordinal]!.reference().columns,table.lifecycle].map(selected => {
        const column = actualColumns.find(actual => actual.name === selected.name);
        if (column === undefined) throw new Error("Maintenance opening key does not name a real build column");
        return { table,column };
      });
    })];
  const columns = sql.join(columnContracts.map(({ table,column }) => sql`
    (${getTableName(table)},${column.name},${column.getSQLType()}::pg_catalog.regtype::oid,${column.notNull}::boolean,${column.default !== undefined}::boolean)`),sql`,`);
  const keys = obligationTables.flatMap(table => {
    const config = getTableConfig(table);
    return [...config.primaryKeys.map(key => ({ name: key.getName(), columns: key.columns, kind: "p" })),
      ...config.uniqueConstraints.map(key => ({ name: key.getName()!, columns: key.columns, kind: "u" }))].map(key => sql`exists (
        select 1 from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid
        where c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and c.relname = ${config.name}
          and k.conname = ${key.name} and k.contype = ${key.kind} and k.convalidated and not k.condeferrable and not k.condeferred
          and exists (select 1 from pg_catalog.pg_index backing where backing.indexrelid = k.conindid
            and backing.indrelid = c.oid and backing.indisunique and backing.indisvalid and backing.indisready and backing.indislive
            and backing.indimmediate and backing.indpred is null and backing.indexprs is null)
          and (select array_agg(a.attname::text order by entry.ordinality) from unnest(k.conkey) with ordinality entry(number,ordinality)
            join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = entry.number) = array[${sql.join(key.columns.map(column => sql`${column.name}`),sql`,`)}]::text[])`);
  });
  const foreignKeys = openingKeys.map(key => {
    const ref = key.reference();
    return sql`exists (select 1 from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid
      join pg_catalog.pg_class parent on parent.oid = k.confrelid
      where c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and parent.relnamespace = c.relnamespace
        and c.relname = ${getTableName(key.table)} and parent.relname = ${getTableName(ref.foreignTable)}
        and k.conname = ${key.getName()} and k.contype = 'f' and k.convalidated and not k.condeferrable and not k.condeferred
        and k.confupdtype = 'r' and k.confdeltype = 'r' and k.confmatchtype = 's'
        and (select array_agg(a.attname::text order by entry.ordinality) from unnest(k.conkey) with ordinality entry(number,ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = entry.number) = array[${sql.join(ref.columns.map(column => sql`${column.name}`),sql`,`)}]::text[]
        and (select array_agg(a.attname::text order by entry.ordinality) from unnest(k.confkey) with ordinality entry(number,ordinality)
          join pg_catalog.pg_attribute a on a.attrelid = parent.oid and a.attnum = entry.number) = array[${sql.join(ref.foreignColumns.map(column => sql`${column.name}`),sql`,`)}]::text[])`;
  });
  const checks = [...obligationTables.flatMap(table => getTableConfig(table).checks.map(check => checkProof(schemaName, table, check.name, check.value))),
    ...builds.map(table => { const check = getTableConfig(table).checks.find(candidateCheck => candidateCheck.name.endsWith("maintenance_check"))!; return checkProof(schemaName,table,check.name,check.value); })];
  const guards = INDEX_MAINTENANCE_GUARD_FUNCTIONS.map(operation => sql`exists (select 1 from pg_catalog.pg_proc p
    where p.pronamespace = (${schemaName}::pg_catalog.regnamespace) and p.proname = ${operation.name}
      and p.pronargs = 0 and p.proargtypes = ''::pg_catalog.oidvector and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      and not p.prosecdef and not p.proretset and p.provolatile = 'v' and p.prokind = 'f' and p.pronargdefaults = 0
      and not p.proisstrict and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
      and p.proowner = (select relowner from pg_catalog.pg_class where oid = (pg_catalog.quote_ident(${schemaName}) || '.fx_system_installation')::pg_catalog.regclass)
      and p.proconfig = array['search_path=pg_catalog, pg_temp'] and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      and pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n') = ${operation.body})`);
  const triggers = [...obligationTables.map(table => ({ table, name: "fx_maintenance_immutable", functionName: "fx_guard_maintenance_obligation", kind: 27 })),
    ...builds.map(table => ({ table, name: "fx_maintenance_delete", functionName: "fx_guard_maintained_build_delete", kind: 11 }))].map(binding => sql`exists (
      select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_proc p on p.oid = t.tgfoid
      where c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and c.relname = ${getTableName(binding.table)}
        and t.tgname = ${binding.name} and p.pronamespace = c.relnamespace and p.proname = ${binding.functionName}
        and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = ${binding.kind} and t.tgconstraint = 0
        and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null and t.tgnargs = 0)`);
  const publishers = INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.map(operation => sql`exists (select 1 from pg_catalog.pg_proc p
    where p.oid = (pg_catalog.quote_ident(${schemaName}) || '.' || ${operation.name} || '(' || ${operation.signature} || ')')::pg_catalog.regprocedure
      and p.prosecdef and p.provolatile = 'v' and p.prokind = 'f' and p.proretset and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
      and p.pronargdefaults = 0 and not p.proisstrict and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
      and p.proowner = (select relowner from pg_catalog.pg_class where oid = (pg_catalog.quote_ident(${schemaName}) || '.fx_system_installation')::pg_catalog.regclass)
      and p.proconfig = array['search_path=pg_catalog, pg_temp'] and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and p.proargnames = array[${sql.join([...operation.inputs,...operation.outputs].map(name => sql`${name}`),sql`,`)}]::text[]
      and p.proargmodes = array[${sql.join([...operation.inputs.map(() => sql`'i'`),...operation.outputs.map(() => sql`'t'`)],sql`,`)}]::"char"[]
      and p.proallargtypes = array[${sql.join([...operation.signature.split(","),...operation.outputTypes].map(type => sql`${type}::pg_catalog.regtype::oid`),sql`,`)}]::oid[]
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      and pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".') = ${operation.ddl.split(operation.delimiter)[1]!.replaceAll("%1$I.",'"__flarex_target__".')})`);
  return sql<boolean>`(not exists (
    select 1 from (values ${columns}) expected(table_name,column_name,type_oid,required,has_default)
    left join pg_catalog.pg_class c on c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and c.relname = expected.table_name
    left join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = expected.column_name and a.attnum > 0 and not a.attisdropped
    where a.attnum is null or a.atttypid <> expected.type_oid or a.attnotnull <> expected.required or a.attgenerated <> '' or a.atthasdef <> expected.has_default)
    and (select count(*) = ${obligationTables.length} and bool_and(c.relkind = 'r' and not c.relispartition
      and not c.relhasrules and not c.relrowsecurity and c.relowner = (select relowner from pg_catalog.pg_class
        where oid = (pg_catalog.quote_ident(${schemaName}) || '.fx_system_installation')::pg_catalog.regclass))
      from pg_catalog.pg_class c where c.relnamespace = (${schemaName}::pg_catalog.regnamespace)
        and c.relname = any(array[${sql.join(obligationTables.map(table => sql`${getTableName(table)}`),sql`,`)}]::text[]))
    and ${sql.join(obligationTables.map(table => sql`(select count(*) = ${Object.keys(getTableColumns(table)).length}
      from pg_catalog.pg_attribute a where a.attrelid = (pg_catalog.quote_ident(${schemaName}) || '.' || ${getTableName(table)})::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped)`),sql` and `)}
    and not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_attribute a on a.attrelid = c.oid
      where c.relnamespace = (${schemaName}::pg_catalog.regnamespace) and c.relname = any(array[${sql.join(builds.map(table => sql`${getTableName(table)}`),sql`,`)}]::text[])
        and a.attname in ('maintenance_bytes','maintenance_sha256') and a.attnum > 0 and not a.attisdropped)
    and ${sql.join([...keys,...foreignKeys,...checks,...guards,...triggers,...publishers],sql` and `)})`;
}
