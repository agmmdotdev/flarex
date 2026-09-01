import fs from "node:fs/promises"
import path from "node:path"
import type {
  ModuleMigrationAdapter,
  ModulePersistenceModel,
} from "@medusajs/types"
import type { PortableEntity } from "@medusajs/dml"
import { renderD1MigrationSql } from "./d1"
import { compileDmlSchema } from "./schema"

export const drizzleSqliteBaselineMigrationAdapter: ModuleMigrationAdapter = {
  name: "drizzle-sqlite-baseline",

  createMigrationScripts({ moduleName, models, pathToMigrations }) {
    return {
      async generateMigration() {
        const entities = models.filter(isPortableEntity)
        if (entities.length !== models.length) {
          throw new Error(
            `Drizzle SQLite migrations require DML models for module ${moduleName}`
          )
        }

        const outputDirectory = path.join(pathToMigrations, "drizzle-sqlite")
        const outputPath = path.join(outputDirectory, `0001_${moduleName}.sql`)
        const sql = `-- Generated baseline from Medusa ${moduleName} DML. Do not edit.
${renderD1MigrationSql(compileDmlSchema(entities))}`

        await fs.mkdir(outputDirectory, { recursive: true })
        await fs.writeFile(outputPath, sql)
      },
      async runMigrations() {
        throw new Error(
          "Drizzle SQLite migrations require a target-specific migration runner"
        )
      },
      async revertMigration() {
        throw new Error(
          "Drizzle SQLite migrations require a target-specific migration runner"
        )
      },
    }
  },
}

function isPortableEntity(
  model: ModulePersistenceModel
): model is PortableEntity & ModulePersistenceModel {
  return Boolean(
    model &&
      typeof model === "object" &&
      "parse" in model &&
      typeof model.parse === "function"
  )
}
