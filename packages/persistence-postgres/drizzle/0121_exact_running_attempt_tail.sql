-- Compose only the already-ordered root/claim/time tail. Earlier clock,
-- session and lease validation remains with its existing runtime owner.
DO $$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_lock_running_attempt_tail(
      p_scope_uuid uuid, p_session_id uuid, p_attempt_fence bigint, p_scope_id text
    ) RETURNS TABLE(
      disposition text,
      journal_root %1$I.fx_system_tx_journal,
      execution_claim %1$I.fx_system_tx_execution_claim,
      database_now_epoch_milliseconds text
    ) LANGUAGE plpgsql VOLATILE SECURITY INVOKER
    SET search_path = pg_catalog, pg_temp AS $body$
DECLARE
  roots %1$I.fx_system_tx_journal[];
  claims %1$I.fx_system_tx_execution_claim[];
BEGIN
  SELECT ARRAY(
    SELECT r FROM %1$I.fx_system_tx_journal r
    WHERE r.scope_uuid = p_scope_uuid AND r.session_id = p_session_id
      AND r.attempt_fence = p_attempt_fence
    LIMIT 2 FOR UPDATE
  ) INTO roots;
  IF cardinality(roots) = 0 THEN
    disposition := 'journalRootMissing';
    RETURN NEXT;
    RETURN;
  END IF;
  IF cardinality(roots) <> 1 THEN
    disposition := 'journalRootInvalid';
    RETURN NEXT;
    RETURN;
  END IF;
  journal_root := roots[1];

  SELECT ARRAY(
    SELECT c FROM %1$I.fx_system_tx_execution_claim c
    WHERE c.scope_uuid = p_scope_uuid AND c.session_id = p_session_id
      AND c.attempt_fence = p_attempt_fence
    LIMIT 2 FOR UPDATE
  ) INTO claims;
  IF cardinality(claims) <> 1 THEN
    disposition := 'executionClaimMissingOrDuplicate';
    RETURN NEXT;
    RETURN;
  END IF;
  execution_claim := claims[1];

  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text
  INTO database_now_epoch_milliseconds
  FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = p_scope_id LIMIT 1;
  disposition := CASE WHEN FOUND THEN 'loaded' ELSE 'databaseClockInvalid' END;
  RETURN NEXT;
END;
$body$
  $ddl$, target_schema);
END;
$$;
