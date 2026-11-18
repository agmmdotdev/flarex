-- Retire only private pure folds after the existing readiness owners migrate.
-- Every persisted application, history, session, journal and outcome remains.
DO $gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'ordinary readiness retirement requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'ordinary readiness retirement requires its managed maintenance owner' USING ERRCODE='55000';
  END IF;
END;
$gate$;
--> statement-breakpoint
DROP FUNCTION fx_accept_ordinary_index_readiness(text,jsonb,bigint,bigint,text,jsonb);
--> statement-breakpoint
DROP FUNCTION fx_accept_ordinary_unique_readiness(text,jsonb,bigint,text,jsonb,jsonb);
--> statement-breakpoint
DROP FUNCTION fx_accept_ordinary_search_readiness(text,jsonb,bigint,jsonb,jsonb);
