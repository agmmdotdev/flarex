import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultMigrationsFolder } from "../../src/installation/defaultMigrationsFolder";
import { writeJournalThrough } from "../support/migrationFixtureSupport";

describe("default migrations folder", () => {
  it("resolves the migrations shipped with the persistence package", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const migrationsFolder = defaultMigrationsFolder();
    const migrationJournal = await stat(
      resolve(migrationsFolder, "meta/_journal.json"),
    );

    expect(isAbsolute(migrationsFolder)).toBe(true);
    expect(migrationsFolder).toBe(resolve(packageRoot, "drizzle"));
    expect(migrationJournal.isFile()).toBe(true);
  });
});

describe("migration fixture journal", () => {
  it("preserves journal metadata and order while bounding entries, and refuses malformed indexes without overwriting the target", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "flarex-journal-contract-"));
    const source = resolve(root, "source.json");
    const target = resolve(root, "target.json");
    const entry = { version: "7", when: 1781884841045, tag: "fixture", breakpoints: true, extra: { enabled: true } };
    const journal = { version: "7", dialect: "postgresql", extra: ["retained"],
      entries: [{ ...entry, idx: 2 }, { ...entry, idx: 0 }, { ...entry, idx: 3 }] };
    try {
      await writeFile(source, JSON.stringify(journal));
      await writeJournalThrough(source, target, 2);
      const bounded = await readFile(target, "utf8");
      expect(JSON.parse(bounded)).toEqual({ ...journal, entries: journal.entries.slice(0, 2) });

      for (const invalidIndex of [null, "2", 1.5]) {
        await writeFile(source, JSON.stringify({ ...journal, entries: [{ ...entry, idx: invalidIndex }] }));
        await expect(writeJournalThrough(source, target, 2)).rejects.toThrow();
        expect(await readFile(target, "utf8")).toBe(bounded);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
