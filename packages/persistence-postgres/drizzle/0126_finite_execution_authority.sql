-- Managed forward cutover: preserve every lifecycle value and all identity FKs.
LOCK TABLE "fx_system_scope_clock" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM fx_system_tx_session s JOIN fx_system_tx_journal j
    ON j.scope_uuid = s.scope_uuid AND j.session_id = s.session_id
    WHERE s.lifecycle NOT IN ('committed', 'aborted', 'expired') AND j.execution_profile = 'finiteRoot') THEN
    RAISE EXCEPTION 'finite execution cutover requires terminal or recovery drain of existing finite roots' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "fx_system_scope_execution_authority" (
  "scope_id" text PRIMARY KEY CONSTRAINT "fx_scope_execution_authority_scope_fk" REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "storage_generation" text NOT NULL CONSTRAINT "fx_scope_execution_authority_generation_check" CHECK ("storage_generation" IN ('legacy_v1', 'flarexdb_v1')),
  "storage_generation_fence" bigint NOT NULL DEFAULT 1 CONSTRAINT "fx_scope_execution_authority_fence_check" CHECK ("storage_generation_fence" >= 1),
  "oldest_available_commit_seq" bigint NOT NULL DEFAULT 0 CONSTRAINT "fx_scope_execution_authority_floor_check" CHECK ("oldest_available_commit_seq" >= 0),
  "authorization_revocation_epoch" bigint NOT NULL DEFAULT 0 CONSTRAINT "fx_scope_execution_authority_revocation_check" CHECK ("authorization_revocation_epoch" >= 0),
  "epoch" text NOT NULL CONSTRAINT "fx_scope_execution_authority_epoch_check" CHECK (btrim("epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
  "epoch_uuid" uuid GENERATED ALWAYS AS (CASE WHEN "epoch" ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN substring("epoch" FROM 7)::uuid ELSE NULL END) STORED,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "fx_system_scope_execution_authority" (scope_id, storage_generation, storage_generation_fence, oldest_available_commit_seq, authorization_revocation_epoch, epoch, updated_at)
SELECT scope_id, storage_generation, storage_generation_fence, oldest_available_commit_seq, authorization_revocation_epoch, epoch, updated_at FROM "fx_system_scope_clock";
--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD COLUMN "last_metadata_sequence" bigint NOT NULL DEFAULT 0 CONSTRAINT "fx_system_scope_clock_last_metadata_sequence_non_negative_check" CHECK ("last_metadata_sequence" >= 0);
--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" DROP CONSTRAINT "fx_system_scope_clock_oldest_available_commit_seq_check",
  DROP COLUMN "storage_generation", DROP COLUMN "storage_generation_fence", DROP COLUMN "oldest_available_commit_seq",
  DROP COLUMN "authorization_revocation_epoch", DROP COLUMN "epoch_uuid", DROP COLUMN "epoch";
--> statement-breakpoint
CREATE TABLE "fx_system_metadata_contract_observation" (
  "scope_id" text NOT NULL CONSTRAINT "fx_metadata_contract_scope_fk" REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "namespace" text NOT NULL CONSTRAINT "fx_metadata_contract_namespace_check" CHECK ("namespace" IN ('application', 'binding', 'execution')),
  "owner_key" text NOT NULL CONSTRAINT "fx_metadata_contract_owner_check" CHECK (btrim("owner_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
  "contract_key" text NOT NULL CONSTRAINT "fx_metadata_contract_key_check" CHECK (btrim("contract_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
  "semantic_sha256_hex" text,
  "present" boolean NOT NULL,
  "last_changed_metadata_sequence" bigint NOT NULL CONSTRAINT "fx_metadata_contract_sequence_check" CHECK ("last_changed_metadata_sequence" > 0),
  PRIMARY KEY (scope_id, namespace, owner_key, contract_key),
  CONSTRAINT "fx_metadata_contract_digest_check" CHECK ((present = (semantic_sha256_hex IS NOT NULL)) AND (semantic_sha256_hex IS NULL OR semantic_sha256_hex ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "fx_system_snapshot_lease" ADD COLUMN "metadata_watermark" bigint,
  ADD COLUMN "finite_metadata_reservation_bytes" bytea, ADD COLUMN "finite_metadata_reservation_sha256" bytea,
  ADD CONSTRAINT "fx_snapshot_lease_finite_metadata_reservation_check" CHECK (
    (metadata_watermark IS NULL AND finite_metadata_reservation_bytes IS NULL AND finite_metadata_reservation_sha256 IS NULL)
    OR (metadata_watermark IS NOT NULL AND metadata_watermark >= 0 AND finite_metadata_reservation_bytes IS NOT NULL
      AND octet_length(finite_metadata_reservation_bytes) BETWEEN 1 AND 65536
      AND finite_metadata_reservation_sha256 IS NOT NULL AND octet_length(finite_metadata_reservation_sha256) = 32));
--> statement-breakpoint
-- Deferral permits atomic provisioning of both owners; incomplete roots and
-- invalid retained floors cannot commit even through ordinary-role direct SQL.
DO $$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_check_scope_execution_authority() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE selected_scope text; last_sequence bigint; retained_floor bigint; authority_scope text;
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.scope_id IS DISTINCT FROM NEW.scope_id THEN
        RAISE EXCEPTION 'scope identity is immutable' USING ERRCODE = '23514';
      END IF;
      selected_scope := CASE WHEN TG_OP = 'DELETE' THEN OLD.scope_id ELSE NEW.scope_id END;
      PERFORM 1 FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = selected_scope FOR SHARE;
      PERFORM 1 FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = selected_scope FOR SHARE;
      SELECT c.last_commit_seq, a.oldest_available_commit_seq, a.scope_id
      INTO last_sequence, retained_floor, authority_scope
      FROM %1$I.fx_system_scope_clock c LEFT JOIN %1$I.fx_system_scope_execution_authority a ON a.scope_id = c.scope_id
      WHERE c.scope_id = selected_scope;
      IF FOUND AND (authority_scope IS NULL OR retained_floor > last_sequence) THEN
        RAISE EXCEPTION 'scope execution authority is incomplete or its retained floor exceeds the sequencer' USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('CREATE CONSTRAINT TRIGGER fx_scope_authority_pair_integrity AFTER INSERT OR UPDATE OR DELETE ON %1$I.fx_system_scope_clock DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION %1$I.fx_check_scope_execution_authority()', target_schema);
  EXECUTE format('CREATE CONSTRAINT TRIGGER fx_scope_authority_pair_integrity AFTER INSERT OR UPDATE OR DELETE ON %1$I.fx_system_scope_execution_authority DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION %1$I.fx_check_scope_execution_authority()', target_schema);
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_scope_execution_authority FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_metadata_contract_observation FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
END $$;

--> statement-breakpoint
DO $$
DECLARE installation_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %1$I.fx_publish_application_read_binding(p_bytes bytea, p_sha256 bytea)
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
      PERFORM 1 FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = supplied->>'scopeId' FOR SHARE;
      PERFORM 1 FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = supplied->>'scopeId' FOR NO KEY UPDATE;
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
END $$;

--> statement-breakpoint
DO $$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_lock_finite_scope_observation(p_scope_id text)
    RETURNS TABLE(authority_row %1$I.fx_system_scope_execution_authority,
      sequence_row %1$I.fx_system_scope_clock)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF FOUND THEN
        SELECT c.* INTO sequence_row FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      END IF;
      RETURN NEXT;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_lock_finite_running_attempt(p_scope_id text, p_session_id uuid, p_attempt_fence bigint,
      p_storage_generation text, p_storage_fence bigint, p_epoch text)
    RETURNS TABLE(disposition text, scope_uuid uuid, authority_row %1$I.fx_system_scope_execution_authority,
      session_row %1$I.fx_system_tx_session, lease_row %1$I.fx_system_snapshot_lease,
      journal_root %1$I.fx_system_tx_journal, execution_claim %1$I.fx_system_tx_execution_claim,
      database_now_epoch_milliseconds text)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE session_values record; session_count integer := 0; leases %1$I.fx_system_snapshot_lease[];
      journal_values record; journal_count integer := 0; claims %1$I.fx_system_tx_execution_claim[]; published_sequence bigint;
      sequence_row %1$I.fx_system_scope_clock; scope_observation record;
    BEGIN
      SELECT o.* INTO scope_observation
        FROM %1$I.fx_lock_finite_scope_observation(p_scope_id) o;
      authority_row := scope_observation.authority_row;
      sequence_row := scope_observation.sequence_row;
      IF authority_row.scope_id IS NULL THEN disposition := 'scopeClockMissing'; RETURN NEXT; RETURN; END IF;
      scope_uuid := sequence_row.scope_uuid;
      published_sequence := sequence_row.last_commit_seq;
      IF authority_row.epoch_uuid IS NULL THEN disposition := 'scopeClockNativeProjectionInvalid'; RETURN NEXT; RETURN; END IF;
      IF authority_row.storage_generation <> 'flarexdb_v1' OR p_storage_generation <> 'flarexdb_v1' THEN disposition := 'unsupportedStorageGeneration'; RETURN NEXT; RETURN; END IF;
      IF authority_row.storage_generation_fence <> p_storage_fence THEN disposition := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN; END IF;
      IF authority_row.epoch <> p_epoch THEN disposition := 'scopeEpochChanged'; RETURN NEXT; RETURN; END IF;
      IF sequence_row.scope_id IS NULL THEN disposition := 'scopeClockMissing'; RETURN NEXT; RETURN; END IF;
      IF scope_uuid IS NULL THEN disposition := 'scopeClockNativeProjectionInvalid'; RETURN NEXT; RETURN; END IF;
      FOR session_values IN SELECT s.scope_uuid, s.session_id, s.storage_generation, s.storage_generation_fence, s.execution_authority_generation, coalesce(s.execution_module, s.application_execution_authority_json #>> '{runtimeTarget,executionModulePath}') as execution_module, s.function_path, s.function_kind, s.schema_version_id, s.identity_access_policy_sha256, s.authorization_revocation_epoch, s.authorization_grant_expires_at, s.request_key, s.lifecycle, s.attempt_fence, s.protocol_version, s.hard_expires_at, s.created_at, s.updated_at FROM %1$I.fx_system_tx_session s
        WHERE s.scope_uuid = fx_lock_finite_running_attempt.scope_uuid AND s.session_id = p_session_id LIMIT 2 FOR SHARE OF s LOOP
        session_count := session_count + 1;
        session_row.scope_uuid := session_values.scope_uuid;
        session_row.session_id := session_values.session_id;
        session_row.storage_generation := session_values.storage_generation;
        session_row.storage_generation_fence := session_values.storage_generation_fence;
        session_row.execution_authority_generation := session_values.execution_authority_generation;
        session_row.execution_module := session_values.execution_module;
        session_row.function_path := session_values.function_path;
        session_row.function_kind := session_values.function_kind;
        session_row.schema_version_id := session_values.schema_version_id;
        session_row.identity_access_policy_sha256 := session_values.identity_access_policy_sha256;
        session_row.authorization_revocation_epoch := session_values.authorization_revocation_epoch;
        session_row.authorization_grant_expires_at := session_values.authorization_grant_expires_at;
        session_row.request_key := session_values.request_key;
        session_row.lifecycle := session_values.lifecycle;
        session_row.attempt_fence := session_values.attempt_fence;
        session_row.protocol_version := session_values.protocol_version;
        session_row.hard_expires_at := session_values.hard_expires_at;
        session_row.created_at := session_values.created_at;
        session_row.updated_at := session_values.updated_at;
      END LOOP;
      IF session_count = 0 THEN disposition := 'sessionMissing'; RETURN NEXT; RETURN; END IF;
      IF session_count <> 1 THEN disposition := 'sessionRecordInvalid'; RETURN NEXT; RETURN; END IF;
      IF session_row.attempt_fence <> p_attempt_fence THEN disposition := 'staleAttemptFence'; RETURN NEXT; RETURN; END IF;
      IF session_row.storage_generation <> 'flarexdb_v1' THEN disposition := 'unsupportedStorageGeneration'; RETURN NEXT; RETURN; END IF;
      IF session_row.storage_generation_fence <> authority_row.storage_generation_fence THEN disposition := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN; END IF;
      IF session_row.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN disposition := 'authorizationRevocationEpochChanged'; RETURN NEXT; RETURN; END IF;
      IF NOT (isfinite(session_row.authorization_grant_expires_at) AND isfinite(session_row.hard_expires_at)
        AND isfinite(session_row.created_at) AND isfinite(session_row.updated_at))
        OR session_row.hard_expires_at > session_row.authorization_grant_expires_at OR session_row.protocol_version <> 1 THEN
        disposition := 'sessionRecordInvalid'; RETURN NEXT; RETURN;
      END IF;
      SELECT ARRAY(SELECT l FROM %1$I.fx_system_snapshot_lease l WHERE l.scope_uuid = fx_lock_finite_running_attempt.scope_uuid AND l.session_id = p_session_id LIMIT 2 FOR SHARE OF l) INTO leases;
      IF cardinality(leases) = 0 THEN disposition := 'snapshotLeaseMissing'; RETURN NEXT; RETURN; END IF;
      IF cardinality(leases) <> 1 THEN disposition := 'snapshotLeaseInvalid'; RETURN NEXT; RETURN; END IF;
      lease_row := leases[1];
      IF lease_row.attempt_fence <> session_row.attempt_fence OR NOT isfinite(lease_row.lease_expires_at)
        OR lease_row.lease_expires_at > session_row.hard_expires_at THEN disposition := 'snapshotLeaseInvalid'; RETURN NEXT; RETURN; END IF;
      IF lease_row.snapshot_epoch_uuid <> authority_row.epoch_uuid THEN disposition := 'scopeEpochChanged'; RETURN NEXT; RETURN; END IF;
      IF lease_row.snapshot_commit_seq > published_sequence THEN disposition := 'snapshotAheadOfScopeClock'; RETURN NEXT; RETURN; END IF;
      IF lease_row.snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN disposition := 'snapshotLeaseInvalid'; RETURN NEXT; RETURN; END IF;
      IF session_row.lifecycle <> 'running' THEN disposition := 'terminal'; RETURN NEXT; RETURN; END IF;
      FOR journal_values IN SELECT r.scope_uuid, r.session_id, r.attempt_fence, r.journal_format,
        r.execution_profile, r.state, r.last_syscall_sequence FROM %1$I.fx_system_tx_journal r
        WHERE r.scope_uuid = fx_lock_finite_running_attempt.scope_uuid AND r.session_id = p_session_id
        AND r.attempt_fence = p_attempt_fence LIMIT 2 FOR SHARE OF r LOOP
        journal_count := journal_count + 1;
        journal_root.scope_uuid := journal_values.scope_uuid;
        journal_root.session_id := journal_values.session_id;
        journal_root.attempt_fence := journal_values.attempt_fence;
        journal_root.journal_format := journal_values.journal_format;
        journal_root.execution_profile := journal_values.execution_profile;
        journal_root.state := journal_values.state;
        journal_root.last_syscall_sequence := journal_values.last_syscall_sequence;
      END LOOP;
      IF journal_count = 0 THEN disposition := 'activeJournalRootMissing'; RETURN NEXT; RETURN; END IF;
      IF journal_count <> 1 THEN disposition := 'journalRootInvalid'; RETURN NEXT; RETURN; END IF;
      IF journal_root.execution_profile <> 'finiteRoot' THEN disposition := 'journalRootInvalid'; RETURN NEXT; RETURN; END IF;
      IF lease_row.metadata_watermark IS NULL OR lease_row.finite_metadata_reservation_bytes IS NULL
        OR lease_row.finite_metadata_reservation_sha256 IS NULL THEN disposition := 'snapshotLeaseInvalid'; RETURN NEXT; RETURN; END IF;
      SELECT ARRAY(SELECT c FROM %1$I.fx_system_tx_execution_claim c WHERE c.scope_uuid = fx_lock_finite_running_attempt.scope_uuid AND c.session_id = p_session_id
        AND c.attempt_fence = p_attempt_fence LIMIT 2 FOR SHARE OF c) INTO claims;
      IF cardinality(claims) <> 1 THEN disposition := 'executionClaimMissingOrDuplicate'; RETURN NEXT; RETURN; END IF;
      execution_claim := claims[1];
      IF journal_root.state = 'sealed' AND lease_row.lease_expires_at <> least(session_row.authorization_grant_expires_at, session_row.hard_expires_at) THEN
        disposition := 'snapshotLeaseInvalid'; RETURN NEXT; RETURN;
      END IF;
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text INTO database_now_epoch_milliseconds;
      IF session_row.authorization_grant_expires_at <= to_timestamp(database_now_epoch_milliseconds::numeric / 1000)
        OR session_row.hard_expires_at <= to_timestamp(database_now_epoch_milliseconds::numeric / 1000)
        OR lease_row.lease_expires_at <= to_timestamp(database_now_epoch_milliseconds::numeric / 1000) THEN
        disposition := 'activeAttemptExpired'; RETURN NEXT; RETURN;
      END IF;
      disposition := 'loaded'; RETURN NEXT;
    END;
    $body$
  $ddl$, target_schema);
END $$;

--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_lock_finite_scope_observation(text), %1$I.fx_lock_finite_running_attempt(text,uuid,bigint,text,bigint,text), %1$I.fx_check_scope_execution_authority() FROM PUBLIC', target_schema);
END $$;
