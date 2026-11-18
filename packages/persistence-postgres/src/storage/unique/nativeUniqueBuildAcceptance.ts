import { getTableName,sql } from "drizzle-orm";
import type { QueryPromise } from "drizzle-orm/query-promise";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import { nativeCompositeSelection } from "../../database/nativeCompositeSelection";
import { fxSystemUniqueConstraintBuilds,fxSystemUniqueMaintenanceObligations } from "../../database/schema";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { AppRowTransaction } from "../documents/appRows";
import type { ScopeClockRecord } from "../../scope/scopeClock";

const parameter=(name:string)=>sql`${sql.placeholder(name)}`;
function buildUniqueReadinessCapture(db:FlarexMetadataDatabase,lock:"share"|"key share") {
  const builds=fxSystemUniqueConstraintBuilds,maintenance=fxSystemUniqueMaintenanceObligations;
  const source=sql`(with requested as materialized (
    select distinct on ((member.value->>'id')::integer) (member.value->>'id')::integer as id,
      (member.value->>'table_id')::integer as table_id,member.value->>'spec' as spec
      from jsonb_array_elements(${parameter("members")}::jsonb) with ordinality member(value,ordinal)
      order by (member.value->>'id')::integer,member.ordinal
  ), locked as materialized (
    select build_row.* from ${builds} build_row join requested on requested.id=build_row.unique_constraint_definition_id
    where build_row.scope_id=${parameter("scopeId")} order by build_row.unique_constraint_definition_id for ${sql.raw(lock)} of build_row
  ), observed as materialized (
    select build_row.unique_constraint_definition_id as id,build_row::${sql.identifier(getTableName(builds))} as build,
      unique_maintenance as maintenance,
      (build_row.scope_id=${parameter("scopeId")} and build_row.unique_constraint_definition_id>0
        and build_row.storage_generation='flarexdb_v1' and build_row.storage_generation_fence>0 and length(build_row.epoch)>0
        and build_row.start_commit_seq>=0 and (build_row.covered_through_commit_seq is null or build_row.covered_through_commit_seq>=build_row.start_commit_seq)
        and build_row.attempt_fence>0 and build_row.lifecycle in ('declared','building','backfilling','validating','enabled')
        and (build_row.cursor_row_id is null or octet_length(build_row.cursor_row_id)=16)
        and (build_row.lifecycle not in ('declared','building','enabled') or build_row.cursor_row_id is null)
        and (build_row.lifecycle not in ('declared','building') or build_row.covered_through_commit_seq is null)
        and (build_row.lifecycle<>'enabled' or build_row.covered_through_commit_seq is not null)
        and isfinite(build_row.created_at) and isfinite(build_row.updated_at)
        and abs(floor(extract(epoch from build_row.created_at)*1000))<=8640000000000000
        and abs(floor(extract(epoch from build_row.updated_at)*1000))<=8640000000000000
        and floor(extract(epoch from build_row.updated_at)*1000)>=floor(extract(epoch from build_row.created_at)*1000)
        AND (build_row.maintenance_authority_kind IS NULL) = (build_row.maintenance_activation_sequence IS NULL)
          AND (build_row.maintenance_authority_kind IS NULL OR build_row.maintenance_authority_kind IN ('application','binding'))
          and (build_row.maintenance_activation_sequence is null) is not distinct from (unique_maintenance.scope_id is null)
        and (unique_maintenance.scope_id is null or (
          unique_maintenance.scope_id=build_row.scope_id and unique_maintenance.unique_constraint_definition_id=build_row.unique_constraint_definition_id
          and unique_maintenance.authority_kind=build_row.maintenance_authority_kind
          and unique_maintenance.authority_kind in ('application','binding')
          and (unique_maintenance.authority_kind='application' and unique_maintenance.candidate_sha256 is null and unique_maintenance.schema_manifest_sha256 is null
            or unique_maintenance.authority_kind='binding' and octet_length(unique_maintenance.candidate_sha256)=32 and octet_length(unique_maintenance.schema_manifest_sha256)=32)
          and unique_maintenance.activation_sequence>0 and unique_maintenance.activation_sequence=build_row.maintenance_activation_sequence
          and unique_maintenance.storage_generation=build_row.storage_generation
          and unique_maintenance.storage_generation_fence=build_row.storage_generation_fence and unique_maintenance.epoch=build_row.epoch
          and unique_maintenance.start_commit_seq=build_row.start_commit_seq and unique_maintenance.attempt_fence=build_row.attempt_fence
          and unique_maintenance.opened_commit_seq=build_row.covered_through_commit_seq and unique_maintenance.start_commit_seq<=unique_maintenance.opened_commit_seq
          and unique_maintenance.table_id>0 and octet_length(unique_maintenance.physical_spec_sha256)=32
          and length(unique_maintenance.deployment_id)>0 and length(unique_maintenance.schema_version_id)>0
          and octet_length(unique_maintenance.activation_sha256)=32 and octet_length(unique_maintenance.head_sha256)=32
          and build_row.lifecycle='enabled'))) is true as intrinsic,
      jsonb_build_array(build_row.storage_generation=${parameter("generation")} and build_row.storage_generation_fence=${parameter("fence")}
        and build_row.epoch=${parameter("epoch")},build_row.lifecycle,build_row.start_commit_seq::text,
        build_row.covered_through_commit_seq::text,build_row.attempt_fence::text,
        unique_maintenance.table_id=requested.table_id and encode(unique_maintenance.physical_spec_sha256,'hex')=requested.spec,
        case when unique_maintenance.scope_id is not null then
          jsonb_build_array(unique_maintenance.deployment_id,unique_maintenance.schema_version_id,
            unique_maintenance.activation_sequence::text,encode(unique_maintenance.activation_sha256,'hex'),encode(unique_maintenance.head_sha256,'hex'),unique_maintenance.authority_kind,encode(unique_maintenance.candidate_sha256,'hex'),encode(unique_maintenance.schema_manifest_sha256,'hex'))::text
          else null end) as progress
    from locked build_row join requested on requested.id=build_row.unique_constraint_definition_id
    left join ${maintenance} unique_maintenance on unique_maintenance.scope_id=build_row.scope_id
      and unique_maintenance.unique_constraint_definition_id=build_row.unique_constraint_definition_id
      and unique_maintenance.authority_kind=build_row.maintenance_authority_kind
      and unique_maintenance.activation_sequence=build_row.maintenance_activation_sequence
  ), captured as materialized (
    select coalesce(jsonb_object_agg(id::text,case when intrinsic then progress else null end),'{}'::jsonb)::text as progress,
      count(*) as row_count,coalesce(bool_or(maintenance is not null),false) as has_maintenance from observed
  ), result as (
    select 'captured'::text as reason,null::integer as id,progress,row_count,has_maintenance,
      null::${sql.identifier(getTableName(builds))} as build,null::${sql.identifier(getTableName(maintenance))} as maintenance from captured
    union all select 'invalid',id,null::text,null::bigint,null::boolean,build,maintenance from observed where not intrinsic
  ) select * from result order by id nulls first) observed`;
  return db.select({reason:sql<string>`observed.reason`,definitionId:sql`observed.id`.mapWith(builds.uniqueConstraintDefinitionId),
    progress:sql<string|null>`observed.progress`,rowCount:sql<string|null>`observed.row_count::text`,hasMaintenance:sql<boolean|null>`observed.has_maintenance`,
    rawBuild:nativeCompositeSelection(builds,"observed.build"),rawMaintenance:nativeCompositeSelection(maintenance,"observed.maintenance"),
  }).from(source);
}
const captureUnique={share:defineNativeMetadataRead(db=>buildUniqueReadinessCapture(db,"share")),
  "key share":defineNativeMetadataRead(db=>buildUniqueReadinessCapture(db,"key share"))};
export const prepareUniqueReadinessCapture=(tx:AppRowTransaction,clock:ScopeClockRecord,members:readonly Readonly<{
  uniqueConstraintDefinitionId:number;tableId:number;physicalSpecSha256Hex:string;
}>[],lock:"share"|"key share"):QueryPromise<Awaited<ReturnType<ReturnType<typeof buildUniqueReadinessCapture>["execute"]>>>=>captureUnique[lock](tx,{scopeId:clock.scopeId,generation:clock.storageGeneration,fence:clock.storageGenerationFence.toString(),epoch:clock.epoch,
  members:JSON.stringify(members.map(member=>({id:member.uniqueConstraintDefinitionId,table_id:member.tableId,spec:member.physicalSpecSha256Hex})))});
