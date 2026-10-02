-- Additive cutover. Existing activations require explicit verified maintenance
-- backfill before their standalone hosts can use this profile.
CREATE TABLE "fx_system_application_read_binding" (
  "scope_id" text NOT NULL,
  "activation_sequence" bigint NOT NULL,
  "revision_id" text NOT NULL,
  "readiness_contract_version" integer NOT NULL,
  "readiness_sha256" bytea NOT NULL,
  "activation_sha256" bytea NOT NULL,
  "binding_sha256" bytea NOT NULL,
  "binding_bytes" bytea NOT NULL,
  CONSTRAINT "fx_application_read_binding_pk" PRIMARY KEY ("scope_id", "activation_sequence"),
  CONSTRAINT "fx_application_read_binding_activation_fk" FOREIGN KEY
    ("scope_id", "activation_sequence", "revision_id", "readiness_contract_version", "readiness_sha256", "activation_sha256")
    REFERENCES "fx_system_application_activation"
    ("scope_id", "activation_sequence", "revision_id", "readiness_contract_version", "readiness_sha256", "activation_sha256") ON DELETE RESTRICT,
  CONSTRAINT "fx_application_read_binding_bounds" CHECK ("activation_sequence" > 0
    AND octet_length("binding_bytes") BETWEEN 1 AND 16384 AND octet_length("binding_sha256") = 32
    AND octet_length("readiness_sha256") = 32 AND octet_length("activation_sha256") = 32)
);
--> statement-breakpoint
DO $$
DECLARE installation_schema text := current_schema();
BEGIN
  EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_application_active_head FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_invalidate_prepared_metadata()', installation_schema);
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_application_read_binding FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', installation_schema);
  EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_application_read_binding FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_invalidate_prepared_metadata()', installation_schema);
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_publish_application_read_binding(p_bytes bytea, p_sha256 bytea)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE
      supplied jsonb; expected jsonb; parent jsonb; parent_bytes bytea; parent_row jsonb;
      head_frame jsonb; activation_frame jsonb; roots jsonb;
      canonical_analysis text; canonical_readiness text; canonical_binding text;
      gate %1$I.fx_system_installation;
      active %1$I.fx_system_application_active_head;
      activation %1$I.fx_system_application_activation;
      readiness jsonb; prior %1$I.fx_system_application_read_binding;
    BEGIN
      -- Enter before any parent/scope lock. Serving admission remains closed
      -- while draining; only the exact dedicated maintenance backend backfills.
      IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(2147483002,
        (SELECT (i.namespace_oid - 2147483648)::integer FROM %1$I.fx_system_installation i WHERE singleton_id = 1)) THEN
        RAISE EXCEPTION 'Installation maintenance admission is busy' USING ERRCODE = '55P03';
      END IF;
      SELECT i.* INTO STRICT gate FROM %1$I.fx_system_installation i
        WHERE singleton_id = 1 FOR SHARE NOWAIT;
      IF gate.database_name <> current_database() OR gate.schema_name <> %2$L
        OR gate.namespace_oid <> %2$L::pg_catalog.regnamespace::oid::bigint
        OR NOT (gate.state = 'active' OR (gate.state = 'draining'
          AND gate.maintenance_pid = pg_backend_pid()
          AND gate.maintenance_backend_start = (SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid()))) THEN
        RAISE EXCEPTION 'Installation is not active' USING ERRCODE = '55000';
      END IF;
      IF octet_length(p_bytes) NOT BETWEEN 1 AND 16384 OR octet_length(p_sha256) <> 32
        OR pg_catalog.sha256(p_bytes) <> p_sha256 THEN
        RAISE EXCEPTION 'invalid application read binding' USING ERRCODE = '22000';
      END IF;
      supplied := pg_catalog.convert_from(p_bytes, 'UTF8')::jsonb;
      PERFORM 1 FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = supplied->>'scopeId' FOR KEY SHARE;
      SELECT h.* INTO STRICT active FROM %1$I.fx_system_application_active_head h
        WHERE h.scope_id = supplied->>'scopeId' FOR SHARE;
      SELECT a.* INTO STRICT activation FROM %1$I.fx_system_application_activation a
        WHERE a.scope_id = active.scope_id AND a.activation_sequence = active.activation_sequence FOR SHARE;
      IF activation.revision_id <> active.revision_id OR activation.readiness_sha256 <> active.readiness_sha256
        OR activation.activation_sha256 <> active.activation_sha256
        OR activation.readiness_contract_version <> active.readiness_contract_version
        OR pg_catalog.sha256(activation.activation_bytes) <> activation.activation_sha256
        OR pg_catalog.sha256(active.head_bytes) <> active.head_sha256 THEN
        RAISE EXCEPTION 'invalid application activation roots' USING ERRCODE = '22000';
      END IF;
      IF activation.readiness_contract_version = 1 THEN
        SELECT r.readiness_bytes, to_jsonb(r) || pg_catalog.jsonb_build_object(
          'application_schema_sha256', pg_catalog.encode(r.application_schema_sha256, 'hex'),
          'schema_manifest_sha256', pg_catalog.encode(r.schema_manifest_sha256, 'hex'),
          'manifest_sha256', pg_catalog.encode(r.manifest_sha256, 'hex'),
          'source_artifact_root_sha256', pg_catalog.encode(r.source_artifact_root_sha256, 'hex'),
          'schema_binding_sha256', pg_catalog.encode(r.schema_binding_sha256, 'hex'))
        INTO STRICT parent_bytes, parent_row FROM %1$I.fx_system_application_readiness_v1 r
          WHERE r.scope_id = activation.scope_id AND r.revision_id = activation.revision_id
            AND r.readiness_sha256 = activation.readiness_sha256 FOR SHARE;
      ELSE
        SELECT r.readiness_bytes, to_jsonb(r) || pg_catalog.jsonb_build_object(
          'application_schema_sha256', pg_catalog.encode(r.application_schema_sha256, 'hex'),
          'schema_manifest_sha256', pg_catalog.encode(r.schema_manifest_sha256, 'hex'),
          'manifest_sha256', pg_catalog.encode(r.manifest_sha256, 'hex'),
          'source_artifact_root_sha256', pg_catalog.encode(r.source_artifact_root_sha256, 'hex'),
          'manifest_schema_binding_sha256', pg_catalog.encode(r.manifest_schema_binding_sha256, 'hex'),
          'bound_publication_sha256', pg_catalog.encode(r.bound_publication_sha256, 'hex'),
          'relation_set_readiness_sha256', pg_catalog.encode(r.relation_set_readiness_sha256, 'hex'))
        INTO STRICT parent_bytes, parent_row FROM %1$I.fx_system_application_readiness r
          WHERE r.scope_id = activation.scope_id AND r.revision_id = activation.revision_id
            AND r.readiness_sha256 = activation.readiness_sha256 FOR SHARE;
      END IF;
      IF pg_catalog.sha256(parent_bytes) <> activation.readiness_sha256 THEN
        RAISE EXCEPTION 'invalid application readiness root' USING ERRCODE = '22000';
      END IF;
      parent := pg_catalog.convert_from(parent_bytes, 'UTF8')::jsonb;
      -- Authenticate the bounded projection against authoritative parent
      -- columns. A valid digest alone does not correlate body and row identity.
      IF parent->>'format' IS DISTINCT FROM 'flarex.application-readiness'
        OR parent->>'scopeId' IS DISTINCT FROM activation.scope_id
        OR parent->>'revisionId' IS DISTINCT FROM activation.revision_id
        OR parent->>'status' IS DISTINCT FROM 'ready'
        OR parent->>'deploymentId' IS DISTINCT FROM parent_row->>'deployment_id'
        OR parent->>'storageGeneration' IS DISTINCT FROM parent_row->>'storage_generation'
        OR parent->>'storageGeneration' IS DISTINCT FROM 'flarexdb_v1'
        OR parent->>'storageGenerationFence' IS DISTINCT FROM parent_row->>'storage_generation_fence'
        OR parent->>'epoch' IS DISTINCT FROM parent_row->>'epoch'
        OR parent->>'schemaVersionId' IS DISTINCT FROM parent_row->>'schema_version_id'
        OR parent->>'candidateId' IS DISTINCT FROM parent_row->>'candidate_id'
        OR parent->>'analysisId' IS DISTINCT FROM parent_row->>'analysis_id'
        OR parent->>'applicationSchemaSha256' IS DISTINCT FROM parent_row->>'application_schema_sha256'
        OR parent->>'schemaManifestSha256' IS DISTINCT FROM parent_row->>'schema_manifest_sha256'
        OR parent->>'manifestSha256' IS DISTINCT FROM parent_row->>'manifest_sha256'
        OR parent->>'sourceArtifactRootSha256' IS DISTINCT FROM parent_row->>'source_artifact_root_sha256' THEN
        RAISE EXCEPTION 'invalid application readiness identity' USING ERRCODE = '22000';
      END IF;
      roots := pg_catalog.jsonb_build_object('format', 'flarex.application-active-head',
        'version', activation.readiness_contract_version, 'scopeId', activation.scope_id,
        'activationSequence', activation.activation_sequence::text, 'revisionId', activation.revision_id,
        'readinessSha256', pg_catalog.encode(activation.readiness_sha256, 'hex'),
        'activationSha256', pg_catalog.encode(activation.activation_sha256, 'hex'));
      IF activation.readiness_contract_version <> 1 THEN
        roots := roots || pg_catalog.jsonb_build_object('readinessContractVersion', activation.readiness_contract_version,
          'relationSetReadinessSha256', pg_catalog.encode(activation.relation_set_readiness_sha256, 'hex'),
          'relationCount', activation.relation_count);
      END IF;
      IF activation.readiness_contract_version = 3 THEN
        roots := roots || pg_catalog.jsonb_build_object('writePolicySetSha256', pg_catalog.encode(activation.write_policy_set_sha256, 'hex'),
          'writeOwnershipSha256', pg_catalog.encode(activation.write_ownership_sha256, 'hex'));
      END IF;
      head_frame := pg_catalog.convert_from(active.head_bytes, 'UTF8')::jsonb;
      activation_frame := pg_catalog.convert_from(activation.activation_bytes, 'UTF8')::jsonb;
      IF head_frame IS DISTINCT FROM roots
        OR activation_frame IS DISTINCT FROM ((roots - 'activationSha256') || pg_catalog.jsonb_build_object(
          'format', 'flarex.application-activation', 'previousActivationSequence', activation.previous_activation_sequence::text,
          'activationRequestSha256', pg_catalog.encode(activation.activation_request_sha256, 'hex'),
          'activatedAt', activation_frame->>'activatedAt'))
        OR (activation_frame->>'activatedAt')::timestamptz IS DISTINCT FROM activation.activated_at THEN
        RAISE EXCEPTION 'invalid application activation identity' USING ERRCODE = '22000';
      END IF;
      IF activation.readiness_contract_version = 1 THEN
        IF parent->>'version' IS DISTINCT FROM '1'
          OR parent->>'schemaBindingSha256' IS DISTINCT FROM parent_row->>'schema_binding_sha256' THEN
          RAISE EXCEPTION 'invalid legacy readiness projection' USING ERRCODE = '22000';
        END IF;
        readiness := pg_catalog.jsonb_build_object('kind', 'legacy', 'schemaBindingSha256', parent->>'schemaBindingSha256');
      ELSE
        IF parent->>'version' IS DISTINCT FROM parent_row->>'readiness_codec_version'
          OR parent->>'manifestSchemaBindingSha256' IS DISTINCT FROM parent_row->>'manifest_schema_binding_sha256'
          OR parent->>'boundPublicationSha256' IS DISTINCT FROM parent_row->>'bound_publication_sha256'
          OR parent #>> '{relationSet,frontierCommitSeq}' IS DISTINCT FROM parent_row->>'relation_frontier_commit_seq'
          OR parent #>> '{relationSet,readinessSha256}' IS DISTINCT FROM pg_catalog.encode(activation.relation_set_readiness_sha256, 'hex')
          OR parent #>> '{relationSet,relationCount}' IS DISTINCT FROM activation.relation_count::text
          OR parent_row->>'relation_set_readiness_sha256' IS DISTINCT FROM pg_catalog.encode(activation.relation_set_readiness_sha256, 'hex')
          OR parent_row->>'relation_count' IS DISTINCT FROM activation.relation_count::text THEN
          RAISE EXCEPTION 'invalid relation readiness projection' USING ERRCODE = '22000';
        END IF;
        readiness := pg_catalog.jsonb_build_object('kind', CASE WHEN activation.readiness_contract_version = 3 THEN 'policy' ELSE 'relation' END,
          'manifestSchemaBindingSha256', parent->>'manifestSchemaBindingSha256',
          'boundPublicationSha256', parent->>'boundPublicationSha256',
          'relationFrontierCommitSeq', parent #>> '{relationSet,frontierCommitSeq}',
          'relationSetReadinessSha256', pg_catalog.encode(activation.relation_set_readiness_sha256, 'hex'),
          'relationCount', activation.relation_count);
        IF activation.readiness_contract_version = 3 THEN
          IF parent->>'writePolicySetSha256' IS DISTINCT FROM pg_catalog.encode(activation.write_policy_set_sha256, 'hex')
            OR parent->>'writeOwnershipSha256' IS DISTINCT FROM pg_catalog.encode(activation.write_ownership_sha256, 'hex') THEN
            RAISE EXCEPTION 'invalid policy readiness projection' USING ERRCODE = '22000';
          END IF;
          readiness := readiness || pg_catalog.jsonb_build_object('writePolicySetSha256', pg_catalog.encode(activation.write_policy_set_sha256, 'hex'),
            'writeOwnershipSha256', pg_catalog.encode(activation.write_ownership_sha256, 'hex'));
        END IF;
      END IF;
      expected := pg_catalog.jsonb_build_object('format', 'flarex.application.read-binding',
        'deploymentId', parent->>'deploymentId', 'scopeId', activation.scope_id,
        'storageGeneration', parent->>'storageGeneration', 'storageGenerationFence', parent->>'storageGenerationFence', 'epoch', parent->>'epoch',
        'activationSequence', activation.activation_sequence::text, 'headSha256', pg_catalog.encode(active.head_sha256, 'hex'),
        'activationSha256', pg_catalog.encode(activation.activation_sha256, 'hex'), 'revisionId', activation.revision_id,
        'schemaVersionId', parent->>'schemaVersionId', 'applicationSchemaSha256', parent->>'applicationSchemaSha256',
        'schemaManifestSha256', parent->>'schemaManifestSha256', 'readinessSha256', pg_catalog.encode(activation.readiness_sha256, 'hex'),
        'readiness', readiness, 'analysis', pg_catalog.jsonb_build_object('candidateId', parent->>'candidateId',
          'analysisId', parent->>'analysisId', 'manifestSha256', parent->>'manifestSha256', 'sourceArtifactRootSha256', parent->>'sourceArtifactRootSha256'));
      IF supplied IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'application read binding is not parent derived' USING ERRCODE = '22000';
      END IF;
      -- This contract has two flat nested maps and protocol-owned ASCII keys.
      -- Serialize only that bounded shape in the same order as the canonical
      -- TypeScript codec. Never accept immutable rows that readers must reject.
      SELECT '{' || pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text || ':' || value::text, ',' ORDER BY key COLLATE "C") || '}'
        INTO canonical_analysis FROM pg_catalog.jsonb_each(expected->'analysis');
      SELECT '{' || pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text || ':' || value::text, ',' ORDER BY key COLLATE "C") || '}'
        INTO canonical_readiness FROM pg_catalog.jsonb_each(expected->'readiness');
      SELECT '{' || pg_catalog.string_agg(pg_catalog.to_jsonb(key)::text || ':' || CASE key
        WHEN 'analysis' THEN canonical_analysis WHEN 'readiness' THEN canonical_readiness ELSE value::text END,
        ',' ORDER BY key COLLATE "C") || '}' INTO canonical_binding FROM pg_catalog.jsonb_each(expected);
      IF pg_catalog.convert_to(canonical_binding, 'UTF8') IS DISTINCT FROM p_bytes THEN
        RAISE EXCEPTION 'application read binding is not canonical' USING ERRCODE = '22000';
      END IF;
      INSERT INTO %1$I.fx_system_application_read_binding
        (scope_id, activation_sequence, revision_id, readiness_contract_version, readiness_sha256, activation_sha256, binding_sha256, binding_bytes)
        VALUES (activation.scope_id, activation.activation_sequence, activation.revision_id, activation.readiness_contract_version,
          activation.readiness_sha256, activation.activation_sha256, p_sha256, p_bytes) ON CONFLICT DO NOTHING;
      SELECT b.* INTO STRICT prior FROM %1$I.fx_system_application_read_binding b
        WHERE b.scope_id = activation.scope_id AND b.activation_sequence = activation.activation_sequence;
      IF prior.binding_bytes <> p_bytes OR prior.binding_sha256 <> p_sha256 THEN
        RAISE EXCEPTION 'conflicting immutable application read binding' USING ERRCODE = '22000';
      END IF;
    END
    $body$
  $ddl$, installation_schema, installation_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_publish_application_read_binding(bytea, bytea) FROM PUBLIC', installation_schema);
END $$;
