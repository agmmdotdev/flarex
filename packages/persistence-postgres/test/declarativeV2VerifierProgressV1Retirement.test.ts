import { readFile, writeFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  declarativeV2VerifierProgressV2Tables,
  deleteRetiredTableFixture,
  loadPresentRetiredTables,
  loadPresentV2ProgressTables,
  makeMigration0044Fixture,
  retiredDeclarativeV2VerifierProgressV1Tables,
  seedRetiredTableRow,
} from "./declarativeV2VerifierProgressV1RetirementSupport";

describe("Declarative V2 verifier-progress V1 retirement migration", () => {
  it("fresh-migrates without the nine V1 tables and retains V2 progress", async () => {
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(loadPresentRetiredTables(persistence)).resolves.toEqual([]);
      await expect(loadPresentV2ProgressTables(persistence)).resolves.toEqual(
        [...declarativeV2VerifierProgressV2Tables].sort(),
      );
    } finally {
      await db.close();
    }
  });

  it("refuses every non-empty V1 table without a receipt or partial drop", async () => {
    const fixture = await makeMigration0044Fixture("pglite");
    const db = new PGlite();
    try {
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");
      const migrationSql = await readFile(fixture.migrationPath, "utf8");
      expect(migrationSql).not.toMatch(/\bcascade\b/i);
      expect(migrationSql).toMatch(/lock table[\s\S]*access exclusive mode/i);
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });

      for (
        const [ordinal, table] of
          retiredDeclarativeV2VerifierProgressV1Tables.entries()
      ) {
        const scopeId = await seedRetiredTableRow(current, table, ordinal);
        await expect(current.migrate()).rejects.toThrow(
          new RegExp(`migration 0044 cannot retire non-empty ${table}`),
        );
        await expect(loadPresentRetiredTables(current)).resolves.toEqual(
          [...retiredDeclarativeV2VerifierProgressV1Tables].sort(),
        );
        const receipts = await current.query<{ count: string }>(
          `select count(*)::text as count from drizzle.__drizzle_migrations`,
        );
        expect(receipts.rows).toEqual([{ count: "44" }]);
        await deleteRetiredTableFixture(current, table, scopeId);
      }

      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(loadPresentRetiredTables(current)).resolves.toEqual([]);
      await expect(loadPresentV2ProgressTables(current)).resolves.toEqual(
        [...declarativeV2VerifierProgressV2Tables].sort(),
      );
      const receipts = await current.query<{ count: string }>(
        `select count(*)::text as count from drizzle.__drizzle_migrations`,
      );
      expect(receipts.rows).toEqual([{ count: "47" }]);
    } finally {
      try {
        await db.close();
      } finally {
        await fixture.dispose();
      }
    }
  }, 120_000);
});
