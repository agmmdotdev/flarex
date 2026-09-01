import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)
const source = path.join(packageDirectory, "src/migrations/drizzle-sqlite")
const destination = path.join(
  packageDirectory,
  "dist/migrations/drizzle-sqlite"
)

await fs.mkdir(destination, { recursive: true })
for (const entry of await fs.readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    await fs.copyFile(
      path.join(source, entry.name),
      path.join(destination, entry.name)
    )
  }
}
