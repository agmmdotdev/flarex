import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import { useLazyFileScopedPersistence } from "./fileScopedPersistenceFixture";

/** Pilot row/index/relation profiles: driver construction is deferred until a
 * registered database test is selected. Domain seeding stays with its suite. */
export function usePGliteStorageTests(profile: "rows" | "indexes" = "rows") {
  return useLazyFileScopedPersistence<PGliteFlarexPersistence>(async () => {
    const { createFileScopedPGliteFixture, resetStorageRowsInTransaction,
      resetScopeAuthorityRowsInTransaction } = await import("./pgliteTestFixture");
    return createFileScopedPGliteFixture(async db => () => db.transaction(async transaction => {
      if (profile === "rows") return resetStorageRowsInTransaction(transaction);
      // This is the existing S10 reset policy, moved from appIndexEntries.test.
      // Immutable obligations have no scope FK and must not survive a reset.
      const obligations = await transaction.query<{ present: boolean }>(`
        select exists (select 1 from fx_system_index_maintenance_obligation)
          or exists (select 1 from fx_system_unique_maintenance_obligation) as present
      `);
      if (obligations.rows[0]?.present !== false) {
        throw new Error("Index-entry fixture cannot reset maintenance obligations");
      }
      // Keep catalogue guards and foreign keys enabled; reject unexpected dependants.
      await transaction.exec(`
        delete from fx_app_index_entry_current;
        delete from fx_app_index_entry_rev;
        delete from fx_app_row_current;
        delete from fx_app_row_rev;
        delete from fx_control_index_definition;
        delete from fx_control_index;
        delete from fx_control_table;
      `);
      await resetScopeAuthorityRowsInTransaction(transaction);
    }));
  });
}

export function usePostgresStorageTests() {
  return useLazyFileScopedPersistence<PostgresFlarexPersistence>(async () =>
    (await import("./postgresStorageFixture")).createPostgresStorageFixture());
}
