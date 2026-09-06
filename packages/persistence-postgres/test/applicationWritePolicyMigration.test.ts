import { it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPGlitePersistence } from "../src/pglite";
import { makeDrizzleCopyFixture, writeJournalThrough } from "./migrationFixtureSupport";
import { applicationWritePolicyMigrationScenario } from "./applicationWritePolicyMigrationScenario";

it("upgrades write policy atomically, preserves retained bytes and replays (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-policy", "pglite", "0086_application_write_ownership.sql");
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 74);
    const db = new PGlite();
    const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
    try { await applicationWritePolicyMigrationScenario(persistence, fixture); }
    finally { await db.close(); }
  } finally { await fixture.cleanup(); }
}, 90_000);
