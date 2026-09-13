ALTER TABLE "fx_system_framework_migration_plan_admission" ADD COLUMN "created_transaction_id" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan" ADD COLUMN "created_transaction_id" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD COLUMN "created_transaction_id" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint
-- Transaction identity is storage bookkeeping, not part of a canonical value.
-- Never accept a caller-supplied stamp, including on INSERT ... ON CONFLICT.
CREATE FUNCTION fx_framework_stamp_creation_transaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.created_transaction_id := txid_current();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION fx_framework_reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Framework installation history is immutable: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
-- The root and all children must be written in the same transaction. This
-- closes the set at commit without a second seal flag or a writable checkpoint.
-- AFTER INSERT deliberately leaves exact ON CONFLICT DO NOTHING replay alone.
CREATE FUNCTION fx_framework_require_creation_transaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  parent_transaction bigint;
  parent_id bigint;
BEGIN
  parent_id := (to_jsonb(NEW) ->> TG_ARGV[1])::bigint;
  EXECUTE format('SELECT created_transaction_id FROM %I.%I WHERE %I = $1',
    TG_TABLE_SCHEMA, TG_ARGV[0], TG_ARGV[1])
    INTO parent_transaction USING parent_id;
  IF parent_transaction IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION 'Framework installation children must be created with their parent: %.%',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DO $$
DECLARE
  metadata_schema text := current_schema();
  history_table text;
  child record;
BEGIN
  FOREACH history_table IN ARRAY ARRAY[
    'fx_system_framework_schema_target_namespace',
    'fx_system_framework_migration_collision_domain',
    'fx_system_relational_physical_name_assignment',
    'fx_system_framework_migration_plan',
    'fx_system_framework_migration_plan_step',
    'fx_system_framework_migration_plan_step_dependency',
    'fx_system_framework_migration_plan_base',
    'fx_system_framework_migration_plan_admission',
    'fx_system_framework_migration_admission_assignment',
    'fx_system_framework_migration_attempt_start',
    'fx_system_framework_migration_step_receipt',
    'fx_system_framework_migration_step_receipt_dependency',
    'fx_system_framework_migration_attempt_terminal',
    'fx_system_framework_migration_event',
    'fx_system_framework_schema_installation',
    'fx_system_framework_schema_readiness',
    'fx_system_framework_schema_availability_history'
  ] LOOP
    EXECUTE format('CREATE TRIGGER fx_framework_history_immutable AFTER UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_framework_reject_history_mutation()',
      metadata_schema, history_table, metadata_schema);
    EXECUTE format('CREATE TRIGGER fx_framework_history_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_framework_reject_history_mutation()',
      metadata_schema, history_table, metadata_schema);
  END LOOP;
  FOREACH history_table IN ARRAY ARRAY[
    'fx_system_framework_migration_plan',
    'fx_system_framework_migration_plan_admission',
    'fx_system_framework_migration_step_receipt'
  ] LOOP
    EXECUTE format('CREATE TRIGGER fx_framework_creation_transaction BEFORE INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_framework_stamp_creation_transaction()',
      metadata_schema, history_table, metadata_schema);
  END LOOP;
  FOR child IN SELECT * FROM (VALUES
    ('fx_system_framework_migration_plan_step', 'fx_system_framework_migration_plan', 'plan_storage_id'),
    ('fx_system_framework_migration_plan_step_dependency', 'fx_system_framework_migration_plan', 'plan_storage_id'),
    ('fx_system_framework_migration_plan_base', 'fx_system_framework_migration_plan', 'plan_storage_id'),
    ('fx_system_framework_migration_admission_assignment', 'fx_system_framework_migration_plan_admission', 'admission_storage_id'),
    ('fx_system_framework_migration_step_receipt_dependency', 'fx_system_framework_migration_step_receipt', 'receipt_storage_id')
  ) AS children(table_name, parent_name, parent_key) LOOP
    EXECUTE format('CREATE TRIGGER fx_framework_children_sealed AFTER INSERT ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_framework_require_creation_transaction(%L, %L)',
      metadata_schema, child.table_name, metadata_schema, child.parent_name, child.parent_key);
  END LOOP;
END;
$$;
