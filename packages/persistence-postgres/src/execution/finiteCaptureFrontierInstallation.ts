import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

/** Private installed contracts. They carry expected immutable identity, never a
 * previously accepted live verdict or an executable database capability. */
export const FINITE_FRONTIER_TYPES = [
  { name: "fx_installation_frontier_expected", fields: [
    ["database_name", "text"], ["schema_name", "text"], ["namespace_oid", "bigint"],
    ["incarnation", "uuid"], ["structural_generation", "bigint"], ["login", "text"],
    ["endpoint_policy", "text"], ["access_profile", "text"], ["metadata_incarnation", "uuid"],
  ] },
  { name: "fx_installation_frontier", fields: [["accepted", "boolean"], ["metadata_generation", "bigint"]] },
  { name: "fx_finite_placement_frontier", fields: [
    ["reason", "text"], ["scope_id", "text"], ["deployment_id", "text"], ["active_schema_version_id", "text"],
    ["isolation_kind", "text"], ["physical_locator_json", "jsonb"], ["created_at", "timestamptz"],
    ["receipt_scope_id", "text"], ["receipt_protocol_version", "text"], ["receipt_state", "text"],
    ["receipt_physical_locator_json", "jsonb"], ["receipt_initial_epoch", "text"],
    ["receipt_reserved_at", "timestamptz"], ["receipt_ready_at", "timestamptz"],
    ["target_metadata_generation", "bigint"], ["control_metadata_generation", "bigint"],
  ] },
  { name: "fx_finite_capture_frontier", fields: [
    ["reason", "text"], ["database_now_epoch_milliseconds", "text"], ["serving_commit_seq", "bigint"],
    ["authority_row", "@target@.fx_system_scope_execution_authority"], ["session_row", "@target@.fx_system_tx_session"],
    ["build_row", "@target@.fx_system_index_build_state"], ["unique_row", "@target@.fx_system_unique_constraint_build"],
    ["table_frontier", "bigint"], ["historical_change", "boolean"], ["body_eligible", "boolean"],
  ] },
] as const;

export const INSTALLATION_FRONTIER_FUNCTION_SQL = `CREATE FUNCTION "__flarex_target__".fx_lock_installation_frontier(
  p_expected "__flarex_target__".fx_installation_frontier_expected)
RETURNS "__flarex_target__".fx_installation_frontier
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE admitted record; generation bigint;
BEGIN
  -- A SECURITY DEFINER body retains the original SET ROLE setting. Authenticate
  -- the actual login, including callers entering through the placement owner.
  IF current_setting('role') NOT IN ('none', session_user)
    OR (p_expected).login IS DISTINCT FROM session_user THEN RETURN ROW(false,NULL::bigint); END IF;
  SELECT * INTO STRICT admitted FROM "__flarex_target__".fx_lock_installation_admission();
  SELECT e.generation INTO generation FROM "__flarex_target__".fx_system_installation_runtime p
    JOIN "__flarex_target__".fx_system_prepared_metadata_epoch e ON e.singleton_id = 1
    WHERE p.login = session_user AND p.login_oid = session_user::regrole::oid::bigint
      AND p.incarnation = admitted.incarnation AND p.structural_generation = admitted.structural_generation
      AND p.endpoint_policy = (p_expected).endpoint_policy AND p.access_profile = (p_expected).access_profile
      AND p.metadata_incarnation = (p_expected).metadata_incarnation
      AND admitted.database_name = current_database() AND admitted.database_name = (p_expected).database_name
      AND admitted.schema_name = (p_expected).schema_name
      AND admitted.namespace_oid = (p_expected).namespace_oid
      AND admitted.namespace_oid = (p_expected).schema_name::regnamespace::oid::bigint
      AND admitted.incarnation = (p_expected).incarnation
      AND admitted.structural_generation = (p_expected).structural_generation
      AND e.database_name = admitted.database_name AND e.namespace_oid = admitted.namespace_oid
      AND e.incarnation = (p_expected).metadata_incarnation AND e.generation > 0;
  RETURN ROW(FOUND,generation);
END;
$body$`;

