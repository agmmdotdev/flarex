import type { Transaction } from "@electric-sql/pglite";
import { useFileScopedPersistence } from "../support/fileScopedPersistenceFixture";
import { createFileScopedPGliteFixture, resetControlScopeRowsInTransaction } from "../support/pgliteTestFixture";

/** Current legacy-definition Task rows only. Persistent DDL and additional
 * dependants keep independent fixtures; every constraint remains enabled. */
export function useFileScopedPGliteTaskPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () =>
    db.transaction(resetTaskRowsInTransaction)));
}

/** Task rows and their control directory share one reset transaction. Other
 * deployment dependants and persistent DDL remain outside this fixture. */
export function useFileScopedPGliteTaskDirectoryPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () =>
    db.transaction(async transaction => {
      await resetTaskRowsInTransaction(transaction);
      await resetControlScopeRowsInTransaction(transaction);
    })));
}

async function resetTaskRowsInTransaction(transaction: Transaction): Promise<void> {
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
}
