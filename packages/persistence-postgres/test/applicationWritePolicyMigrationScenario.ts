import { expect } from "vitest";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { legacyApplicationActivationCutoverSeedStatements } from "./applicationActivationMigrationSupport";
import { injectMigrationFailure, restoreMigrationFile, writeJournalThrough, type DrizzleCopyFixture } from "./migrationFixtureSupport";

/** Historical SQL is deliberate here: prove real upgrade bytes and atomic DDL. */
export async function applicationWritePolicyMigrationScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, fixture: DrizzleCopyFixture,
) {
  await persistence.migrate(); // Fixture journal initially ends at 74.
  for (const statement of legacyApplicationActivationCutoverSeedStatements()) await persistence.query(statement);
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 83);
  await persistence.migrate();
  const evidence = async () => (await persistence.query(`select a.readiness_contract_version,
    encode(a.activation_bytes, 'hex') as activation_bytes, encode(a.activation_sha256, 'hex') as activation_sha256,
    encode(h.head_bytes, 'hex') as head_bytes, encode(h.head_sha256, 'hex') as head_sha256
    from fx_system_application_activation a join fx_system_application_active_head h using(scope_id, activation_sequence)`)).rows;
  const before = await evidence();
  expect(before).toHaveLength(1);
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 86);
  await injectMigrationFailure(fixture.migrationPath, "fx_policy_deliberate_missing_migration_table");
  await expect(persistence.migrate()).rejects.toBeDefined();
  expect(await evidence()).toEqual(before);
  expect((await persistence.query<{ missing: boolean }>("select to_regclass('fx_system_application_write_ownership') is null as missing")).rows[0]?.missing).toBe(true);
  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await persistence.migrate();
  await persistence.migrate();
  expect(await evidence()).toEqual(before);
  expect((await persistence.query<{ absent: boolean }>(`select a.write_policy_set_sha256 is null and a.write_ownership_sha256 is null
    and h.write_policy_set_sha256 is null and h.write_ownership_sha256 is null as absent
    from fx_system_application_activation a join fx_system_application_active_head h using(scope_id, activation_sequence)`)).rows[0]?.absent).toBe(true);
  expect((await persistence.query<{ count: number }>(`select count(*)::int as count from information_schema.table_constraints
    where constraint_schema = current_schema() and constraint_name = 'fx_application_write_ownership_activation_fk'`)).rows[0]?.count).toBe(1);
}
