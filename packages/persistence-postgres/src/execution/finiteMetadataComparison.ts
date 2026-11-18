import { getTableName, sql } from "drizzle-orm";
import { alias, PgDialect } from "drizzle-orm/pg-core";
import { fxSystemMetadataContractObservations } from "../database/schema";

const actual = alias(fxSystemMetadataContractObservations, "actual");

/** Fixed persistence-owned comparison installed with finite entry. The migration
 * formats only the managed namespace; expected metadata is always parameter data.
 * No catalogue reconstruction or digest substitute for canonical closure bytes. */
export const FINITE_METADATA_COMPARISON_FUNCTION_SQL = new PgDialect().sqlToQuery(sql`
CREATE FUNCTION %1$I.fx_compare_finite_metadata(p_scope_id text, p_watermark bigint, p_expected jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $metadata$
  WITH expected AS (
    SELECT element.ordinality - 1 AS ordinal, tuple.*
    FROM jsonb_array_elements(p_expected) WITH ORDINALITY AS element(value, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.value) AS tuple(
      namespace text, "ownerKey" text, "contractKey" text, present boolean,
      "semanticSha256Hex" text, "semanticBytesHex" text)
  ), compared AS (
    SELECT expected.ordinal,
      CASE
        WHEN p_watermark IS NOT NULL AND ${actual.lastChangedMetadataSequence} > p_watermark
          THEN 'writeConflict'
        WHEN expected.present AND (${actual.scopeId} IS NULL OR NOT ${actual.present}
          OR ${actual.semanticSha256Hex} IS DISTINCT FROM expected."semanticSha256Hex"
          OR (expected."semanticBytesHex" IS NOT NULL AND
            ${actual.semanticBytes} IS DISTINCT FROM decode(expected."semanticBytesHex", 'hex')))
          OR NOT expected.present AND ${actual.present} THEN 'projectionMissing'
        ELSE NULL
      END AS reason,
      CASE WHEN ${actual.scopeId} IS NULL THEN NULL ELSE jsonb_build_object(
        'present', ${actual.present}, 'semanticSha256Hex', ${actual.semanticSha256Hex},
        'lastChangedMetadataSequence', ${actual.lastChangedMetadataSequence}::text)
      END AS current_observation
    FROM expected LEFT JOIN ${sql.raw("%1$I")}.${sql.identifier(getTableName(fxSystemMetadataContractObservations))} actual
      ON ${actual.scopeId} = p_scope_id AND ${actual.namespace} = expected.namespace
        AND ${actual.ownerKey} = expected."ownerKey" AND ${actual.contractKey} = expected."contractKey"
  )
  SELECT coalesce((SELECT jsonb_build_object('reason', reason, 'ordinal', ordinal,
    'currentObservation', current_observation) FROM compared
    WHERE reason IS NOT NULL ORDER BY ordinal LIMIT 1), jsonb_build_object('reason', 'accepted'))
$metadata$;
`).sql;
