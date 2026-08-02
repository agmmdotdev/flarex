import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  declarativeV2VerifierProgressV2Tables,
  deleteRetiredTableFixture,
  loadPresentRetiredTables,
  loadPresentV2ProgressTables,
  makeMigration0044Fixture,
  retiredDeclarativeV2VerifierProgressV1Tables,
  seedRetiredTableRow,
} from "./declarativeV2VerifierProgressV1RetirementSupport";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Declarative V2 verifier-progress V1 retirement PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting V1 retirement.",
    ).not.toBeNull();
  });
});

describePostgres("Declarative V2 verifier-progress V1 retirement - PostgreSQL", () => {
  it("fresh-migrates without V1 storage and retains V2 progress", async () => {
    await withTemporaryPostgresSchema(async databaseOptions => {
      const persistence = await createPostgresPersistence(databaseOptions);
      try {
        await expect(persistence.migrate()).resolves.toBeUndefined();
        await expect(persistence.migrate()).resolves.toBeUndefined();
        await expect(loadPresentRetiredTables(persistence)).resolves.toEqual([]);
        await expect(loadPresentV2ProgressTables(persistence)).resolves.toEqual(
          [...declarativeV2VerifierProgressV2Tables].sort(),
        );
        const version = await persistence.query<{ version: string }>(
          `select version()`,
        );
        expect(version.rows[0]?.version).toMatch(/^PostgreSQL /);
      } finally {
        await persistence.close();
      }
    });
  }, 120_000);

  it("rejects every populated V1 table atomically, then upgrades", async () => {
    const fixture = await makeMigration0044Fixture("postgres");
    try {
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        await previous.migrate();
        await previous.close();
        await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");
        const migrationSql = await readFile(fixture.migrationPath, "utf8");
        expect(migrationSql).not.toMatch(/\bcascade\b/i);
        expect(migrationSql).toMatch(/lock table[\s\S]*access exclusive mode/i);
        const current = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
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
            const receipts = await current.query<{ count: string }>(`
              select count(*)::text as count
              from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
            `);
            expect(receipts.rows).toEqual([{ count: "44" }]);
            await deleteRetiredTableFixture(current, table, scopeId);
          }

          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(loadPresentRetiredTables(current)).resolves.toEqual([]);
          await expect(loadPresentV2ProgressTables(current)).resolves.toEqual(
            [...declarativeV2VerifierProgressV2Tables].sort(),
          );
          const receipts = await current.query<{ count: string }>(`
            select count(*)::text as count
            from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations
          `);
          expect(receipts.rows).toEqual([{ count: "45" }]);
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
