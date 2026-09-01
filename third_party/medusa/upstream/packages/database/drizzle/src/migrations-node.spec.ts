import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { model } from "@medusajs/dml"
import { createMedusaContainer } from "@medusajs/utils"
import { describe, expect, it } from "vitest"
import { drizzleSqliteBaselineMigrationAdapter } from "./migrations-node"

describe("drizzleSqliteBaselineMigrationAdapter", () => {
  it("generates a module-owned SQLite baseline and requires a target runner", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "drizzle-migrations-")
    )
    const Currency = model.define("currency", {
      code: model.text().primaryKey(),
    })

    try {
      const runtimeOptions = { container: createMedusaContainer() }
      const scripts =
        drizzleSqliteBaselineMigrationAdapter.createMigrationScripts({
          moduleName: "currency",
          models: [Currency],
          pathToMigrations: directory,
        })

      await scripts.generateMigration?.(runtimeOptions)

      const migration = await fs.readFile(
        path.join(directory, "drizzle-sqlite", "0001_currency.sql"),
        "utf8"
      )
      expect(migration).toContain('CREATE TABLE IF NOT EXISTS "currency"')
      await expect(scripts.runMigrations?.(runtimeOptions)).rejects.toThrow(
        "target-specific migration runner"
      )
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
