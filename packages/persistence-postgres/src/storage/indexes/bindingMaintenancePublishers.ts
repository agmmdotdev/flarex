import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { fxAppRowCurrent, fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations,
  fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemUniqueConstraintBuilds,
  fxSystemUniqueMaintenanceObligations } from "../../database/schema";
import { fxSystemDataBindingActivations, fxSystemDataBindingCandidates, fxSystemDataBindingHeads } from
  "../../installation/frameworkSchema/binding/schema";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const relation = (table: PgTable) => `%1$I.${quote(getTableName(table))}`;
const column = (value: PgColumn) => quote(value.name);
const inputs = ["p_scope", "p_expected_sequence", "p_expected_head", "p_incoming_sequence", "p_incoming_activation",
  "p_next_head", "p_candidate", "p_outgoing_deployment", "p_outgoing_schema", "p_outgoing_manifest", "p_outgoing_members",
  "p_incoming_deployment", "p_incoming_schema", "p_incoming_manifest", "p_incoming_members"];
const signature = "text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb";

/** The activation principal supplies authenticated immutable catalog membership.
 * Fixed local publication independently authenticates candidate/activation/head
 * lineage. Ordinary runtime principals cannot execute these functions. */
function publisher(ordered: boolean) {
  const name = `fx_replace_binding_${ordered ? "index" : "unique"}_maintenance`;
  const builds = ordered ? fxSystemIndexBuildStates : fxSystemUniqueConstraintBuilds;
  const obligations = ordered ? fxSystemIndexMaintenanceObligations : fxSystemUniqueMaintenanceObligations;
  const m = getTableColumns(obligations);
  const id = ordered ? fxSystemIndexBuildStates.indexDefinitionId : fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId;
  const maintenanceId = ordered ? fxSystemIndexMaintenanceObligations.indexDefinitionId : fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId;
  const frontier = ordered ? fxSystemIndexBuildStates.firstReadableCommitSeq : fxSystemUniqueConstraintBuilds.startCommitSeq;
  const openingFrontier = ordered ? fxSystemIndexMaintenanceObligations.firstReadableCommitSeq : fxSystemUniqueMaintenanceObligations.startCommitSeq;
  const refusal = (reason: "storedState" | "unavailable") => `RAISE EXCEPTION '${name}' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','${ordered ? "index" : "unique"}','reason','${reason}')::text;`;
  const ddl = `CREATE FUNCTION %1$I.${name}(
  p_scope text,p_expected_sequence bigint,p_expected_head text,p_incoming_sequence bigint,p_incoming_activation text,
  p_next_head text,p_candidate text,p_outgoing_deployment text,p_outgoing_schema text,p_outgoing_manifest text,p_outgoing_members jsonb,
  p_incoming_deployment text,p_incoming_schema text,p_incoming_manifest text,p_incoming_members jsonb)
RETURNS TABLE(closed_count integer,opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $binding_${ordered ? "index" : "unique"}_maintenance$
DECLARE live_clock ${relation(fxSystemScopeClocks)}; live_authority ${relation(fxSystemScopeExecutionAuthorities)};
  old_head ${relation(fxSystemDataBindingHeads)}; incoming ${relation(fxSystemDataBindingActivations)};
  candidate ${relation(fxSystemDataBindingCandidates)}; old_candidate ${relation(fxSystemDataBindingCandidates)};
  build ${relation(builds)}; opening ${relation(obligations)}; member_set record; requirement jsonb;
  incoming_member jsonb; outgoing_member jsonb; frame jsonb; old_frame jsonb; activation_frame jsonb;
  prior_id bigint; had_head boolean; maintenance_owned boolean; closed_total integer:=0; opened_total integer:=0;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope))=0 OR p_incoming_sequence IS NULL OR p_incoming_sequence<=0 OR
    p_incoming_activation IS NULL OR p_incoming_activation !~ '^[0-9a-f]{64}$' OR
    p_next_head IS NULL OR p_next_head !~ '^[0-9a-f]{64}$' OR p_candidate IS NULL OR p_candidate !~ '^[0-9a-f]{64}$' OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence<=0 OR p_expected_head IS NULL OR p_expected_head !~ '^[0-9a-f]{64}$'))
    THEN ${refusal("storedState")} END IF;
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_outgoing_members)>${ordered ? 512 : 256} OR jsonb_array_length(p_incoming_members)>${ordered ? 512 : 256}
    THEN ${refusal("storedState")} END IF;
  FOR member_set IN SELECT p_outgoing_members AS members UNION ALL SELECT p_incoming_members LOOP
    prior_id:=0;
    FOR requirement IN SELECT value FROM jsonb_array_elements(member_set.members) LOOP
      IF jsonb_typeof(requirement) IS DISTINCT FROM 'object' OR
        jsonb_typeof(requirement->'definitionId') IS DISTINCT FROM 'number' OR jsonb_typeof(requirement->'tableId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'physicalSpecSha256') IS DISTINCT FROM 'string' OR
        requirement->>'definitionId' !~ '^[1-9][0-9]{0,9}$' OR requirement->>'tableId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'physicalSpecSha256' !~ '^[0-9a-f]{64}$' OR
        (requirement->>'definitionId')::bigint>2147483647 OR (requirement->>'tableId')::bigint>2147483647 OR
        (requirement->>'definitionId')::bigint<=prior_id OR (SELECT count(*) FROM jsonb_object_keys(requirement))<>3
        THEN ${refusal("storedState")} END IF;
      prior_id:=(requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;
  SELECT * INTO live_clock FROM ${relation(fxSystemScopeClocks)} WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND THEN ${refusal("storedState")} END IF;
  SELECT * INTO live_authority FROM ${relation(fxSystemScopeExecutionAuthorities)} WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority.storage_generation IS DISTINCT FROM 'flarexdb_v1' OR
    live_authority.scope_id IS DISTINCT FROM live_clock.scope_id OR live_authority.epoch_uuid IS NULL
    THEN ${refusal("storedState")} END IF;
  SELECT * INTO old_head FROM ${relation(fxSystemDataBindingHeads)} WHERE scope_id=p_scope AND storage_generation=live_authority.storage_generation FOR UPDATE;
  had_head:=FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (old_head.sequence IS DISTINCT FROM p_expected_sequence OR old_head.sha256 IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR
      p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0)) THEN ${refusal("storedState")} END IF;
  maintenance_owned:=EXISTS(SELECT 1 FROM %1$I.fx_system_installation WHERE singleton_id=1 AND state='draining'
    AND maintenance_pid=pg_backend_pid() AND maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()));
  IF p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence,0)+1 AND
    NOT (maintenance_owned AND had_head AND p_incoming_sequence=p_expected_sequence AND p_next_head=p_expected_head)
    THEN ${refusal("storedState")} END IF;
  SELECT * INTO incoming FROM ${relation(fxSystemDataBindingActivations)} WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sequence=p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR incoming.sha256 IS DISTINCT FROM p_incoming_activation OR incoming.candidate_sha256 IS DISTINCT FROM p_candidate
    THEN ${refusal("storedState")} END IF;
  activation_frame:=convert_from(incoming.canonical_bytes,'UTF8')::jsonb;
  IF activation_frame->>'format' IS DISTINCT FROM 'flarex.data-binding-activation' OR
    activation_frame->>'sequence' IS DISTINCT FROM p_incoming_sequence::text OR
    activation_frame->'request'->>'scopeId' IS DISTINCT FROM p_scope OR
    activation_frame->'request'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    activation_frame->'request'->>'candidateSha256' IS DISTINCT FROM p_candidate OR
    (NOT maintenance_owned AND (CASE WHEN had_head THEN
      activation_frame->'request'->'expectedHead'->>'sequence' IS DISTINCT FROM p_expected_sequence::text OR
      activation_frame->'request'->'expectedHead'->>'sha256' IS DISTINCT FROM p_expected_head
      ELSE activation_frame->'request'->'expectedHead' IS DISTINCT FROM 'null'::jsonb END)) THEN ${refusal("storedState")} END IF;
  SELECT * INTO candidate FROM ${relation(fxSystemDataBindingCandidates)} WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sha256=p_candidate FOR SHARE;
  IF NOT FOUND THEN ${refusal("storedState")} END IF;
  frame:=convert_from(candidate.canonical_bytes,'UTF8')::jsonb;
  IF frame->>'format' IS DISTINCT FROM 'flarex.data-binding-set' OR frame->'application'->>'deploymentId' IS DISTINCT FROM p_incoming_deployment OR
    frame->'application'->>'scopeId' IS DISTINCT FROM p_scope OR frame->'application'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    (CASE WHEN frame->'logicalSchema'='null'::jsonb THEN p_incoming_schema IS NOT NULL OR p_incoming_manifest IS NOT NULL OR jsonb_array_length(p_incoming_members)<>0
      ELSE frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_incoming_schema OR
        frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_incoming_manifest OR p_incoming_manifest !~ '^[0-9a-f]{64}$' END)
    THEN ${refusal("storedState")} END IF;
  IF had_head THEN
    SELECT * INTO old_candidate FROM ${relation(fxSystemDataBindingCandidates)} WHERE scope_id=p_scope
      AND storage_generation=live_authority.storage_generation AND sha256=old_head.candidate_sha256 FOR SHARE;
    IF NOT FOUND THEN ${refusal("storedState")} END IF;
    old_frame:=convert_from(old_candidate.canonical_bytes,'UTF8')::jsonb;
    IF old_frame->'application'->>'deploymentId' IS DISTINCT FROM p_outgoing_deployment OR
      (CASE WHEN old_frame->'logicalSchema'='null'::jsonb THEN p_outgoing_schema IS NOT NULL OR p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0
        ELSE old_frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_outgoing_schema OR
          old_frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_outgoing_manifest END) THEN ${refusal("storedState")} END IF;
  END IF;
  IF (SELECT count(*) FROM ${relation(builds)} WHERE scope_id=p_scope AND ${column(id)} IN
    (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))<>jsonb_array_length(p_incoming_members)
    THEN ${refusal("unavailable")} END IF;
  FOR build IN SELECT * FROM ${relation(builds)} WHERE scope_id=p_scope AND
    (maintenance_authority_kind='binding' OR ${column(id)} IN (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY ${column(id)} FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer=build.${column(id)};
    IF build.lifecycle IS DISTINCT FROM 'enabled' OR build.storage_generation IS DISTINCT FROM live_authority.storage_generation OR
      build.storage_generation_fence IS DISTINCT FROM live_authority.storage_generation_fence OR build.epoch IS DISTINCT FROM live_authority.epoch OR
      build.${column(frontier)} IS NULL OR build.covered_through_commit_seq IS NULL OR build.${column(frontier)}>build.covered_through_commit_seq OR
      build.covered_through_commit_seq>live_clock.last_commit_seq THEN ${refusal("unavailable")} END IF;
    IF build.maintenance_authority_kind IS NOT NULL THEN
      SELECT * INTO opening FROM ${relation(obligations)} WHERE scope_id=p_scope AND authority_kind=build.maintenance_authority_kind
        AND ${column(maintenanceId)}=build.${column(id)} AND activation_sequence=build.maintenance_activation_sequence;
      IF NOT FOUND OR opening.storage_generation IS DISTINCT FROM build.storage_generation OR
        opening.storage_generation_fence IS DISTINCT FROM build.storage_generation_fence OR opening.epoch IS DISTINCT FROM build.epoch OR
        opening.attempt_fence IS DISTINCT FROM build.attempt_fence OR opening.opened_commit_seq IS DISTINCT FROM build.covered_through_commit_seq OR
        opening.${column(openingFrontier)} IS DISTINCT FROM build.${column(frontier)} THEN ${refusal("storedState")} END IF;
      IF incoming_member IS NOT NULL AND (opening.table_id IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')) THEN ${refusal("storedState")} END IF;
      IF build.maintenance_authority_kind='application' THEN CONTINUE; END IF;
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members) WHERE (value->>'definitionId')::integer=build.${column(id)};
      IF NOT had_head OR outgoing_member IS NULL OR opening.activation_sequence IS DISTINCT FROM p_expected_sequence OR
        opening.head_sha256 IS DISTINCT FROM decode(p_expected_head,'hex') OR opening.activation_sha256 IS DISTINCT FROM decode(old_head.activation_sha256,'hex') OR
        opening.candidate_sha256 IS DISTINCT FROM decode(old_head.candidate_sha256,'hex') OR
        opening.deployment_id IS DISTINCT FROM p_outgoing_deployment OR opening.schema_version_id IS DISTINCT FROM p_outgoing_schema OR
        opening.schema_manifest_sha256 IS DISTINCT FROM decode(p_outgoing_manifest,'hex') OR
        opening.table_id IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') THEN ${refusal("storedState")} END IF;
      IF maintenance_owned AND p_incoming_sequence=p_expected_sequence THEN CONTINUE; END IF;
    ELSIF incoming_member IS NOT NULL AND build.covered_through_commit_seq<live_clock.last_commit_seq AND EXISTS (
      SELECT 1 FROM ${relation(fxAppRowCurrent)} WHERE scope_uuid=live_clock.scope_uuid AND table_id=(incoming_member->>'tableId')::integer
        AND commit_seq>build.covered_through_commit_seq) THEN ${refusal("unavailable")} END IF;
    IF incoming_member IS NOT NULL THEN
      INSERT INTO ${relation(obligations)} (${[m.scopeId,m.authorityKind,maintenanceId,m.activationSequence,m.storageGeneration,
        m.storageGenerationFence,m.epoch,m.attemptFence,openingFrontier,m.openedCommitSeq,m.tableId,m.physicalSpecSha256,m.deploymentId,
        m.schemaVersionId,m.schemaManifestSha256,m.activationSha256,m.headSha256,m.candidateSha256].map(column).join(",")}) VALUES
        (p_scope,'binding',build.${column(id)},p_incoming_sequence,build.storage_generation,build.storage_generation_fence,build.epoch,
          build.attempt_fence,build.${column(frontier)},live_clock.last_commit_seq,(incoming_member->>'tableId')::integer,
          decode(incoming_member->>'physicalSpecSha256','hex'),p_incoming_deployment,p_incoming_schema,decode(p_incoming_manifest,'hex'),
          decode(p_incoming_activation,'hex'),decode(p_next_head,'hex'),decode(p_candidate,'hex'));
      UPDATE ${relation(builds)} SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind='binding',
        maintenance_activation_sequence=p_incoming_sequence,updated_at=clock_timestamp() WHERE scope_id=p_scope AND ${column(id)}=build.${column(id)};
      opened_total:=opened_total+1;
    ELSE
      UPDATE ${relation(builds)} SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind=NULL,
        maintenance_activation_sequence=NULL,updated_at=clock_timestamp() WHERE scope_id=p_scope AND ${column(id)}=build.${column(id)};
      closed_total:=closed_total+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total,opened_total;
END
$binding_${ordered ? "index" : "unique"}_maintenance$;`;
  return { name, signature, ddl, delimiter: `$binding_${ordered ? "index" : "unique"}_maintenance$`, inputs,
    outputs: ["closed_count","opened_count"], outputTypes: ["integer","integer"] };
}
export const BINDING_MAINTENANCE_PUBLISHER_FUNCTIONS = [publisher(true),publisher(false)];
