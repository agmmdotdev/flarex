export interface CookingTaskStateV1 extends Readonly<Record<string, unknown>> {
  readonly catalog_count: string;
  readonly definition_count: string;
  readonly legacy_definition_revision_count: string;
  readonly run_count: string;
  readonly request_count: string;
  readonly attempt_count: string;
  readonly pending_count: string;
  readonly dispatch_count: string;
  readonly terminal_run_count: string;
}

export async function readCookingTaskStateV1(
  persistence: Readonly<{
    readonly query: <Row extends Record<string, unknown>>(
      sql: string,
    ) => PromiseLike<Readonly<{ readonly rows: ReadonlyArray<Row> }>>;
  }>,
): Promise<ReadonlyArray<CookingTaskStateV1>> {
  const result = await persistence.query<CookingTaskStateV1>(`
    select
      (select count(*)::text from fx_system_application_task_catalog_v1) as catalog_count,
      (select count(*)::text from fx_system_application_task_definition_v1) as definition_count,
      (select count(*)::text from fx_system_durable_task_definition_revision_v1) as legacy_definition_revision_count,
      (select count(*)::text from fx_system_durable_task_run_v1) as run_count,
      (select count(*)::text from fx_system_durable_task_run_request_v1) as request_count,
      (select count(*)::text from fx_system_durable_task_attempt_identity_v1) as attempt_count,
      (select count(*)::text from fx_system_durable_task_compute_pending_v1) as pending_count,
      (select count(*)::text from fx_system_durable_task_compute_dispatch_v1) as dispatch_count,
      (select count(*)::text from fx_system_durable_task_run_v1 where phase = 'terminal') as terminal_run_count
  `);
  return result.rows;
}
