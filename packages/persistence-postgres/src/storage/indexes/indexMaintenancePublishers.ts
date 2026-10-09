import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { fxAppRowCurrent, fxSystemApplicationReadinessV1, fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations, fxSystemScopeClocks, fxSystemScopeExecutionAuthorities,
  fxSystemUniqueConstraintBuilds, fxSystemUniqueMaintenanceObligations } from "../../database/schema";
import { fxSystemApplicationReadiness } from "../../application/relations/applicationRelationSchema";
import { fxSystemApplicationActivations, fxSystemApplicationActiveHeads } from "../../application/applicationActivationSchema";

const dialect = new PgDialect();
const identifier = (name: string) => dialect.sqlToQuery(sql`${sql.identifier(name)}`).sql;
const relation = (table: PgTable) => `%1$I.${identifier(getTableName(table))}`;
const column = (value: PgColumn) => identifier(value.name);
const clocks = relation(fxSystemScopeClocks), authorities = relation(fxSystemScopeExecutionAuthorities);
const activations = relation(fxSystemApplicationActivations), heads = relation(fxSystemApplicationActiveHeads);
const legacyReadiness = relation(fxSystemApplicationReadinessV1), readiness = relation(fxSystemApplicationReadiness);
const currentRows = relation(fxAppRowCurrent);
const c = getTableColumns(fxSystemScopeClocks), a = getTableColumns(fxSystemScopeExecutionAuthorities);
const h = getTableColumns(fxSystemApplicationActiveHeads), v = getTableColumns(fxSystemApplicationActivations);
const r = getTableColumns(fxSystemApplicationReadinessV1), rows = getTableColumns(fxAppRowCurrent);

/** Shared local activation-history proof. Remote catalog membership is supplied
 * only by the authenticated activation principal and its original outer issuer. */