export const FINITE_PLACEMENT_FRONTIER_FUNCTION_SQL = `CREATE FUNCTION "__flarex_target__".fx_accept_finite_placement_frontier(
  p_target "__flarex_target__".fx_installation_frontier_expected,
  p_control "__flarex_target__".fx_installation_frontier_expected, p_deployment_id text, p_scope_id text)
RETURNS "__flarex_target__".fx_finite_placement_frontier
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE frontier "__flarex_target__".fx_finite_placement_frontier;
  control_gate "__flarex_target__".fx_installation_frontier; target_gate record;
  scope_row "__flarex_target__".fx_control_scope;
  receipt_row "__flarex_target__".fx_control_scope_provisioning;
  target_helper regprocedure; target_command text; effective_timeout interval;
BEGIN
  frontier.reason := 'invalidAuthority';
  effective_timeout := current_setting('statement_timeout')::interval;
  IF effective_timeout <= interval '0 milliseconds' OR effective_timeout > interval '30000 milliseconds' THEN
    frontier.reason := 'resourceFailure'; RETURN frontier;
  END IF;
  IF current_setting('role') NOT IN ('none',session_user)
    OR (p_target).login IS DISTINCT FROM session_user OR (p_control).login IS DISTINCT FROM session_user
    OR (p_target).access_profile IS DISTINCT FROM 'dataRuntime'
    OR (p_control).access_profile IS DISTINCT FROM 'controlRead'
    OR (p_control).schema_name IS DISTINCT FROM '__flarex_schema_name__'
    OR (p_target).schema_name IS NULL OR (p_target).schema_name = (p_control).schema_name THEN RETURN frontier; END IF;
  -- Authorize only the selected current placement's namespace before a
  -- privileged dynamic invocation. This unlocked read lends no serving verdict;
  -- installation admission and the final locked placement remain mandatory.
  IF NOT EXISTS(SELECT 1 FROM "__flarex_target__".fx_control_scope s
    WHERE s.id=p_scope_id AND s.deployment_id=p_deployment_id
      AND s.physical_locator_json ->> 'schemaName' = (p_target).schema_name) THEN RETURN frontier; END IF;
  target_helper := to_regprocedure(format('%I.fx_lock_installation_frontier(%I.fx_installation_frontier_expected)',
    (p_target).schema_name,(p_target).schema_name));
  IF target_helper IS NULL OR NOT has_function_privilege(session_user,target_helper,'EXECUTE') THEN RETURN frontier; END IF;
  -- Only one fixed installed helper is selectable. Its own owner authenticates
  -- the actual login and policy; this owner never reads an arbitrary target table.
  target_command := format('WITH accepted AS MATERIALIZED (SELECT %I.fx_lock_installation_frontier(
    ROW(($1).database_name,($1).schema_name,($1).namespace_oid,($1).incarnation,
      ($1).structural_generation,($1).login,($1).endpoint_policy,($1).access_profile,
      ($1).metadata_incarnation)::%I.fx_installation_frontier_expected) AS frontier)
    SELECT (frontier).accepted,(frontier).metadata_generation FROM accepted',
    (p_target).schema_name,(p_target).schema_name);
  IF (p_target).schema_name COLLATE "C" < (p_control).schema_name COLLATE "C" THEN
    EXECUTE target_command INTO target_gate USING p_target;
    IF target_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
    control_gate := "__flarex_target__".fx_lock_installation_frontier(p_control);
  ELSE
    control_gate := "__flarex_target__".fx_lock_installation_frontier(p_control);
    IF control_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
    EXECUTE target_command INTO target_gate USING p_target;
  END IF;
  IF target_gate.accepted IS DISTINCT FROM true OR control_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
  SELECT s.* INTO scope_row FROM "__flarex_target__".fx_control_scope s
    WHERE s.id = p_scope_id AND s.deployment_id = p_deployment_id FOR SHARE;
  IF NOT FOUND OR scope_row.physical_locator_json ->> 'schemaName'
    IS DISTINCT FROM (p_target).schema_name THEN RETURN frontier; END IF;
  SELECT r.* INTO receipt_row FROM "__flarex_target__".fx_control_scope_provisioning r
    WHERE r.scope_id = scope_row.id FOR SHARE;
  frontier.reason := 'accepted'; frontier.scope_id := scope_row.id;
  frontier.deployment_id := scope_row.deployment_id;
  frontier.active_schema_version_id := scope_row.active_schema_version_id;
  frontier.isolation_kind := scope_row.isolation_kind; frontier.physical_locator_json := scope_row.physical_locator_json;
  frontier.created_at := scope_row.created_at; frontier.receipt_scope_id := receipt_row.scope_id;
  frontier.receipt_protocol_version := receipt_row.protocol_version; frontier.receipt_state := receipt_row.state;
  frontier.receipt_physical_locator_json := receipt_row.physical_locator_json;
  frontier.receipt_initial_epoch := receipt_row.initial_epoch; frontier.receipt_reserved_at := receipt_row.reserved_at;
  frontier.receipt_ready_at := receipt_row.ready_at;
  frontier.target_metadata_generation := target_gate.metadata_generation;
  frontier.control_metadata_generation := control_gate.metadata_generation;
  RETURN frontier;
END;
$body$`;

