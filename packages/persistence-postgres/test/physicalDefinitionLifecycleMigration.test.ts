import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectPhysicalDefinitionLifecycleMigrationFailure,
  makePhysicalDefinitionLifecycleMigrationFixture,
  restorePhysicalDefinitionLifecycleMigration,
  writePhysicalDefinitionLifecycleJournalThrough,
} from "./physicalDefinitionLifecycleMigrationSupport";

describe("M05-B1 physical-definition lifecycle migration - PGlite", () => {
  it("upgrades populated state atomically, replays, and refuses corrupt rows", async () => {
    const fixture = await makePhysicalDefinitionLifecycleMigrationFixture(
      "pglite",
    );
    try {
      await writePhysicalDefinitionLifecycleJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        66,
      );
      const persistence = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await persistence.migrate();
      await persistence.query(
        `insert into fx_system_scope_clock
          (scope_id, storage_generation, storage_generation_fence,
           last_commit_seq, last_outbox_seq, epoch)
         values ('scope_91000000-0000-4000-8000-000000000001',
           'flarexdb_v1', 1, 0, 0,
           'epoch_92000000-0000-4000-8000-000000000001')`,
      );
      await writePhysicalDefinitionLifecycleJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        67,
      );
      await injectPhysicalDefinitionLifecycleMigrationFailure(
        fixture.migrationPath,
      );
      await expect(persistence.migrate()).rejects.toThrow();
      expect(await tableCount(persistence)).toBe(0);

      await restorePhysicalDefinitionLifecycleMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await tableCount(persistence)).toBe(1);
      const scopes = await persistence.query<{ count: number }>(
        `select count(*)::int count from fx_system_scope_clock
          where scope_id = 'scope_91000000-0000-4000-8000-000000000001'`,
      );
      expect(scopes.rows[0]?.count).toBe(1);

      await expect(persistence.query(
        `insert into fx_system_physical_definition_lifecycle
          (scope_id, deployment_id, definition_kind, definition_id,
           lifecycle, transition_fence, physical_spec_sha256,
           request_codec_version, request_sha256, storage_generation,
           storage_generation_fence, epoch)
         values ('scope_91000000-0000-4000-8000-000000000001',
           'deployment_m05_b1', 'index', 1, 'draining', 0,
           decode(repeat('01', 32), 'hex'), 1,
           decode(repeat('02', 32), 'hex'), 'flarexdb_v1', 1,
           'epoch_92000000-0000-4000-8000-000000000001')`,
      )).rejects.toThrow();
      const rows = await persistence.query<{ count: number }>(
        `select count(*)::int count
           from fx_system_physical_definition_lifecycle`,
      );
      expect(rows.rows[0]?.count).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);
});

async function tableCount(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const result = await persistence.query<{ count: number }>(
    `select count(*)::int count
       from information_schema.tables
      where table_schema = current_schema()
        and table_name = 'fx_system_physical_definition_lifecycle'`,
  );
  return result.rows[0]?.count ?? 0;
}
