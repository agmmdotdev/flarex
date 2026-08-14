import { readFile, writeFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  deleteRetiredApplicationAnalysisCandidate,
  loadPresentRetiredApplicationAnalysisTables,
  loadRetiredApplicationAnalysisForeignKeys,
  makeMigration0064Fixture,
  retiredApplicationAnalysisTables,
  seedRetiredApplicationAnalysisCandidate,
} from "./applicationAnalysisRetirementSupport";

describe("Application Analysis retirement migration", () => {
  it("fresh-migrates without the displaced analyzer graph", async () => {
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(
        loadPresentRetiredApplicationAnalysisTables(persistence),
      ).resolves.toEqual([]);
      await expect(
        loadRetiredApplicationAnalysisForeignKeys(persistence),
      ).resolves.toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("refuses nonempty displaced state atomically, then retires it", async () => {
    const fixture = await makeMigration0064Fixture("pglite");
    const db = new PGlite();
    try {
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      await seedRetiredApplicationAnalysisCandidate(previous);
      await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");

      const migrationSql = await readFile(fixture.migrationPath, "utf8");
      expect(migrationSql).not.toMatch(/\bcascade\b/i);
      expect(migrationSql).toMatch(/lock table[\s\S]*access exclusive mode/i);
      for (const table of retiredApplicationAnalysisTables) {
        expect(migrationSql).toContain(`FROM "${table}" LIMIT 1`);
      }

      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).rejects.toThrow(
        /AA-R8 retirement refused: displaced analyzer state is not empty/,
      );
      await expect(
        loadPresentRetiredApplicationAnalysisTables(current),
      ).resolves.toEqual([...retiredApplicationAnalysisTables].sort());
      const receipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "64" }]);

      await deleteRetiredApplicationAnalysisCandidate(current);
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(
        loadPresentRetiredApplicationAnalysisTables(current),
      ).resolves.toEqual([]);
      await expect(
        loadRetiredApplicationAnalysisForeignKeys(current),
      ).resolves.toEqual([]);
    } finally {
      try {
        await db.close();
      } finally {
        await fixture.dispose();
      }
    }
  }, 120_000);
});