export const FINITE_FRONTIER_FUNCTIONS = [
  { name: "fx_lock_installation_frontier", signature: "fx_installation_frontier_expected",
    argumentNames: ["p_expected"], argumentTypes: ["fx_installation_frontier_expected"], result: "fx_installation_frontier",
    source: INSTALLATION_FRONTIER_FUNCTION_SQL },
  { name: "fx_accept_finite_placement_frontier", signature: "fx_installation_frontier_expected,fx_installation_frontier_expected,text,text",
    argumentNames: ["p_target", "p_control", "p_deployment_id", "p_scope_id"],
    argumentTypes: ["fx_installation_frontier_expected", "fx_installation_frontier_expected", "text", "text"],
    result: "fx_finite_placement_frontier", source: FINITE_PLACEMENT_FRONTIER_FUNCTION_SQL },
] as const;

const bodyHash = (source: string) => createHash("sha256").update(source.split("$body$")[1]!).digest("hex");
const typeOid = (schema: SQL, type: string) => type.startsWith("@target@.") ?
  sql`(pg_catalog.quote_ident(${schema}) || ${type.slice(8)})::pg_catalog.regtype::oid` :
  type.startsWith("fx_") ? sql`(pg_catalog.quote_ident(${schema}) || '.' || ${type})::pg_catalog.regtype::oid` :
    sql`${type}::pg_catalog.regtype::oid`;

/** Installation/restoration proof; serving never reconstructs this catalog verdict. */
export const finiteCaptureFrontierInstallationSql = (schema: SQL) => sql<boolean>`(
  WITH bounds AS MATERIALIZED (SELECT n.oid AS namespace_oid,c.relowner AS owner_oid
    FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
    WHERE n.nspname=${schema} AND c.relname='fx_system_installation')
  SELECT ${sql.join(FINITE_FRONTIER_TYPES.map(type => sql`EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_class c ON c.oid=t.typrelid,bounds b WHERE t.typnamespace=b.namespace_oid
      AND t.typname=${type.name} AND t.typtype='c' AND t.typowner=b.owner_oid
      AND c.relkind='c' AND c.relowner=b.owner_oid
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(t.typacl,pg_catalog.acldefault('T',t.typowner))) a
        WHERE a.grantee=0 AND a.privilege_type='USAGE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_type field_type ON field_type.oid=a.atttypid
        WHERE a.attrelid=t.typrelid AND a.attnum>0 AND (a.attisdropped OR a.atttypmod<>-1
          OR a.attndims<>0 OR a.attnotnull OR a.attidentity<>'' OR a.attgenerated<>''
          OR a.attcollation<>field_type.typcollation))
      AND (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped)=
        ARRAY[${sql.join(type.fields.map(([name]) => sql`${name}`),sql`,`)}]::text[]
      AND (SELECT array_agg(a.atttypid ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=t.typrelid AND a.attnum>0 AND NOT a.attisdropped)=
        ARRAY[${sql.join(type.fields.map(([,fieldType]) => typeOid(schema,fieldType)),sql`,`)}]::oid[])`),sql` AND `)}
  AND ${sql.join(FINITE_FRONTIER_FUNCTIONS.map(fn => sql`(
    (SELECT count(*)=1 FROM pg_catalog.pg_proc p,bounds b WHERE p.pronamespace=b.namespace_oid AND p.proname=${fn.name})
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc p,bounds b WHERE p.pronamespace=b.namespace_oid
      AND p.proname=${fn.name} AND p.proowner=b.owner_oid AND p.prosecdef AND p.provolatile='v'
      AND NOT p.proretset AND p.prorettype=${typeOid(schema,fn.result)}
      AND p.pronargs=${fn.argumentTypes.length} AND p.pronargdefaults=0
      AND p.proargnames=ARRAY[${sql.join(fn.argumentNames.map(name=>sql`${name}`),sql`,`)}]::text[]
      AND p.proargtypes::text=array_to_string(ARRAY[${sql.join(fn.argumentTypes.map(type=>typeOid(schema,type)),sql`,`)}]::oid[],' ')
      AND p.proallargtypes IS NULL AND p.proargmodes IS NULL
      AND p.prokind='f' AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.prosupport=0
      AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
      AND encode(sha256(convert_to(replace(replace(replace(p.prosrc,E'\\r\\n',E'\\n'),
        quote_ident(${schema}) || '.', '"__flarex_target__".'),quote_literal(${schema}),
        quote_literal('__flarex_schema_name__')),'UTF8')),'hex')=${bodyHash(fn.source)}))`),sql` AND `)}
)`;
