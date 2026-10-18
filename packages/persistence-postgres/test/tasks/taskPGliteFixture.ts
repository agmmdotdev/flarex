import { useFileScopedPersistence } from "../support/fileScopedPersistenceFixture";
import { createFileScopedPGliteFixture } from "../support/pgliteTestFixture";

/** Current legacy-definition Task rows only. Persistent DDL and additional
 * dependants keep independent fixtures; every constraint remains enabled. */
export function useFileScopedPGliteTaskPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () =>
    db.transaction(async transaction => {
      await transaction.exec(`
        delete from fx_system_durable_task_compute_cancellation_v1;
        delete from fx_system_durable_task_compute_dispatch_v1;
        delete from fx_system_durable_task_compute_pending_v1;
        delete from fx_system_durable_task_requested_effect_v1;
        delete from fx_system_durable_task_attempt_identity_v1;
        delete from fx_system_durable_task_run_request_v1;
        delete from fx_system_durable_task_run_v1;
        delete from fx_system_durable_task_definition_revision_v1;
        delete from fx_system_scope_execution_authority;
        delete from fx_system_scope_clock;
      `);
    })));
}