function activationProof(operation: string, domain: "index" | "unique"): string {
  const refusal = (reason: "storedState" | "unavailable") =>
    `RAISE EXCEPTION '${operation}' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','${domain}','reason','${reason}')::text;`;
  const manifest = domain === "index" ? `OR ready_root.${column(r.schemaManifestSha256)} IS DISTINCT FROM p_incoming_manifest` : "";
  const outgoingManifest = domain === "index" ? `OR ready_root.${column(r.schemaManifestSha256)} IS DISTINCT FROM p_outgoing_manifest` : "";
  return `
  IF p_scope IS NULL OR length(btrim(p_scope)) = 0 OR p_incoming_sequence IS NULL OR p_incoming_sequence <= 0 OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence <= 0 OR p_expected_sequence = 9223372036854775807)) OR
    octet_length(p_incoming_activation) IS DISTINCT FROM 32 OR octet_length(p_next_head) IS DISTINCT FROM 32 OR
    (p_expected_sequence IS NOT NULL AND octet_length(p_expected_head) IS DISTINCT FROM 32)
    THEN ${refusal("storedState")} END IF;
  SELECT * INTO live_authority FROM ${authorities} WHERE ${column(a.scopeId)} = p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority.${column(a.storageGeneration)} <> 'flarexdb_v1' THEN ${refusal("storedState")} END IF;
  SELECT * INTO live_clock FROM ${clocks} WHERE ${column(c.scopeId)} = p_scope FOR UPDATE;
  IF NOT FOUND THEN ${refusal("storedState")} END IF;
  SELECT * INTO outgoing_head FROM ${heads} WHERE ${column(h.scopeId)} = p_scope FOR UPDATE;
  had_head := FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (outgoing_head.${column(h.activationSequence)} IS DISTINCT FROM p_expected_sequence OR
      outgoing_head.${column(h.headSha256)} IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR jsonb_array_length(p_outgoing_members) <> 0))
    THEN ${refusal("storedState")} END IF;
  IF had_head THEN
    SELECT * INTO prior_activation FROM ${activations} WHERE ${column(v.scopeId)} = p_scope
      AND ${column(v.activationSequence)} = p_expected_sequence FOR SHARE;
    IF NOT FOUND OR prior_activation.${column(v.revisionId)} IS DISTINCT FROM outgoing_head.${column(h.revisionId)} OR
      prior_activation.${column(v.activationSha256)} IS DISTINCT FROM outgoing_head.${column(h.activationSha256)} OR
      prior_activation.${column(v.readinessContractVersion)} IS DISTINCT FROM outgoing_head.${column(h.readinessContractVersion)} OR
      prior_activation.${column(v.readinessSha256)} IS DISTINCT FROM outgoing_head.${column(h.readinessSha256)} OR
      prior_activation.${column(v.relationSetReadinessSha256)} IS DISTINCT FROM outgoing_head.${column(h.relationSetReadinessSha256)} OR
      prior_activation.${column(v.relationCount)} IS DISTINCT FROM outgoing_head.${column(h.relationCount)} OR
      prior_activation.${column(v.writePolicySetSha256)} IS DISTINCT FROM outgoing_head.${column(h.writePolicySetSha256)} OR
      prior_activation.${column(v.writeOwnershipSha256)} IS DISTINCT FROM outgoing_head.${column(h.writeOwnershipSha256)}
      THEN ${refusal("storedState")} END IF;
    IF prior_activation.${column(v.readinessContractVersion)} = 1 THEN
      SELECT * INTO ready_root FROM ${legacyReadiness} WHERE ${column(r.scopeId)} = p_scope
        AND ${column(r.revisionId)} = prior_activation.${column(v.revisionId)}
        AND ${column(r.readinessSha256)} = prior_activation.${column(v.readinessSha256)} FOR SHARE;
    ELSE
      SELECT * INTO ready_root FROM ${readiness} WHERE ${column(r.scopeId)} = p_scope
        AND ${column(r.revisionId)} = prior_activation.${column(v.revisionId)}
        AND ${column(r.readinessSha256)} = prior_activation.${column(v.readinessSha256)} FOR SHARE;
    END IF;
    IF NOT FOUND OR ready_root.${column(r.deploymentId)} IS DISTINCT FROM p_outgoing_deployment OR
      ready_root.${column(r.schemaVersionId)} IS DISTINCT FROM p_outgoing_schema ${outgoingManifest}
      THEN ${refusal("storedState")} END IF;
  END IF;
  SELECT * INTO incoming_activation FROM ${activations} WHERE ${column(v.scopeId)} = p_scope
    AND ${column(v.activationSequence)} = p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence, 0) + 1 OR
    incoming_activation.${column(v.previousActivationSequence)} IS DISTINCT FROM p_expected_sequence OR
    incoming_activation.${column(v.activationSha256)} IS DISTINCT FROM p_incoming_activation OR
    octet_length(p_next_head) IS DISTINCT FROM 32 THEN ${refusal("storedState")} END IF;
  IF incoming_activation.${column(v.readinessContractVersion)} = 1 THEN
    SELECT * INTO ready_root FROM ${legacyReadiness} WHERE ${column(r.scopeId)} = p_scope
      AND ${column(r.revisionId)} = incoming_activation.${column(v.revisionId)}
      AND ${column(r.readinessSha256)} = incoming_activation.${column(v.readinessSha256)} FOR SHARE;
  ELSE
    SELECT * INTO ready_root FROM ${readiness} WHERE ${column(r.scopeId)} = p_scope
      AND ${column(r.revisionId)} = incoming_activation.${column(v.revisionId)}
      AND ${column(r.readinessSha256)} = incoming_activation.${column(v.readinessSha256)} FOR SHARE;
  END IF;
  IF NOT FOUND OR ready_root.${column(r.deploymentId)} IS DISTINCT FROM p_incoming_deployment OR
    ready_root.${column(r.schemaVersionId)} IS DISTINCT FROM p_incoming_schema OR
    ready_root.${column(r.storageGeneration)} IS DISTINCT FROM live_authority.${column(a.storageGeneration)} OR
    ready_root.${column(r.storageGenerationFence)} IS DISTINCT FROM live_authority.${column(a.storageGenerationFence)} OR
    ready_root.${column(r.epoch)} IS DISTINCT FROM live_authority.${column(a.epoch)} ${manifest}
    THEN ${refusal("storedState")} END IF;`;
}

/** These two fixed functions share generation mechanics, never a runtime table
 * selector or executable instruction contract. Each owns its domain ordering. */
