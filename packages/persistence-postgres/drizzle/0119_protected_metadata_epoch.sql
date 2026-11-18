CREATE TABLE "fx_system_prepared_metadata_epoch" (
	"singleton_id" integer PRIMARY KEY NOT NULL,
	"database_name" text NOT NULL,
	"namespace_oid" bigint NOT NULL,
	"incarnation" uuid NOT NULL,
	"generation" bigint NOT NULL,
	CONSTRAINT "fx_system_prepared_metadata_singleton_check" CHECK ("fx_system_prepared_metadata_epoch"."singleton_id" = 1),
	CONSTRAINT "fx_system_prepared_metadata_generation_check" CHECK ("fx_system_prepared_metadata_epoch"."generation" >= 1)
);
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "execution_profile" text DEFAULT 'durableOperations' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_execution_profile_check" CHECK ("fx_system_tx_journal"."execution_profile" in ('durableOperations', 'finiteRoot'));
--> statement-breakpoint
-- Existing journal roots are durableOperations. A root's profile is immutable
-- throughout retry/recovery, including when an ordinary writer has UPDATE.
CREATE FUNCTION fx_reject_journal_execution_profile_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.execution_profile IS DISTINCT FROM OLD.execution_profile THEN
    RAISE EXCEPTION 'Journal execution profile is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Row-locking an epoch requires UPDATE privilege in PostgreSQL even for
-- FOR SHARE. Expose only this pinned read/lock operation to runtime; the
-- protected row itself remains non-writable and non-lockable by that login.
DO $$
DECLARE metadata_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %I.fx_lock_prepared_metadata_epoch()
    RETURNS TABLE(database_name text, namespace_oid bigint, incarnation uuid, generation bigint)
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
      SELECT e.database_name, e.namespace_oid, e.incarnation, e.generation
      FROM %I.fx_system_prepared_metadata_epoch e
      WHERE e.singleton_id = 1 AND e.database_name = current_database()
      FOR SHARE NOWAIT
    $body$
  $ddl$, metadata_schema, metadata_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_lock_prepared_metadata_epoch() FROM PUBLIC', metadata_schema);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fx_tx_journal_execution_profile_immutable
BEFORE UPDATE ON "fx_system_tx_journal" FOR EACH ROW
EXECUTE FUNCTION fx_reject_journal_execution_profile_change();
--> statement-breakpoint
INSERT INTO "fx_system_prepared_metadata_epoch"
  ("singleton_id", "database_name", "namespace_oid", "incarnation", "generation")
SELECT 1, current_database(), n.oid::bigint, gen_random_uuid(), 1
FROM pg_catalog.pg_namespace n WHERE n.nspname = current_schema();
--> statement-breakpoint
-- The trigger's owner can update the protected root. Ordinary metadata DML
-- retains its existing grants, but cannot bypass the same-transaction bump.
CREATE FUNCTION fx_invalidate_prepared_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE affected integer;
BEGIN
  EXECUTE format('UPDATE %I.fx_system_prepared_metadata_epoch SET generation = generation + 1 WHERE singleton_id = 1 AND database_name = current_database() AND namespace_oid = (SELECT oid::bigint FROM pg_catalog.pg_namespace WHERE nspname = $1)', TG_TABLE_SCHEMA)
    USING TG_TABLE_SCHEMA;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Protected metadata epoch is unavailable for %', TG_TABLE_SCHEMA
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION fx_invalidate_prepared_metadata() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "fx_system_prepared_metadata_epoch" FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
  metadata_schema text := current_schema();
  covered_table text;
BEGIN
  FOREACH covered_table IN ARRAY ARRAY[
    'fx_system_application_candidate_v1',
    'fx_system_application_analysis_v1',
    'fx_system_application_revision_v2',
    'fx_system_application_publication_v1',
    'fx_system_application_function_v1',
    'fx_system_application_task_catalog_v1',
    'fx_system_application_task_definition_v1',
    'fx_system_application_revision_schema_v1',
    'fx_system_application_readiness_v1',
    'fx_system_application_readiness_function_v1'
  ] LOOP
    EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_invalidate_prepared_metadata()',
      metadata_schema, covered_table, metadata_schema);
  END LOOP;
END;
$$;
