-- The trusted catalog compiler publishes derived read metadata. Runtime roles
-- receive SELECT only; this migration grants no publication capability.
CREATE TABLE fx_control_logical_read_source (
  deployment_id text NOT NULL,
  schema_version_id text NOT NULL,
  source_key text NOT NULL,
  source_sha256 text NOT NULL,
  artifact_version integer NOT NULL,
  manifest_sha256 bytea NOT NULL,
  projection_json jsonb NOT NULL,
  projection_sha256 text NOT NULL,
  PRIMARY KEY (deployment_id, schema_version_id, source_key),
  CONSTRAINT fx_control_logical_read_source_identity UNIQUE
    (deployment_id, schema_version_id, source_key, source_sha256),
  CONSTRAINT fx_control_logical_read_source_artifact_fk FOREIGN KEY
    (deployment_id, schema_version_id, artifact_version, manifest_sha256)
    REFERENCES fx_control_schema_version (deployment_id, schema_version_id, version, manifest_sha256) ON DELETE RESTRICT,
  CONSTRAINT fx_control_logical_read_source_digest CHECK
    (source_sha256 ~ '^[a-f0-9]{64}$' AND projection_sha256 ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE fx_control_logical_read_table (
  deployment_id text NOT NULL,
  schema_version_id text NOT NULL,
  source_key text NOT NULL,
  source_sha256 text NOT NULL,
  local_name text NOT NULL,
  table_id integer NOT NULL,
  projection_json jsonb NOT NULL,
  projection_sha256 text NOT NULL,
  PRIMARY KEY (deployment_id, schema_version_id, source_key, local_name),
  CONSTRAINT fx_control_logical_read_table_source_fk FOREIGN KEY
    (deployment_id, schema_version_id, source_key, source_sha256)
    REFERENCES fx_control_logical_read_source (deployment_id, schema_version_id, source_key, source_sha256) ON DELETE RESTRICT,
  CONSTRAINT fx_control_logical_read_table_identity_fk FOREIGN KEY
    (deployment_id, table_id) REFERENCES fx_control_table (deployment_id, table_id) ON DELETE RESTRICT,
  CONSTRAINT fx_control_logical_read_table_digest CHECK (projection_sha256 ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE fx_control_logical_read_access (
  deployment_id text NOT NULL,
  schema_version_id text NOT NULL,
  source_key text NOT NULL,
  local_name text NOT NULL,
  selector_kind text NOT NULL,
  selector_key text NOT NULL,
  leading_field text NOT NULL,
  prefix_length integer NOT NULL,
  ordinal integer NOT NULL,
  projection_json jsonb NOT NULL,
  projection_sha256 text NOT NULL,
  PRIMARY KEY (deployment_id, schema_version_id, source_key, local_name, selector_kind, selector_key),
  CONSTRAINT fx_control_logical_read_access_table_fk FOREIGN KEY
    (deployment_id, schema_version_id, source_key, local_name)
    REFERENCES fx_control_logical_read_table (deployment_id, schema_version_id, source_key, local_name) ON DELETE RESTRICT,
  CONSTRAINT fx_control_logical_read_access_digest CHECK (projection_sha256 ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE INDEX fx_control_logical_read_access_search ON fx_control_logical_read_access
  USING gin (deployment_id public.text_ops, schema_version_id public.text_ops,
    source_key public.text_ops, local_name public.text_ops, (projection_json->'fields') jsonb_path_ops)
  WHERE selector_kind = 'search';
--> statement-breakpoint
CREATE INDEX fx_control_logical_read_table_identity ON fx_control_logical_read_table
  (deployment_id, schema_version_id, source_key, table_id);
--> statement-breakpoint
DO $$
DECLARE installation_schema text := current_schema(); relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['fx_control_logical_read_source',
    'fx_control_logical_read_table', 'fx_control_logical_read_access'] LOOP
    EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.%2$I FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', installation_schema, relation_name);
    EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.%2$I FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_invalidate_prepared_metadata()', installation_schema, relation_name);
  END LOOP;
END $$;
