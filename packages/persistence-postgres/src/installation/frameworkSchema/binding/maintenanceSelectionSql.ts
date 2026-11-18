/** Correlate every consumed pin with the current immutable canonical frames.
 * The accepting source owner still authenticates the complete candidate schema,
 * strong references and current Application reference (verifyLogicalSchemaBindingInTransaction);
 * this projection cannot replace source admission. Passed Application pins cannot issue it. */
export function bindingMaintenanceCaptureSql(namespace: string, scope: string, generation: string): string {
  const table = (name: string) => `${namespace}${name}`;
  return `WITH selected AS MATERIALIZED (SELECT bh.*, ba.sha256 AS selected_activation_sha256,
      ba.canonical_bytes AS activation_bytes, ba.request_id AS selected_request_id, bc.canonical_bytes AS candidate_bytes,
      bc.sha256 AS selected_candidate_sha256 FROM ${table("fx_system_data_binding_head")} bh
    JOIN ${table("fx_system_data_binding_activation")} ba ON ba.scope_id=bh.scope_id
      AND ba.storage_generation=bh.storage_generation AND ba.sequence=bh.sequence
      AND ba.sha256=bh.activation_sha256 AND ba.candidate_sha256=bh.candidate_sha256
    JOIN ${table("fx_system_data_binding_candidate")} bc ON bc.scope_id=bh.scope_id
      AND bc.storage_generation=bh.storage_generation AND bc.sha256=bh.candidate_sha256
    WHERE bh.scope_id=${scope} AND bh.storage_generation=${generation}
      AND octet_length(bh.canonical_bytes)=bh.canonical_byte_length AND bh.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(ba.canonical_bytes)=ba.canonical_byte_length AND ba.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(bc.canonical_bytes)=bc.canonical_byte_length AND bc.canonical_byte_length BETWEEN 1 AND 1048576
      AND pg_catalog.sha256(bh.canonical_bytes)=decode(bh.sha256,'hex')
      AND pg_catalog.sha256(ba.canonical_bytes)=decode(ba.sha256,'hex')
      AND pg_catalog.sha256(bc.canonical_bytes)=decode(bc.sha256,'hex')),
    frames AS MATERIALIZED (SELECT selected.*,
      pg_catalog.convert_from(canonical_bytes,'UTF8')::jsonb AS head_frame,
      pg_catalog.convert_from(activation_bytes,'UTF8')::jsonb AS activation_frame,
      pg_catalog.convert_from(candidate_bytes,'UTF8')::jsonb AS candidate_frame FROM selected)
    SELECT candidate_frame->'application'->>'deploymentId' AS deployment_id,
      candidate_frame->'logicalSchema'->>'schemaVersionId' AS schema_version_id,
      decode(candidate_frame->'logicalSchema'->>'manifestSha256','hex') AS schema_manifest_sha256,
      sequence AS activation_sequence,decode(sha256,'hex') AS head_sha256,
      decode(selected_activation_sha256,'hex') AS activation_sha256,
      decode(selected_candidate_sha256,'hex') AS candidate_sha256 FROM frames
    WHERE head_frame->>'format'='flarex.data-binding-head' AND head_frame->>'version'='2'
      AND head_frame->>'scopeId'=scope_id AND head_frame->>'storageGeneration'=storage_generation
      AND head_frame->>'sequence'=sequence::text AND head_frame->>'candidateSha256'=candidate_sha256
      AND head_frame->>'activationSha256'=selected_activation_sha256
      AND activation_frame->>'format'='flarex.data-binding-activation' AND activation_frame->>'version' IN ('2','3')
      AND activation_frame->>'sequence'=sequence::text AND activation_frame->'request'->>'scopeId'=scope_id
      AND activation_frame->'request'->>'format'='flarex.data-binding-activation-request'
      AND activation_frame->'request'->>'version'='1' AND activation_frame->'request'->>'requestId'=selected_request_id
      AND activation_frame->'request'->>'storageGeneration'=storage_generation
      AND activation_frame->'request'->>'candidateSha256'=candidate_sha256
      AND candidate_frame->>'format'='flarex.data-binding-set' AND candidate_frame->'logicalSchema' IS NOT NULL
      AND candidate_frame->'logicalSchema' <> 'null'::jsonb`;
}

/** Compare one obligation with the once-captured current binding projection. */
export function bindingMaintenanceSelectionSql(alias: string, selected = "binding_selection"): string {
  return `${selected}.activation_sequence=${alias}.activation_sequence
    AND ${selected}.head_sha256=${alias}.head_sha256 AND ${selected}.activation_sha256=${alias}.activation_sha256
    AND ${selected}.candidate_sha256=${alias}.candidate_sha256 AND ${selected}.deployment_id=${alias}.deployment_id
    AND ${selected}.schema_version_id=${alias}.schema_version_id AND ${selected}.schema_manifest_sha256=${alias}.schema_manifest_sha256`;
}
