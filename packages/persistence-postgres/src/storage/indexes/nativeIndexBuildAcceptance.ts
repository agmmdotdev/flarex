import { bindingMaintenanceSelectionSql, bindingMaintenanceCaptureSql } from "../../installation/frameworkSchema/binding/maintenanceSelectionSql";
import { getTableName, sql } from "drizzle-orm";
import type { QueryPromise } from "drizzle-orm/query-promise";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { AppRowTransaction } from "../documents/appRows";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type { LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import { fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations, fxAppRowCurrent } from "../../database/schema";
import { nativeCompositeSelection } from "../../database/nativeCompositeSelection";
import type { CatalogIndexDefinitionId, CatalogTableId } from "flarex-protocol/catalog";
import type { ApplicationIndexCoveragePins } from "../../application/activeHead/identity";
import { INDEX_BUILD_INTRINSIC_VALIDITY_SQL, INDEX_MAINTENANCE_OPENING_VALIDITY_SQL } from "./indexBuildSqlPredicates";

/** A native canonical comparison key, never a replacement for context admission. */
const ordinaryActiveKeySql = (alias: string) => sql.raw(`jsonb_build_array(${alias}.deployment_id,
  ${alias}.schema_version_id,encode(${alias}.schema_manifest_sha256,'hex'),${alias}.activation_sequence::text,
  encode(${alias}.activation_sha256,'hex'),encode(${alias}.head_sha256,'hex'),${alias}.authority_kind,encode(${alias}.candidate_sha256,'hex'))::text`);

/** Native SHARE exclusion followed by input-ordinal acceptance. Successful
 * validation transports no build record; the first refusal retains the exact
 * native columns for the existing decoder and its original failure Cause. */
const parameter = (name: string) => sql`${sql.placeholder(name)}`;
function buildSelectedIndexBuildLockAcceptance(tx: FlarexMetadataDatabase, order: "input" | "definition") {
  const builds = fxSystemIndexBuildStates;
  const maintenance = fxSystemIndexMaintenanceObligations;
  const scope = parameter("scopeId");
  const lockOrder = order === "definition" ? sql`build_row.index_definition_id` : sql`requested.ordinal`;
  const source = sql`(with requested as materialized (
      select selected.p_index_definition_id, selected.ordinal, selected.access_kind
      from unnest(${parameter("definitionIds")}::integer[], ${parameter("accessKinds")}::text[])
        with ordinality selected(p_index_definition_id, access_kind, ordinal)
    ), locked as materialized (
      select build_row.* from ${builds} build_row join requested on build_row.index_definition_id=requested.p_index_definition_id
      where build_row.scope_id=${scope} order by ${lockOrder} for share of build_row
    ), observed as materialized (
      select requested.ordinal, requested.p_index_definition_id,
        case when build_row.scope_id is null then 'missing'
          when (${sql.raw(INDEX_BUILD_INTRINSIC_VALIDITY_SQL)}) is not true
            or (build_row.maintenance_activation_sequence is null) is distinct from (index_maintenance.scope_id is null)
            or (index_maintenance.scope_id is not null and (${sql.raw(INDEX_MAINTENANCE_OPENING_VALIDITY_SQL)}) is not true) then 'invalid'
          when build_row.storage_generation is distinct from ${parameter("storageGeneration")}
            or build_row.storage_generation_fence is distinct from ${parameter("storageGenerationFence")}
            or build_row.epoch is distinct from ${parameter("epoch")}
            or (${order === "definition"}::boolean and requested.access_kind<>'developer')
            or build_row.lifecycle='retiring' then 'unavailable'
          when build_row.start_commit_seq>${parameter("lastCommitSeq")}
            or build_row.covered_through_commit_seq>${parameter("lastCommitSeq")} then 'frontier'
          else 'accepted' end as reason,
        build_row::${sql.identifier(getTableName(builds))} as build, index_maintenance as maintenance
      from requested left join locked build_row on build_row.index_definition_id=requested.p_index_definition_id
      cross join (select ${scope}::text as p_scope_id) pins
      left join ${maintenance} index_maintenance on index_maintenance.scope_id=build_row.scope_id
        and index_maintenance.index_definition_id=build_row.index_definition_id
        and index_maintenance.authority_kind=build_row.maintenance_authority_kind
        and index_maintenance.activation_sequence=build_row.maintenance_activation_sequence
    ), refused as materialized (select * from observed where reason<>'accepted' order by ordinal limit 1)
    select reason, ordinal, p_index_definition_id, build, maintenance from refused
    union all select 'accepted'::text, null::bigint, null::integer,
      null::${sql.identifier(getTableName(builds))}, null::${sql.identifier(getTableName(maintenance))}
      where not exists(select 1 from refused)) observed`;
  return tx.select({
    reason: sql<string>`observed.reason`, ordinal: sql<string | null>`observed.ordinal::text`,
    indexDefinitionId: sql`observed.p_index_definition_id`.mapWith(builds.indexDefinitionId),
    build: nativeCompositeSelection(builds, "observed.build"),
    maintenance: nativeCompositeSelection(maintenance, "observed.maintenance"),
  }).from(source);
}

/** Ordinary writer readiness retains KEY SHARE identity locks and the original
 * availability phase. Complete coverage is computed under that same observation;
 * only the first refused native state crosses the driver boundary. */
function buildRequiredIndexBuildReadinessAcceptance(tx: FlarexMetadataDatabase) {
  const builds = fxSystemIndexBuildStates, maintenance = fxSystemIndexMaintenanceObligations;
  const scope = parameter("scopeId");
  const snapshot = parameter("lastCommitSeq");
  const source = sql`(with binding_pins as materialized (select ${scope}::text as binding_scope,${parameter("storageGeneration")}::text as binding_generation), binding_selection as materialized (select selected.* from binding_pins cross join lateral (${sql.raw(bindingMaintenanceCaptureSql("", "binding_scope", "binding_generation"))}) selected), requested as materialized (
    select selected.p_index_definition_id, selected.ordinal, selected.table_id,
      decode(selected.physical_spec_sha256_hex,'hex') as physical_spec_sha256
    from unnest(${parameter("definitionIds")}::integer[], ${parameter("tableIds")}::integer[],
      ${parameter("physicalSpecSha256Hexes")}::text[])
      with ordinality selected(p_index_definition_id, table_id, physical_spec_sha256_hex, ordinal)
  ), locked as materialized (
    select build_row.* from ${builds} build_row join requested on build_row.index_definition_id=requested.p_index_definition_id
    where build_row.scope_id=${scope} order by build_row.index_definition_id for key share of build_row
  ), needed_tables as materialized (
    select distinct requested.table_id from requested join locked build_row
      on build_row.index_definition_id=requested.p_index_definition_id
    where build_row.lifecycle='enabled' and build_row.maintenance_activation_sequence is null
      and build_row.covered_through_commit_seq<${snapshot} and build_row.first_readable_commit_seq<=${snapshot}
  ), frontiers as materialized (
    select needed_tables.table_id, latest.commit_seq from needed_tables
    left join lateral (select current_row.commit_seq from ${fxAppRowCurrent} current_row
      where current_row.scope_uuid=${parameter("scopeUuid")}::uuid and current_row.table_id=needed_tables.table_id
      order by current_row.commit_seq desc limit 1) latest on true
  ), observed as materialized (
    select requested.*, build_row::${sql.identifier(getTableName(builds))} as build,
      index_maintenance as maintenance, latest.commit_seq as table_frontier,
      case when build_row.scope_id is null then 'missing'
        when build_row.storage_generation is distinct from ${parameter("storageGeneration")}
          or build_row.storage_generation_fence is distinct from ${parameter("storageGenerationFence")}
          or build_row.epoch is distinct from ${parameter("epoch")} then 'stale'
        when build_row.lifecycle<>'enabled' then 'notEnabled' else null end as availability,
      case when (${sql.raw(INDEX_BUILD_INTRINSIC_VALIDITY_SQL)}) is not true
        or (build_row.maintenance_activation_sequence is null) is distinct from (index_maintenance.scope_id is null)
        or (index_maintenance.scope_id is not null and (${sql.raw(INDEX_MAINTENANCE_OPENING_VALIDITY_SQL)}) is not true) then 'invalid'
        when build_row.start_commit_seq>${snapshot} or build_row.covered_through_commit_seq>${snapshot} then 'frontier'
        when build_row.covered_through_commit_seq is null or build_row.first_readable_commit_seq is null
          or build_row.first_readable_commit_seq>${snapshot} then 'notCovered'
        when index_maintenance.scope_id is null and exists(select 1 from ${maintenance} required
          where required.scope_id=${scope} and required.authority_kind='binding'
            and required.activation_sequence=binding_selection.activation_sequence
            and required.index_definition_id=requested.p_index_definition_id
            and (${sql.raw(bindingMaintenanceSelectionSql("required"))}) is true) then 'maintenance'
        when index_maintenance.scope_id is not null and (
          index_maintenance.table_id is distinct from requested.table_id
          or index_maintenance.physical_spec_sha256 is distinct from requested.physical_spec_sha256
          or (index_maintenance.authority_kind='binding' and (${sql.raw(bindingMaintenanceSelectionSql("index_maintenance"))}) is not true)
          or (index_maintenance.authority_kind='application' and (${parameter("hasActive")}::boolean is not true
          or index_maintenance.deployment_id is distinct from ${parameter("deploymentId")}::text
          or index_maintenance.schema_version_id is distinct from ${parameter("schemaVersionId")}::text
          or index_maintenance.schema_manifest_sha256 is distinct from decode(${parameter("schemaManifestSha256")}::text,'hex')
          or index_maintenance.activation_sequence is distinct from ${parameter("activationSequence")}::bigint
          or index_maintenance.activation_sha256 is distinct from ${parameter("activationSha256")}::bytea
          or index_maintenance.head_sha256 is distinct from ${parameter("headSha256")}::bytea))) then 'maintenance'
        when index_maintenance.scope_id is not null or build_row.covered_through_commit_seq>=${snapshot} then 'accepted'
        when latest.commit_seq is not null and latest.commit_seq<1 then 'tableFrontier'
        when latest.commit_seq is null or latest.commit_seq<=build_row.covered_through_commit_seq then 'accepted'
        else 'notCovered' end as reason
    from requested left join locked build_row on build_row.index_definition_id=requested.p_index_definition_id
    cross join (select ${scope}::text as p_scope_id) pins
    left join ${maintenance} index_maintenance on index_maintenance.scope_id=build_row.scope_id
      and index_maintenance.index_definition_id=build_row.index_definition_id
      and index_maintenance.authority_kind=build_row.maintenance_authority_kind
        and index_maintenance.activation_sequence=build_row.maintenance_activation_sequence
    left join frontiers latest on latest.table_id=requested.table_id
    left join binding_selection on true
  ), unavailable as materialized (select 'availability'::text as phase, availability as verdict, observed.*
    from observed where availability is not null order by ordinal limit 1),
  refused as materialized (select 'coverage'::text as phase, reason as verdict, observed.*
    from observed where reason<>'accepted' and not exists(select 1 from unavailable) order by ordinal limit 1),
  verdict as (select phase, verdict, ordinal, p_index_definition_id, build, maintenance, table_frontier from unavailable
    union all select phase, verdict, ordinal, p_index_definition_id, build, maintenance, table_frontier from refused
    union all select 'coverage'::text,'accepted'::text,null::bigint,null::integer,
      null::${sql.identifier(getTableName(builds))},null::${sql.identifier(getTableName(maintenance))},null::bigint
      where not exists(select 1 from unavailable) and not exists(select 1 from refused))
  select * from verdict) observed`;
  return tx.select({ phase: sql<string>`observed.phase`, reason: sql<string>`observed.verdict`,
    ordinal: sql<string | null>`observed.ordinal::text`,
    indexDefinitionId: sql`observed.p_index_definition_id`.mapWith(builds.indexDefinitionId),
    tableFrontier: sql<string | null>`observed.table_frontier::text`,
    build: nativeCompositeSelection(builds, "observed.build"),
    maintenance: nativeCompositeSelection(maintenance, "observed.maintenance"),
  }).from(source);
}


const selectedBuildLockReads = {
  input: defineNativeMetadataRead(db => buildSelectedIndexBuildLockAcceptance(db, "input")),
  definition: defineNativeMetadataRead(db => buildSelectedIndexBuildLockAcceptance(db, "definition")),
};
const requiredIndexReadinessRead = defineNativeMetadataRead(buildRequiredIndexBuildReadinessAcceptance);
const clockBindings = (clock: ScopeClockRecord) => ({ scopeId: clock.scopeId,
  storageGeneration: clock.storageGeneration, storageGenerationFence: clock.storageGenerationFence.toString(),
  epoch: clock.epoch, lastCommitSeq: clock.lastCommitSeq.toString() });

/** Bind one original actual demand to the existing once-compiled native owner. */
export function prepareSelectedIndexBuildLockAcceptance(tx: AppRowTransaction, clock: ScopeClockRecord,
  definitions: readonly Pick<LocatedAppIndexDefinitionV1, "indexDefinitionId" | "access">[], order: "input" | "definition"
): QueryPromise<Awaited<ReturnType<ReturnType<typeof buildSelectedIndexBuildLockAcceptance>["execute"]>>> {
  return selectedBuildLockReads[order](tx, { ...clockBindings(clock),
    definitionIds: definitions.map(definition => definition.indexDefinitionId),
    accessKinds: definitions.map(definition => definition.access.kind) });
}

export function prepareRequiredIndexBuildReadinessAcceptance(
  tx: AppRowTransaction, clock: ScopeClockRecord,
  definitions: readonly Readonly<{ indexDefinitionId: CatalogIndexDefinitionId;
    tableId: CatalogTableId; physicalSpecSha256Hex: string }>[],
  active: ApplicationIndexCoveragePins | null, scopeUuid: string,
): QueryPromise<Awaited<ReturnType<ReturnType<typeof buildRequiredIndexBuildReadinessAcceptance>["execute"]>>> {
  return requiredIndexReadinessRead(tx, { ...clockBindings(clock), scopeUuid,
    definitionIds: definitions.map(definition => definition.indexDefinitionId),
    tableIds: definitions.map(definition => definition.tableId),
    physicalSpecSha256Hexes: definitions.map(definition => definition.physicalSpecSha256Hex),
    hasActive: active !== null, deploymentId: active?.deploymentId ?? null,
    schemaVersionId: active?.schemaVersionId ?? null,
    schemaManifestSha256: active?.schemaManifestSha256 ?? null,
    activationSequence: active?.activationSequence.toString() ?? null,
    activationSha256: active?.activationSha256 ?? null, headSha256: active?.headSha256 ?? null,
  });
}

/** The full KEY SHARE set is captured once. Healthy evidence is reduced to
 * preaccepted progress facts, not raw build records; it stays opaque text in the
 * continuation. Invalid records alone keep their native column codecs. */
function buildRequiredIndexBuildProgressCapture(tx: FlarexMetadataDatabase) {
  const builds = fxSystemIndexBuildStates, maintenance = fxSystemIndexMaintenanceObligations;
  const scope = parameter("scopeId");
  const source = sql`(with requested as materialized (
    select selected.p_index_definition_id, selected.table_id, selected.spec, selected.ordinal
    from unnest(${parameter("definitionIds")}::integer[],${parameter("tableIds")}::integer[],${parameter("specs")}::text[])
      with ordinality selected(p_index_definition_id,table_id,spec,ordinal)
  ), progress_locked as materialized (
    select build_row.* from ${builds} build_row join requested
      on build_row.index_definition_id=requested.p_index_definition_id
    where build_row.scope_id=${scope} order by build_row.index_definition_id for key share of build_row
  ), lock_completion as materialized (select count(*) as locked_count from progress_locked),
  observed as materialized (
    select requested.ordinal, requested.p_index_definition_id, lock_completion.locked_count,
      case when build_row.scope_id is null then 'missing'
        when build_row.storage_generation is distinct from ${parameter("storageGeneration")}
          or build_row.storage_generation_fence is distinct from ${parameter("storageGenerationFence")}
          or build_row.epoch is distinct from ${parameter("epoch")} then 'stale'
        when build_row.lifecycle is distinct from 'enabled' then 'notEnabled' else 'ready' end as availability,
      ((${sql.raw(INDEX_BUILD_INTRINSIC_VALIDITY_SQL)}) is true
        and (build_row.maintenance_activation_sequence is null) is not distinct from (index_maintenance.scope_id is null)
        and (index_maintenance.scope_id is null or (${sql.raw(INDEX_MAINTENANCE_OPENING_VALIDITY_SQL)}) is true)) as intrinsic,
      build_row::${sql.identifier(getTableName(builds))} as build,index_maintenance as maintenance,
      jsonb_build_array(build_row.start_commit_seq::text,build_row.covered_through_commit_seq::text,
        build_row.first_readable_commit_seq::text,
        index_maintenance.table_id=requested.table_id and encode(index_maintenance.physical_spec_sha256,'hex')=requested.spec,
        case when index_maintenance.scope_id is not null then ${ordinaryActiveKeySql("index_maintenance")} else null end) as progress
    from lock_completion cross join requested left join progress_locked build_row
      on build_row.index_definition_id=requested.p_index_definition_id
    cross join (select ${scope}::text as p_scope_id) pins
    left join ${maintenance} index_maintenance on index_maintenance.scope_id=build_row.scope_id
      and index_maintenance.index_definition_id=build_row.index_definition_id
      and index_maintenance.authority_kind=build_row.maintenance_authority_kind
        and index_maintenance.activation_sequence=build_row.maintenance_activation_sequence
  ), unavailable as materialized (select * from observed where availability<>'ready' order by ordinal limit 1),
  captured as materialized (select coalesce(jsonb_agg(case when intrinsic then progress else null end order by ordinal),'[]'::jsonb)::text as progress from observed),
  result as (
    select availability as reason,ordinal,p_index_definition_id,locked_count,(build).lifecycle, null::text as progress,build,maintenance from unavailable
    union all select 'captured',null::bigint,null::integer,lock_completion.locked_count,null::text,captured.progress,
      null::${sql.identifier(getTableName(builds))},null::${sql.identifier(getTableName(maintenance))}
      from captured cross join lock_completion where not exists(select 1 from unavailable)
    union all select 'invalid',ordinal,p_index_definition_id,locked_count,(build).lifecycle,null::text,build,maintenance
      from observed where not intrinsic and not exists(select 1 from unavailable)
  ) select * from result order by ordinal nulls first) observed`;
  return tx.select({
    reason: sql<string>`observed.reason`, ordinal: sql<string | null>`observed.ordinal::text`,
    lockedCount: sql<string>`observed.locked_count::text`, progress: sql<string | null>`observed.progress`,
    indexDefinitionId: sql`observed.p_index_definition_id`.mapWith(builds.indexDefinitionId),
    lifecycle: sql`observed.lifecycle`.mapWith(builds.lifecycle),
    rawBuild: nativeCompositeSelection(builds,"observed.build"),
    rawMaintenance: nativeCompositeSelection(maintenance,"observed.maintenance"),
  }).from(source);
}
const requiredIndexBuildProgressRead = defineNativeMetadataRead(buildRequiredIndexBuildProgressCapture);
export function prepareRequiredIndexBuildProgressCapture(tx: AppRowTransaction, clock: Pick<ScopeClockRecord,
  "scopeId" | "storageGeneration" | "storageGenerationFence" | "epoch">,
  definitions: readonly Readonly<{ indexDefinitionId: CatalogIndexDefinitionId; tableId: CatalogTableId; physicalSpecSha256Hex: string }>[],
): QueryPromise<Awaited<ReturnType<ReturnType<typeof buildRequiredIndexBuildProgressCapture>["execute"]>>> {
  return requiredIndexBuildProgressRead(tx,{ scopeId: clock.scopeId,storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence.toString(),epoch: clock.epoch,
    definitionIds: definitions.map(definition => definition.indexDefinitionId),
    tableIds: definitions.map(definition => definition.tableId),specs: definitions.map(definition => definition.physicalSpecSha256Hex) });
}