function fixedPublisher(domain: "index" | "unique"): string {
  const ordered = domain === "index";
  const operation = ordered ? "fx_replace_active_index_maintenance" : "fx_replace_active_unique_maintenance";
  const builds = relation(ordered ? fxSystemIndexBuildStates : fxSystemUniqueConstraintBuilds);
  const obligations = relation(ordered ? fxSystemIndexMaintenanceObligations : fxSystemUniqueMaintenanceObligations);
  const b = getTableColumns(ordered ? fxSystemIndexBuildStates : fxSystemUniqueConstraintBuilds);
  const o = getTableColumns(ordered ? fxSystemIndexMaintenanceObligations : fxSystemUniqueMaintenanceObligations);
  const definition = ordered ? fxSystemIndexBuildStates.indexDefinitionId : fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId;
  const obligationDefinition = ordered ? fxSystemIndexMaintenanceObligations.indexDefinitionId : fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId;
  const frontier = ordered ? fxSystemIndexBuildStates.firstReadableCommitSeq : fxSystemUniqueConstraintBuilds.startCommitSeq;
  const openingFrontier = ordered ? fxSystemIndexMaintenanceObligations.firstReadableCommitSeq : fxSystemUniqueMaintenanceObligations.startCommitSeq;
  const refusal = (reason: "storedState" | "unavailable") =>
    `RAISE EXCEPTION '${operation}' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','${domain}','reason','${reason}')::text;`;
  const memberValidation = `
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array'
    THEN ${refusal("storedState")} END IF;
  IF jsonb_array_length(p_outgoing_members) > ${ordered ? 512 : 256} OR jsonb_array_length(p_incoming_members) > ${ordered ? 512 : 256}
    THEN ${refusal("storedState")} END IF;
  FOR member_set IN SELECT p_outgoing_members AS members UNION ALL SELECT p_incoming_members LOOP
    prior_id := 0;
    FOR requirement IN SELECT value FROM jsonb_array_elements(member_set.members) LOOP
      IF jsonb_typeof(requirement) IS DISTINCT FROM 'object' OR
        jsonb_typeof(requirement->'definitionId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'tableId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'physicalSpecSha256') IS DISTINCT FROM 'string' OR
        requirement->>'definitionId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'tableId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'physicalSpecSha256' !~ '^[0-9a-f]{64}$' OR
        (requirement->>'definitionId')::bigint > 2147483647 OR (requirement->>'tableId')::bigint > 2147483647 OR
        (requirement->>'definitionId')::bigint <= prior_id OR
        (SELECT count(*) FROM jsonb_object_keys(requirement)) <> 3
        THEN ${refusal("storedState")} END IF;
      prior_id := (requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;`;
  const validateBuild = `
    IF build.${column(b.lifecycle)} <> 'enabled' OR build.${column(b.storageGeneration)} IS DISTINCT FROM live_authority.${column(a.storageGeneration)} OR
      build.${column(b.storageGenerationFence)} IS DISTINCT FROM live_authority.${column(a.storageGenerationFence)} OR
      build.${column(b.epoch)} IS DISTINCT FROM live_authority.${column(a.epoch)} OR
      build.${column(frontier)} IS NULL OR build.${column(b.coveredThroughCommitSeq)} IS NULL OR
      build.${column(frontier)} > build.${column(b.coveredThroughCommitSeq)} OR build.${column(b.coveredThroughCommitSeq)} > live_clock.${column(c.lastCommitSeq)}
      THEN ${refusal("unavailable")} END IF;`;
  const validateOutgoing = `
    IF build.${column(b.maintenanceActivationSequence)} IS NOT NULL THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build.${column(definition)};
      IF NOT FOUND OR NOT had_head THEN ${refusal("storedState")} END IF;
      SELECT * INTO opening FROM ${obligations} WHERE ${column(o.scopeId)} = p_scope
        AND ${column(obligationDefinition)} = build.${column(definition)}
        AND ${column(o.activationSequence)} = build.${column(b.maintenanceActivationSequence)};
      IF NOT FOUND OR opening.${column(o.activationSequence)} IS DISTINCT FROM p_expected_sequence OR
        opening.${column(o.deploymentId)} IS DISTINCT FROM p_outgoing_deployment OR opening.${column(o.schemaVersionId)} IS DISTINCT FROM p_outgoing_schema OR
        opening.${column(o.headSha256)} IS DISTINCT FROM p_expected_head OR
        opening.${column(o.activationSha256)} IS DISTINCT FROM outgoing_head.${column(h.activationSha256)} OR
        opening.${column(o.tableId)} IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening.${column(o.physicalSpecSha256)} IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') OR
        opening.${column(o.storageGeneration)} IS DISTINCT FROM build.${column(b.storageGeneration)} OR
        opening.${column(o.storageGenerationFence)} IS DISTINCT FROM build.${column(b.storageGenerationFence)} OR
        opening.${column(o.epoch)} IS DISTINCT FROM build.${column(b.epoch)} OR
        opening.${column(o.attemptFence)} IS DISTINCT FROM build.${column(b.attemptFence)} OR
        opening.${column(o.openedCommitSeq)} IS DISTINCT FROM build.${column(b.coveredThroughCommitSeq)} OR
        opening.${column(openingFrontier)} IS DISTINCT FROM build.${column(frontier)}
        ${ordered ? `OR opening.${column(fxSystemIndexMaintenanceObligations.schemaManifestSha256)} IS DISTINCT FROM p_outgoing_manifest` : ""}
        THEN ${refusal("storedState")} END IF;
    END IF;`;
  const validateIncoming = `
    IF incoming_member IS NOT NULL THEN
      IF build.${column(b.maintenanceActivationSequence)} IS NOT NULL THEN
        IF opening.${column(o.tableId)} IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
          opening.${column(o.physicalSpecSha256)} IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')
          THEN ${refusal("storedState")} END IF;
      ELSIF build.${column(b.coveredThroughCommitSeq)} < live_clock.${column(c.lastCommitSeq)} AND EXISTS (
        SELECT 1 FROM ${currentRows} WHERE ${column(rows.scopeUuid)} = live_clock.${column(c.scopeUuid)}
          AND ${column(rows.tableId)} = (incoming_member->>'tableId')::integer
          AND ${column(rows.commitSeq)} > build.${column(b.coveredThroughCommitSeq)}) THEN ${refusal("unavailable")} END IF;
    END IF;`;
  const orderedValidation = `
  FOR build IN SELECT * FROM ${builds} WHERE ${column(b.scopeId)} = p_scope AND ${column(b.maintenanceActivationSequence)} IS NOT NULL
    ORDER BY ${column(definition)} FOR UPDATE LOOP ${validateBuild} ${validateOutgoing} END LOOP;
  FOR incoming_member IN SELECT value FROM jsonb_array_elements(p_incoming_members) LOOP
    SELECT * INTO build FROM ${builds} WHERE ${column(b.scopeId)} = p_scope AND ${column(definition)} = (incoming_member->>'definitionId')::integer FOR UPDATE;
    IF NOT FOUND THEN ${refusal("unavailable")} END IF;
    ${validateBuild} ${validateOutgoing} ${validateIncoming}
  END LOOP;`;
  const uniqueValidation = `
  IF (SELECT count(*) FROM ${builds} WHERE ${column(b.scopeId)} = p_scope AND ${column(definition)} IN
    (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members))) <> jsonb_array_length(p_incoming_members)
    THEN ${refusal("unavailable")} END IF;
  FOR build IN SELECT * FROM ${builds} WHERE ${column(b.scopeId)} = p_scope AND
    (${column(b.maintenanceActivationSequence)} IS NOT NULL OR ${column(definition)} IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY ${column(definition)} FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build.${column(definition)};
    ${validateBuild} ${validateOutgoing} ${validateIncoming}
  END LOOP;`;
  const writeColumns = [o.scopeId, obligationDefinition, o.activationSequence, o.storageGeneration, o.storageGenerationFence,
    o.epoch, o.attemptFence, openingFrontier, o.openedCommitSeq, o.tableId, o.physicalSpecSha256, o.deploymentId,
    o.schemaVersionId, ...(ordered ? [fxSystemIndexMaintenanceObligations.schemaManifestSha256] : []), o.activationSha256, o.headSha256];
  return `CREATE FUNCTION %1$I.${operation}(
  p_scope text, p_expected_sequence bigint, p_expected_head bytea, p_incoming_sequence bigint,
  p_incoming_activation bytea, p_next_head bytea, p_outgoing_deployment text, p_outgoing_schema text,
  ${ordered ? "p_outgoing_manifest bytea," : ""} p_outgoing_members jsonb,
  p_incoming_deployment text, p_incoming_schema text, ${ordered ? "p_incoming_manifest bytea," : ""} p_incoming_members jsonb)
RETURNS TABLE(closed_count integer, opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $${domain}_maintenance_publisher$
DECLARE live_clock ${clocks}; live_authority ${authorities}; outgoing_head ${heads};
  prior_activation ${activations}; incoming_activation ${activations}; ready_root record;
  build ${builds}; opening ${obligations}; member_set record; requirement jsonb;
  outgoing_member jsonb; incoming_member jsonb; prior_id bigint; had_head boolean;
  closed_total integer := 0; opened_total integer := 0;
BEGIN
  ${memberValidation}
  ${activationProof(operation, domain)}
  ${ordered ? orderedValidation : uniqueValidation}
  FOR build IN SELECT * FROM ${builds} WHERE ${column(b.scopeId)} = p_scope AND
    (${column(b.maintenanceActivationSequence)} IS NOT NULL OR ${column(definition)} IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY ${column(definition)} FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build.${column(definition)};
    IF incoming_member IS NOT NULL THEN
      INSERT INTO ${obligations} (${writeColumns.map(column).join(",")}) VALUES (
        p_scope, build.${column(definition)}, p_incoming_sequence, build.${column(b.storageGeneration)},
        build.${column(b.storageGenerationFence)}, build.${column(b.epoch)}, build.${column(b.attemptFence)},
        build.${column(frontier)}, live_clock.${column(c.lastCommitSeq)}, (incoming_member->>'tableId')::integer,
        decode(incoming_member->>'physicalSpecSha256','hex'), p_incoming_deployment, p_incoming_schema,
        ${ordered ? "p_incoming_manifest," : ""} p_incoming_activation, p_next_head);
      UPDATE ${builds} SET ${column(b.coveredThroughCommitSeq)} = live_clock.${column(c.lastCommitSeq)},
        ${column(b.maintenanceActivationSequence)} = p_incoming_sequence, ${column(b.updatedAt)} = clock_timestamp()
        WHERE ${column(b.scopeId)} = p_scope AND ${column(definition)} = build.${column(definition)};
      opened_total := opened_total + 1;
    ELSE
      UPDATE ${builds} SET ${column(b.coveredThroughCommitSeq)} = live_clock.${column(c.lastCommitSeq)},
        ${column(b.maintenanceActivationSequence)} = NULL, ${column(b.updatedAt)} = clock_timestamp()
        WHERE ${column(b.scopeId)} = p_scope AND ${column(definition)} = build.${column(definition)};
      closed_total := closed_total + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total, opened_total;
END
$${domain}_maintenance_publisher$;`;
}

