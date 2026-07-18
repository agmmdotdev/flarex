import { stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultMigrationsFolder } from "../src/defaultMigrationsFolder";

describe("default migrations folder", () => {
  it("resolves the migrations shipped with the persistence package", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const migrationsFolder = defaultMigrationsFolder();
    const migrationJournal = await stat(
      resolve(migrationsFolder, "meta/_journal.json"),
    );

    expect(isAbsolute(migrationsFolder)).toBe(true);
    expect(migrationsFolder).toBe(resolve(packageRoot, "drizzle"));
    expect(migrationJournal.isFile()).toBe(true);
  });
});
