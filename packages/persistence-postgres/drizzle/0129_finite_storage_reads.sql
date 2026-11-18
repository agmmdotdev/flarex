-- Fixed historical reads are shared by ordinary transactions and finite captures.
-- No durable rows, body formats or recovery records change.
DO $$ DECLARE gate fx_system_installation; BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id = 1;
  IF NOT pg_try_advisory_xact_lock(2147483002, (gate.namespace_oid - 2147483648)::integer) THEN
    RAISE EXCEPTION 'finite storage migration requires installation quiescence' USING ERRCODE = '55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state = 'draining' AND gate.maintenance_pid = pg_backend_pid()
    AND gate.maintenance_backend_start = (SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite storage migration requires its managed maintenance owner' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_application_ownership_manifest(p_scope_id text, p_revision_id text,
      p_remaining_records integer, p_remaining_bytes integer)
    RETURNS TABLE("evidenceLength" integer, bytes bytea, hash bytea, "publicationHash" bytea,
      "analysisHash" bytea, "deploymentId" text, "schemaVersionId" text)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_id IS NULL OR p_revision_id IS NULL OR p_remaining_records IS NULL OR p_remaining_bytes IS NULL
        OR p_remaining_records < 0 OR p_remaining_records > 64 OR p_remaining_bytes < 0 OR p_remaining_bytes > 1048576 THEN
        RAISE EXCEPTION 'invalid ownership manifest demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY SELECT octet_length(a.manifest_bytes),
        CASE WHEN p_remaining_records >= 1 AND octet_length(a.manifest_bytes) <= p_remaining_bytes
          THEN a.manifest_bytes ELSE NULL END,
        p.manifest_sha256,p.publication_sha256,a.manifest_sha256,p.deployment_id,p.schema_version_id
      FROM %1$I.fx_system_application_publication p
      JOIN %1$I.fx_system_application_analysis_v1 a ON a.scope_id=p.scope_id AND a.analysis_id=p.analysis_id
      WHERE p.scope_id=p_scope_id AND p.revision_id=p_revision_id LIMIT 1;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_application_ownership_manifest(text,text,integer,integer) FROM PUBLIC', target_schema);
