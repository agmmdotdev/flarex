import { it } from "vitest";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../../support/migrationFixtureSupport";
import { applicationWritePolicyMigrationScenario } from "./applicationWritePolicyMigrationScenario";

it("upgrades write policy atomically, preserves retained bytes and replays (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-policy", "pglite", "0086_application_write_ownership.sql");
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 74);
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
    try { await applicationWritePolicyMigrationScenario(persistence, fixture); }
    finally { await db.close(); }
  } finally { await fixture.cleanup(); }
}, 90_000);
