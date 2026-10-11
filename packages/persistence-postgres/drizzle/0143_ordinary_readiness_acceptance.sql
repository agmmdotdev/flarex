-- Add pure complete ordinary readiness folds under managed installation maintenance.
DO $gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'finite frontier migration requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite frontier migration requires its managed maintenance owner' USING ERRCODE='55000';
  END IF;
END;
$gate$;
--> statement-breakpoint
DO $readiness$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_accept_ordinary_index_readiness(
  p_capture text,p_definitions jsonb,p_snapshot bigint,p_observed bigint,p_active text,p_frontiers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE states jsonb := p_capture::jsonb; state jsonb; definition jsonb; frontier jsonb;
  ordinal integer := 0; covered bigint; first_readable bigint; tables jsonb;
BEGIN
  IF jsonb_typeof(states)<>'array' OR jsonb_typeof(p_definitions)<>'array'
    OR jsonb_array_length(states)<>jsonb_array_length(p_definitions) THEN
    RETURN jsonb_build_object('reason','invalidPayload','ordinal',null); END IF;
  FOR definition IN SELECT value FROM jsonb_array_elements(p_definitions) LOOP
    state := states->ordinal; ordinal := ordinal+1;
    IF state IS NULL OR state='null'::jsonb THEN
      RETURN jsonb_build_object('reason','intrinsic','ordinal',ordinal); END IF;
    IF (state->>0)::bigint>p_observed THEN
      RETURN jsonb_build_object('reason','frontier','ordinal',ordinal,'frontierName','start','frontierValue',state->>0); END IF;
    IF (state->>1)::bigint>p_observed THEN
      RETURN jsonb_build_object('reason','frontier','ordinal',ordinal,'frontierName','coverage','frontierValue',state->>1); END IF;
    covered := (state->>1)::bigint; first_readable := (state->>2)::bigint;
    IF covered IS NULL OR first_readable IS NULL OR first_readable>p_snapshot THEN
      RETURN jsonb_build_object('reason','notCovered','ordinal',ordinal); END IF;
    IF state->>4 IS NOT NULL THEN
      IF (state->>3)::boolean IS NOT TRUE OR state->>4 IS DISTINCT FROM p_active THEN
        RETURN jsonb_build_object('reason','maintenance','ordinal',ordinal); END IF;
    ELSIF covered<p_snapshot THEN
      IF p_frontiers IS NULL THEN
        SELECT coalesce(jsonb_agg(DISTINCT d.value->'table'),'[]'::jsonb) INTO tables
          FROM jsonb_array_elements(p_definitions) WITH ORDINALITY d(value,ordinal)
          WHERE states->(d.ordinal::integer-1) IS DISTINCT FROM 'null'::jsonb
            AND states->(d.ordinal::integer-1)->>4 IS NULL
            AND (states->(d.ordinal::integer-1)->>1)::bigint<p_snapshot
            AND (states->(d.ordinal::integer-1)->>2)::bigint<=p_snapshot;
        RETURN jsonb_build_object('reason','frontiersRequired','ordinal',ordinal,'tables',tables);
      END IF;
      frontier := p_frontiers->(definition->>'table');
      IF frontier IS NULL OR frontier->>'error'='true' THEN
        RETURN jsonb_build_object('reason','tableFrontier','ordinal',ordinal); END IF;
      IF (frontier->>'value')::bigint>covered THEN
        RETURN jsonb_build_object('reason','notCovered','ordinal',ordinal); END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reason','accepted','ordinal',null);
END;
$body$$ddl$,target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_accept_ordinary_unique_readiness(
  p_capture text,p_members jsonb,p_observed bigint,p_active text,p_frontiers jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE states jsonb := p_capture::jsonb; state jsonb; member jsonb; frontier jsonb; captured record;
  ordinal integer := 0; covered bigint; identities jsonb := '[]'::jsonb; identity jsonb; expected jsonb; tables jsonb;
BEGIN
  IF p_frontiers->>'phase'='intrinsic' THEN
    FOR captured IN SELECT key,value FROM jsonb_each(states) ORDER BY key::integer LOOP
      IF captured.value='null'::jsonb THEN RETURN jsonb_build_object('reason','intrinsic','ordinal',null,'definitionId',captured.key::integer); END IF;
      IF (captured.value->>2)::bigint>p_observed OR (captured.value->>3)::bigint>p_observed THEN
        RETURN jsonb_build_object('reason','frontier','ordinal',null,'definitionId',captured.key::integer); END IF;
    END LOOP;
    RETURN jsonb_build_object('reason','accepted','ordinal',null);
  END IF;
  FOR member IN SELECT value FROM jsonb_array_elements(p_members) LOOP
    ordinal := ordinal+1; state := states->(member->>'id');
    IF state IS NULL THEN RETURN jsonb_build_object('reason','buildMissing','ordinal',ordinal); END IF;
    IF (state->>0)::boolean IS NOT TRUE THEN RETURN jsonb_build_object('reason','buildStale','ordinal',ordinal,'lifecycle',state->>1); END IF;
    IF state->>1<>'enabled' THEN RETURN jsonb_build_object('reason','buildNotEnabled','ordinal',ordinal,'lifecycle',state->>1); END IF;
    covered := (state->>3)::bigint;
    IF covered IS NULL THEN RETURN jsonb_build_object('reason','buildStale','ordinal',ordinal,'lifecycle',state->>1); END IF;
    IF state->>6 IS NOT NULL THEN
      IF (state->>5)::boolean IS NOT TRUE OR state->>6 IS DISTINCT FROM p_active THEN
        RETURN jsonb_build_object('reason','maintenance','ordinal',ordinal); END IF;
    ELSIF covered<p_observed THEN
      IF p_frontiers IS NULL THEN
        SELECT coalesce(jsonb_agg(DISTINCT m.value->'table'),'[]'::jsonb) INTO tables
          FROM jsonb_array_elements(p_members) m(value)
          WHERE states->(m.value->>'id')->>6 IS NULL
            AND states->(m.value->>'id')->>1='enabled'
            AND (states->(m.value->>'id')->>3)::bigint<p_observed;
        RETURN jsonb_build_object('reason','frontiersRequired','ordinal',ordinal,'tables',tables); END IF;
      frontier := p_frontiers->(member->>'table');
      IF frontier IS NULL OR frontier->>'error'='true' THEN RETURN jsonb_build_object('reason','tableFrontier','ordinal',ordinal); END IF;
      IF (frontier->>'value')::bigint>covered THEN RETURN jsonb_build_object('reason','buildStale','ordinal',ordinal,'lifecycle',state->>1); END IF;
    END IF;
    identity := jsonb_build_object('uniqueConstraintDefinitionId',member->'id','tableId',member->'table',
      'startCommitSeq',state->>2,'attemptFence',state->>4);
    IF p_expected IS NOT NULL THEN
      SELECT value INTO expected FROM jsonb_array_elements(p_expected) WHERE value->>'uniqueConstraintDefinitionId'=member->>'id' LIMIT 1;
      IF expected IS NULL OR expected IS DISTINCT FROM identity THEN
        RETURN jsonb_build_object('reason','buildStale','ordinal',ordinal,'lifecycle',state->>1); END IF;
    END IF;
    identities := identities || jsonb_build_array(identity);
  END LOOP;
  RETURN jsonb_build_object('reason','accepted','ordinal',null,'identities',identities);
END;
$body$$ddl$,target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_accept_ordinary_search_readiness(
  p_capture text,p_definitions jsonb,p_observed bigint,p_physical jsonb,p_frontiers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE states jsonb := p_capture::jsonb; state jsonb; definition jsonb; ordinal integer := 0; frontier jsonb;
BEGIN
  FOR definition IN SELECT value FROM jsonb_array_elements(p_definitions) LOOP
    ordinal := ordinal+1; state := states->(definition->>'key');
    IF state IS NULL OR state->>0<>'ready' OR state->>1 IS DISTINCT FROM definition->>'source' THEN
      RETURN jsonb_build_object('reason','uncovered','ordinal',ordinal); END IF;
    IF p_physical IS NULL THEN RETURN jsonb_build_object('reason','physicalRequired','ordinal',ordinal); END IF;
    IF (p_physical->>(definition->>'kind'))::boolean IS NOT TRUE THEN
      RETURN jsonb_build_object('reason','uncovered','ordinal',ordinal); END IF;
    IF p_frontiers IS NULL THEN RETURN jsonb_build_object('reason','frontiersRequired','ordinal',ordinal); END IF;
    frontier := p_frontiers->(definition->>'table');
    IF frontier IS NULL OR frontier->>'error'='true' THEN RETURN jsonb_build_object('reason','tableFrontier','ordinal',ordinal); END IF;
    IF (state->>2)::bigint>p_observed OR (state->>2)::bigint<coalesce((frontier->>'value')::bigint,0) THEN
      RETURN jsonb_build_object('reason','clockRefresh','ordinal',ordinal); END IF;
  END LOOP;
  RETURN jsonb_build_object('reason','accepted','ordinal',null);
END;
$body$$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_ordinary_index_readiness(text,jsonb,bigint,bigint,text,jsonb),%1$I.fx_accept_ordinary_unique_readiness(text,jsonb,bigint,text,jsonb,jsonb),%1$I.fx_accept_ordinary_search_readiness(text,jsonb,bigint,jsonb,jsonb) FROM PUBLIC',target_schema);
END;
$readiness$;
