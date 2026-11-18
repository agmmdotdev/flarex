/** Shared native predicates for installed finite and ordinary acceptance.
 * The accepting owners bind these exact locals; profile-specific liveness,
 * generation, availability and coverage policy remain with those owners. */
export const INDEX_BUILD_INTRINSIC_VALIDITY_SQL = `build_row.cursor_codec_version = 1
          AND (build_row.maintenance_authority_kind IS NULL) = (build_row.maintenance_activation_sequence IS NULL)
          AND (build_row.maintenance_authority_kind IS NULL OR build_row.maintenance_authority_kind IN ('application','binding'))
          AND build_row.scope_id = p_scope_id
          AND build_row.index_definition_id = p_index_definition_id
          AND build_row.index_definition_id > 0
          AND build_row.storage_generation = 'flarexdb_v1'
          AND build_row.storage_generation_fence > 0
          AND length(build_row.epoch) > 0
          AND build_row.start_commit_seq >= 0
          AND (build_row.covered_through_commit_seq IS NULL OR build_row.covered_through_commit_seq >= 0)
          AND (build_row.first_readable_commit_seq IS NULL OR build_row.first_readable_commit_seq >= 0 AND build_row.covered_through_commit_seq IS NOT NULL AND build_row.first_readable_commit_seq <= build_row.covered_through_commit_seq)
          AND build_row.lifecycle IN ('declared','building','backfilling','validating','enabled','retiring')
          AND (build_row.backfill_cursor_row_id IS NULL OR octet_length(build_row.backfill_cursor_row_id) = 16)
          AND (build_row.lifecycle NOT IN ('declared','building') OR build_row.backfill_cursor_row_id IS NULL)
          AND build_row.attempt_fence > 0
          AND isfinite(build_row.created_at)
          AND isfinite(build_row.updated_at)
          AND abs(floor(extract(epoch FROM build_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM build_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM build_row.updated_at)*1000) >= floor(extract(epoch FROM build_row.created_at)*1000)`;
export const INDEX_MAINTENANCE_OPENING_VALIDITY_SQL = `index_maintenance.activation_sequence > 0
          AND index_maintenance.authority_kind = build_row.maintenance_authority_kind
          AND index_maintenance.authority_kind IN ('application','binding')
          AND (index_maintenance.authority_kind = 'application' AND index_maintenance.candidate_sha256 IS NULL
            OR index_maintenance.authority_kind = 'binding' AND octet_length(index_maintenance.candidate_sha256) = 32)
          AND index_maintenance.storage_generation = 'flarexdb_v1'
          AND index_maintenance.storage_generation_fence > 0
          AND length(index_maintenance.epoch) > 0
          AND index_maintenance.opened_commit_seq >= 0
          AND index_maintenance.table_id > 0
          AND octet_length(index_maintenance.physical_spec_sha256) = 32
          AND length(index_maintenance.deployment_id) > 0
          AND length(index_maintenance.schema_version_id) > 0
          AND octet_length(index_maintenance.activation_sha256) = 32
          AND octet_length(index_maintenance.head_sha256) = 32
          AND index_maintenance.index_definition_id > 0
          AND index_maintenance.attempt_fence > 0
          AND index_maintenance.first_readable_commit_seq >= 0
          AND index_maintenance.first_readable_commit_seq <= index_maintenance.opened_commit_seq
          AND octet_length(index_maintenance.schema_manifest_sha256) = 32
          AND build_row.lifecycle = 'enabled'
          AND index_maintenance.activation_sequence = build_row.maintenance_activation_sequence
          AND index_maintenance.scope_id = build_row.scope_id
          AND index_maintenance.index_definition_id = build_row.index_definition_id
          AND index_maintenance.storage_generation = build_row.storage_generation
          AND index_maintenance.storage_generation_fence = build_row.storage_generation_fence
          AND index_maintenance.epoch = build_row.epoch
          AND index_maintenance.attempt_fence = build_row.attempt_fence
          AND index_maintenance.first_readable_commit_seq = build_row.first_readable_commit_seq
          AND index_maintenance.opened_commit_seq = build_row.covered_through_commit_seq`;
