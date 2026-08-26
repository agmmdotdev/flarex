export interface CookingActionStateV1
  extends Readonly<Record<string, unknown>> {
  readonly invocation_count: string;
  readonly completed_count: string;
  readonly failed_count: string;
  readonly uncertain_count: string;
  readonly effect_count: string;
  readonly confirmed_child_mutation_effect_count: string;
  readonly confirmed_outbound_effect_count: string;
  readonly uncertain_outbound_effect_count: string;
  readonly failed_before_dispatch_effect_count: string;
}

export async function readCookingActionStateV1(
  persistence: Readonly<{
    readonly query: <Row extends Record<string, unknown>>(
      sql: string,
    ) => PromiseLike<Readonly<{ readonly rows: ReadonlyArray<Row> }>>;
  }>,
): Promise<ReadonlyArray<CookingActionStateV1>> {
  const result = await persistence.query<CookingActionStateV1>(`
    select
      count(*)::text as invocation_count,
      count(*) filter (where lifecycle = 'completed')::text
        as completed_count,
      count(*) filter (where lifecycle = 'failed')::text as failed_count,
      count(*) filter (where lifecycle = 'uncertain')::text
        as uncertain_count,
      (select count(*)::text
         from fx_system_external_effect_attempt_v1
        where subject_kind = 'direct_action') as effect_count,
      (select count(*)::text
         from fx_system_external_effect_attempt_v1
        where subject_kind = 'direct_action'
          and effect_kind = 'child_mutation'
          and state = 'confirmed') as confirmed_child_mutation_effect_count,
      (select count(*)::text
         from fx_system_external_effect_attempt_v1
        where subject_kind = 'direct_action'
          and effect_kind = 'outbound_http'
          and state = 'confirmed') as confirmed_outbound_effect_count,
      (select count(*)::text
         from fx_system_external_effect_attempt_v1
        where subject_kind = 'direct_action'
          and effect_kind = 'outbound_http'
          and state = 'uncertain') as uncertain_outbound_effect_count,
      (select count(*)::text
         from fx_system_external_effect_attempt_v1
        where subject_kind = 'direct_action'
          and state = 'failed_before_dispatch')
        as failed_before_dispatch_effect_count
    from fx_system_application_action_invocation_v1
  `);
  return result.rows;
}
