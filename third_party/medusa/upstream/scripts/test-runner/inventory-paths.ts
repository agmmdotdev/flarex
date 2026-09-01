import { existsSync } from "node:fs"
import { resolve } from "node:path"

export function filterExistingRepositoryFiles(
  repositoryRoot: string,
  paths: readonly string[]
): string[] {
  return paths.filter((path) => existsSync(resolve(repositoryRoot, path)))
}