export const INDEX_MAINTENANCE_PUBLISHER_SQL = fixedPublisher("index");
export const UNIQUE_MAINTENANCE_PUBLISHER_SQL = fixedPublisher("unique");
export const INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS = [
  { name: "fx_replace_active_index_maintenance", signature: "text,bigint,bytea,bigint,bytea,bytea,text,text,bytea,jsonb,text,text,bytea,jsonb",
    ddl: INDEX_MAINTENANCE_PUBLISHER_SQL, delimiter: "$index_maintenance_publisher$",
    inputs: ["p_scope", "p_expected_sequence", "p_expected_head", "p_incoming_sequence", "p_incoming_activation", "p_next_head",
      "p_outgoing_deployment", "p_outgoing_schema", "p_outgoing_manifest", "p_outgoing_members", "p_incoming_deployment", "p_incoming_schema", "p_incoming_manifest", "p_incoming_members"],
    outputs: ["closed_count", "opened_count"], outputTypes: ["integer", "integer"], result: "record" },
  { name: "fx_replace_active_unique_maintenance", signature: "text,bigint,bytea,bigint,bytea,bytea,text,text,jsonb,text,text,jsonb",
    ddl: UNIQUE_MAINTENANCE_PUBLISHER_SQL, delimiter: "$unique_maintenance_publisher$",
    inputs: ["p_scope", "p_expected_sequence", "p_expected_head", "p_incoming_sequence", "p_incoming_activation", "p_next_head",
      "p_outgoing_deployment", "p_outgoing_schema", "p_outgoing_members", "p_incoming_deployment", "p_incoming_schema", "p_incoming_members"],
    outputs: ["closed_count", "opened_count"], outputTypes: ["integer", "integer"], result: "record" },
] as const;
