import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { isNonArrayRecord } from "@flarex/utils/records";

import { defaultMigrationsFolder } from "./defaultMigrationsFolder";

const APPLICATION_ANALYSIS_RETIREMENT_MIGRATION_INDEX = 64;

/** Runs a retained historical proof against the last pre-retirement schema. */
export async function withHistoricalApplicationAnalysisMigrations<T>(
  run: (migrationsFolder: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(
    resolve(tmpdir(), "flarex-historical-application-analysis-"),
  );
  const migrationsFolder = resolve(root, "drizzle");
  try {
    await cp(defaultMigrationsFolder(), migrationsFolder, { recursive: true });
    const journalPath = resolve(migrationsFolder, "meta/_journal.json");
    const journal = migrationJournalBeforeRetirement(
      await readFile(journalPath, "utf8"),
    );
    await writeFile(journalPath, journal, "utf8");
    return await run(migrationsFolder);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function migrationJournalBeforeRetirement(journal: string): string {
  const parsed: unknown = JSON.parse(journal);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Expected a Drizzle migration journal.");
  }
  return `${JSON.stringify(
    {
      ...parsed,
      entries: parsed.entries.filter(
        (entry) =>
          isNonArrayRecord(entry) &&
          typeof entry.idx === "number" &&
          entry.idx < APPLICATION_ANALYSIS_RETIREMENT_MIGRATION_INDEX,
      ),
    },
    null,
    2,
  )}\n`;
}
