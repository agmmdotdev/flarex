import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  deleteRetiredApplicationAnalysisCandidate,
  loadPresentRetiredApplicationAnalysisTables,
  loadRetiredApplicationAnalysisForeignKeys,
  makeMigration0064Fixture,
  retiredApplicationAnalysisTables,
  seedRetiredApplicationAnalysisCandidate,
} from "./applicationAnalysisRetirementSupport";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Application Analysis retirement PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R8 retirement.",
    ).not.toBeNull();
  });
});

describePostgres("Application Analysis retirement - PostgreSQL", () => {
  it("refuses nonempty state atomically, then completes the empty retirement", async () => {
    const fixture = await makeMigration0064Fixture("postgres");
    try {
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        await previous.migrate();
        await seedRetiredApplicationAnalysisCandidate(previous);
        await previous.close();
        await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");

        const migrationSql = await readFile(fixture.migrationPath, "utf8");
        expect(migrationSql).not.toMatch(/\bcascade\b/i);
        expect(migrationSql).toMatch(/lock table[\s\S]*access exclusive mode/i);
        for (const table of retiredApplicationAnalysisTables) {
          expect(migrationSql).toContain(`FROM "${table}" LIMIT 1`);
        }

        const current = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await expect(current.migrate()).rejects.toThrow(
            /AA-R8 retirement refused: displaced analyzer state is not empty/,
          );
          await expect(
            loadPresentRetiredApplicationAnalysisTables(current),
          ).resolves.toEqual([...retiredApplicationAnalysisTables].sort());
          const receipts = await current.query<{ count: string }>(`
            select count(*)::text as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
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
          const version = await current.query<{ version: string }>(
            `select version()`,
          );
          expect(version.rows[0]?.version).toMatch(/^PostgreSQL /);
        } finally {
          await current.close();
        }
      });
    } finally {
      await fixture.dispose();
    }
  }, 180_000);
});

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
