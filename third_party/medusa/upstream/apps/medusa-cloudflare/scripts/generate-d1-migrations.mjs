import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { compileDmlSchema, renderD1MigrationSql } from "@medusajs/drizzle"
import { drizzleSqliteBaselineMigrationAdapter } from "@medusajs/drizzle/migrations/node"
import { Currency } from "@medusajs/currency/models"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.join(appDirectory, "../migrations/0001_currency.sql")
const moduleMigrationsPath = path.join(
  appDirectory,
  "../../../packages/modules/currency/src/migrations"
)
const moduleMigrationPath = path.join(
  moduleMigrationsPath,
  "drizzle-sqlite/0001_currency.sql"
)
const check = process.argv.includes("--check")
const generated = `-- Generated baseline from Medusa currency DML. Do not edit.
${renderD1MigrationSql(compileDmlSchema([Currency]))}`

if (check) {
  const [moduleMigration, appMigration] = await Promise.all([
    fs.readFile(moduleMigrationPath, "utf8"),
    fs.readFile(outputPath, "utf8"),
  ])
  if (moduleMigration !== generated) {
    throw new Error(
      "Currency drizzle-sqlite/0001_currency.sql is stale. Run generate:d1-migrations."
    )
  }
  if (appMigration !== moduleMigration) {
    throw new Error(
      "Cloudflare migrations/0001_currency.sql does not match the module-owned Currency migration."
    )
  }
} else {
  const scripts = drizzleSqliteBaselineMigrationAdapter.createMigrationScripts({
    moduleName: "currency",
    models: [Currency],
    pathToMigrations: moduleMigrationsPath,
  })
  await scripts.generateMigration({})
  await fs.copyFile(moduleMigrationPath, outputPath)
}