END $$;
--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_snapshot_rows(p_scope_uuid uuid, p_table_id integer,
      p_row_ids bytea[], p_snapshot_commit_seq bigint, p_transfer_budget bigint, p_settlement_window boolean)
    RETURNS TABLE(ordinal integer, requested_row_id bytea, row_present boolean,
      scope_uuid uuid, table_id integer, row_id bytea, commit_seq_text text, prev_commit_seq_text text,
      write_epoch_uuid uuid, schema_version_id text, creation_time double precision,
      value_codec_version integer, is_tombstone boolean, value_sha256 bytea, value_bytes bytea, body_withheld boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_uuid IS NULL OR p_table_id IS NULL OR p_table_id < 1 OR p_row_ids IS NULL
        OR cardinality(p_row_ids) > 256 OR p_snapshot_commit_seq IS NULL OR p_snapshot_commit_seq < 0
        OR p_settlement_window IS NULL OR p_transfer_budget < 0 OR p_transfer_budget > 1048576
        OR EXISTS(SELECT 1 FROM unnest(p_row_ids) id WHERE id IS NULL OR octet_length(id) <> 16)
        OR cardinality(p_row_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_row_ids) id) THEN
        RAISE EXCEPTION 'invalid snapshot row demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY
      WITH selected AS MATERIALIZED (
        SELECT (requested.position - 1)::integer AS request_ordinal, requested.id AS requested_id, r.*
        FROM unnest(p_row_ids) WITH ORDINALITY requested(id, position)
        LEFT JOIN LATERAL (
          SELECT revision.* FROM %1$I.fx_app_row_rev revision
          WHERE revision.scope_uuid = p_scope_uuid AND revision.table_id = p_table_id
            AND revision.row_id = requested.id AND revision.commit_seq <= p_snapshot_commit_seq
          ORDER BY revision.commit_seq DESC LIMIT 1
        ) r ON true
      ), budgeted AS (
        SELECT selected.*, coalesce(sum(coalesce(octet_length(selected.value_bytes), 0))
          OVER (ORDER BY selected.request_ordinal ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS preceding_bytes
        FROM selected
      ), withheld AS (
        SELECT budgeted.*, CASE WHEN p_transfer_budget IS NULL THEN false
          WHEN p_settlement_window THEN preceding_bytes > 0
            AND preceding_bytes + coalesce(octet_length(budgeted.value_bytes), 0) > p_transfer_budget
          ELSE preceding_bytes > p_transfer_budget END AS withheld_body
        FROM budgeted
      )
      SELECT w.request_ordinal, w.requested_id, w.commit_seq IS NOT NULL,
        w.scope_uuid, w.table_id, w.row_id, w.commit_seq::text, w.prev_commit_seq::text,
        w.write_epoch_uuid, w.schema_version_id, w.creation_time, w.value_codec_version,
        w.is_tombstone, w.value_sha256,
        CASE WHEN w.withheld_body THEN NULL ELSE w.value_bytes END, w.withheld_body
      FROM withheld w ORDER BY w.request_ordinal;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean) FROM PUBLIC', target_schema);
END $$;
--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_snapshot_index_page(p_scope_uuid uuid, p_index_definition_id integer,
      p_snapshot_commit_seq bigint, p_start_inclusive bytea, p_end_exclusive bytea,
      p_after_key bytea, p_after_row_id bytea, p_limit integer)
    RETURNS TABLE(ordinal integer, table_id_text text, key_codec_version_text text,
      physical_spec_sha256 bytea, encoded_key_bytes bytea, key_sha256 bytea, row_id_bytes bytea,
      commit_seq_text text, is_tombstone boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_uuid IS NULL OR p_index_definition_id IS NULL OR p_index_definition_id < 1
        OR p_snapshot_commit_seq IS NULL OR p_snapshot_commit_seq < 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
        OR (p_after_key IS NULL) <> (p_after_row_id IS NULL)
        OR (p_after_row_id IS NOT NULL AND octet_length(p_after_row_id) <> 16) THEN
        RAISE EXCEPTION 'invalid snapshot index demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY
      WITH latest AS (
        SELECT DISTINCT ON (r.encoded_key, r.row_id) r.table_id, r.key_codec_version,
          r.physical_spec_sha256, r.encoded_key, r.key_sha256, r.row_id, r.commit_seq, r.is_tombstone
        FROM %1$I.fx_app_index_entry_rev r
        WHERE r.scope_uuid = p_scope_uuid AND r.index_definition_id = p_index_definition_id
          AND r.commit_seq <= p_snapshot_commit_seq
          AND (p_start_inclusive IS NULL OR r.encoded_key >= p_start_inclusive)
          AND (p_end_exclusive IS NULL OR r.encoded_key < p_end_exclusive)
          AND (p_after_key IS NULL OR (r.encoded_key, r.row_id) > (p_after_key, p_after_row_id))
        ORDER BY r.encoded_key, r.row_id, r.commit_seq DESC
      ), page AS MATERIALIZED (
        SELECT latest.* FROM latest WHERE NOT latest.is_tombstone
        ORDER BY latest.encoded_key, latest.row_id LIMIT p_limit + 1
      )
      SELECT (row_number() OVER (ORDER BY page.encoded_key, page.row_id) - 1)::integer,
        page.table_id::text, page.key_codec_version::text, page.physical_spec_sha256,
        page.encoded_key, page.key_sha256, page.row_id, page.commit_seq::text, page.is_tombstone
      FROM page ORDER BY page.encoded_key, page.row_id;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_application_write_ownership_snapshot(p_scope_id text,
      p_remaining_records integer, p_remaining_bytes integer)
    RETURNS TABLE(kind text, ordinal integer, "scopeId" text, "sequenceText" text, "previousSequenceText" text,
      "revisionId" text, "readinessContractVersion" integer, "relationCount" integer,
      "activatedAtText" text, "createdAtText" text, "updatedAtText" text,
      "evidenceLength" integer, "evidenceBytes" bytea, "evidenceSha256" bytea,
      "bodyWithheld" boolean, "readinessSha256" bytea, "relationSetReadinessSha256" bytea,
      "writePolicySetSha256" bytea, "writeOwnershipSha256" bytea, "activationSha256" bytea,
      "activationRequestSha256" bytea, "legacyReadinessSha256" bytea, "relationReadinessSha256" bytea)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_id IS NULL OR p_remaining_records IS NULL OR p_remaining_bytes IS NULL
        OR p_remaining_records < 0 OR p_remaining_records > 64 OR p_remaining_bytes < 0 OR p_remaining_bytes > 1048576 THEN
        RAISE EXCEPTION 'invalid ownership snapshot demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY

    with head as materialized (select * from %1$I.fx_system_application_active_head where scope_id = p_scope_id limit 1),
    current_activation as materialized (select a.* from %1$I.fx_system_application_activation a join head h
      on a.scope_id=h.scope_id and a.activation_sequence=h.activation_sequence),
    ownership as materialized (select * from %1$I.fx_system_application_write_ownership where scope_id=p_scope_id order by activation_sequence limit 65),
    historic_activation as materialized (select a.* from %1$I.fx_system_application_activation a join ownership o
      on a.scope_id=o.scope_id and a.activation_sequence=o.activation_sequence
      where not exists(select 1 from head h where h.activation_sequence=a.activation_sequence)
      order by a.activation_sequence limit 65),
    selected_activations as materialized (select * from current_activation union all select * from historic_activation),
    selected_readiness as materialized (select r.* from %1$I.fx_system_application_readiness r
      where r.scope_id=p_scope_id and exists(select 1 from ownership)
        and r.revision_id in (select revision_id from selected_activations) limit 65),
    evidence as materialized (
      select 0 as group_ordinal, 'head'::text as kind, 0::integer as ordinal,
        h.scope_id, h.activation_sequence::text as sequence_text, null::text as previous_sequence_text,
        h.revision_id, h.readiness_contract_version, h.relation_count, null::text as activated_at_text,
        h.created_at::text as created_at_text, h.updated_at::text as updated_at_text,
        octet_length(h.head_bytes)::integer as evidence_length, h.head_bytes as evidence_bytes, h.head_sha256 as evidence_sha256,
        h.readiness_sha256, h.relation_set_readiness_sha256, h.write_policy_set_sha256, h.write_ownership_sha256,
        h.activation_sha256, null::bytea as activation_request_sha256, null::bytea as legacy_readiness_sha256,
        null::bytea as relation_readiness_sha256 from head h
      union all
      select 0, 'headActivation', 0, a.scope_id, a.activation_sequence::text, a.previous_activation_sequence::text,
        a.revision_id,a.readiness_contract_version,a.relation_count,a.activated_at::text,null,null,
        octet_length(a.activation_bytes),a.activation_bytes,a.activation_sha256,
        a.readiness_sha256,a.relation_set_readiness_sha256,a.write_policy_set_sha256,a.write_ownership_sha256,
        a.activation_sha256,a.activation_request_sha256,a.legacy_readiness_sha256,a.relation_readiness_sha256 from current_activation a
      union all
      select 1, 'ownership', (row_number() over(order by o.activation_sequence)-1)::integer,
        o.scope_id,o.activation_sequence::text,null,null,null,null,null,null,null,
        octet_length(o.claims_bytes),o.claims_bytes,o.claims_sha256,null,null,null,null,null,null,null,null from ownership o
      union all
      select 2, 'activation', (row_number() over(order by a.activation_sequence)-1)::integer,
        a.scope_id,a.activation_sequence::text,a.previous_activation_sequence::text,
        a.revision_id,a.readiness_contract_version,a.relation_count,a.activated_at::text,null,null,
        octet_length(a.activation_bytes),a.activation_bytes,a.activation_sha256,
        a.readiness_sha256,a.relation_set_readiness_sha256,a.write_policy_set_sha256,a.write_ownership_sha256,
        a.activation_sha256,a.activation_request_sha256,a.legacy_readiness_sha256,a.relation_readiness_sha256 from historic_activation a
      union all
      select 3, 'readiness', (row_number() over(order by r.revision_id)-1)::integer,
        r.scope_id,null,null,r.revision_id,null,null,null,null,null,
        octet_length(r.readiness_bytes),r.readiness_bytes,r.readiness_sha256,null,null,null,null,null,null,null,null from selected_readiness r
    ), grouped as (select group_ordinal,sum(evidence_length) as bytes,count(*) as records from evidence group by group_ordinal),
    admitted as (select group_ordinal,
      sum(bytes) over(order by group_ordinal) <= p_remaining_bytes and sum(records) over(order by group_ordinal) <= p_remaining_records as bodies_admitted from grouped)
    select e.kind,e.ordinal,e.scope_id as "scopeId",e.sequence_text as "sequenceText",e.previous_sequence_text as "previousSequenceText",
      e.revision_id as "revisionId",e.readiness_contract_version as "readinessContractVersion",e.relation_count as "relationCount",
      e.activated_at_text as "activatedAtText",e.created_at_text as "createdAtText",e.updated_at_text as "updatedAtText",
      e.evidence_length as "evidenceLength",case when a.bodies_admitted then e.evidence_bytes else null end as "evidenceBytes",
      e.evidence_sha256 as "evidenceSha256",not a.bodies_admitted as "bodyWithheld",e.readiness_sha256 as "readinessSha256",
      e.relation_set_readiness_sha256 as "relationSetReadinessSha256",e.write_policy_set_sha256 as "writePolicySetSha256",
      e.write_ownership_sha256 as "writeOwnershipSha256",e.activation_sha256 as "activationSha256",
      e.activation_request_sha256 as "activationRequestSha256",e.legacy_readiness_sha256 as "legacyReadinessSha256",
      e.relation_readiness_sha256 as "relationReadinessSha256"
    from evidence e join admitted a using(group_ordinal) order by e.group_ordinal,e.kind,e.ordinal;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_application_write_ownership_snapshot(text,integer,integer) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_application_ownership_unique_closure(p_deployment_id text, p_schema_version_id text,
      p_remaining_records integer, p_remaining_bytes integer)
    RETURNS TABLE(kind text, ordinal integer, "evidenceLength" integer, "deploymentId" text, "schemaVersionId" text,
      "setCodecVersion" integer, "definitionCount" integer, "definitionSetSha256" bytea, "closedAtText" text,
      "uniqueConstraintDefinitionId" integer, "logicalUniqueConstraintId" integer, "tableId" integer,
      "physicalSpecCodecVersion" integer, "physicalSpecJson" jsonb, "physicalSpecBytes" bytea, "physicalSpecSha256" bytea,
      "definitionCreatedAtText" text, "bindingDefinitionId" integer, "bindingLogicalId" integer,
      "requiredForActivation" boolean, "bindingCreatedAtText" text)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_deployment_id IS NULL OR p_schema_version_id IS NULL OR p_remaining_records IS NULL OR p_remaining_bytes IS NULL
        OR p_remaining_records < 0 OR p_remaining_records > 64 OR p_remaining_bytes < 0 OR p_remaining_bytes > 1048576 THEN
        RAISE EXCEPTION 'invalid ownership unique closure demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY
      WITH selected AS MATERIALIZED (
        SELECT d.*,b.schema_version_id,b.unique_constraint_definition_id AS binding_definition_id,
          b.logical_unique_constraint_id AS binding_logical_id,b.required_for_activation,b.created_at AS binding_created_at,
          octet_length(d.physical_spec_bytes)+octet_length(d.physical_spec_json::text) AS evidence_length
        FROM %1$I.fx_control_schema_version_unique_constraint_binding b
        JOIN %1$I.fx_control_unique_constraint_definition d ON d.deployment_id=b.deployment_id
          AND d.unique_constraint_definition_id=b.unique_constraint_definition_id
          AND d.logical_unique_constraint_id=b.logical_unique_constraint_id
        WHERE b.deployment_id=p_deployment_id AND b.schema_version_id=p_schema_version_id
        ORDER BY d.unique_constraint_definition_id LIMIT 65
      ), budget AS (
        SELECT 1+count(*)*2 <= p_remaining_records AND 512+coalesce(sum(evidence_length+512),0) <= p_remaining_bytes AS admitted FROM selected
      ), evidence AS (
        SELECT 'closure'::text AS row_kind,0::integer AS row_ordinal,0::integer AS evidence_length,
          c.deployment_id,c.schema_version_id,c.set_codec_version,c.definition_count,c.definition_set_sha256,c.closed_at::text AS closed_at_text,
          null::integer AS unique_constraint_definition_id,null::integer AS logical_unique_constraint_id,null::integer AS table_id,
          null::integer AS physical_spec_codec_version,null::jsonb AS physical_spec_json,null::bytea AS physical_spec_bytes,
          null::bytea AS physical_spec_sha256,null::text AS definition_created_at_text,null::integer AS binding_definition_id,
          null::integer AS binding_logical_id,null::boolean AS required_for_activation,null::text AS binding_created_at_text
        FROM %1$I.fx_control_schema_unique_constraint_set c WHERE c.deployment_id=p_deployment_id AND c.schema_version_id=p_schema_version_id
        UNION ALL
        SELECT 'definition',(row_number() OVER(ORDER BY d.unique_constraint_definition_id)-1)::integer,d.evidence_length,
          d.deployment_id,d.schema_version_id,null,null,null,null,d.unique_constraint_definition_id,d.logical_unique_constraint_id,d.table_id,
          d.physical_spec_codec_version,CASE WHEN budget.admitted THEN d.physical_spec_json ELSE null END,
          CASE WHEN budget.admitted THEN d.physical_spec_bytes ELSE null END,d.physical_spec_sha256,d.created_at::text,
          d.binding_definition_id,d.binding_logical_id,d.required_for_activation,d.binding_created_at::text FROM selected d CROSS JOIN budget
      ) SELECT e.row_kind,e.row_ordinal,e.evidence_length,e.deployment_id,e.schema_version_id,e.set_codec_version,e.definition_count,
        e.definition_set_sha256,e.closed_at_text,e.unique_constraint_definition_id,e.logical_unique_constraint_id,e.table_id,
        e.physical_spec_codec_version,e.physical_spec_json,e.physical_spec_bytes,e.physical_spec_sha256,e.definition_created_at_text,
        e.binding_definition_id,e.binding_logical_id,e.required_for_activation,e.binding_created_at_text
      FROM evidence e ORDER BY e.row_kind,e.row_ordinal;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_application_ownership_unique_closure(text,text,integer,integer) FROM PUBLIC', target_schema);
END $$;
