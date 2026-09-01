import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDirectory = path.dirname(fileURLToPath(import.meta.url))
const sourceDirectory = path.resolve(appDirectory, "../src")
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
])
const sourceReachInPattern =
  /(["'`])(?:[^"'`]*\.\.\/)+(?:packages\/[^"'`]*\/src\/[^"'`]*)\1|(["'`])(?:[^"'`]*packages\/[^"'`]*\/src\/[^"'`]*)\2/g

const violations = []

for (const filePath of walkSourceFiles(sourceDirectory)) {
  const content = fs.readFileSync(filePath, "utf8")
  const normalizedContent = content.replaceAll("\\", "/")

  for (const match of normalizedContent.matchAll(sourceReachInPattern)) {
    const beforeMatch = normalizedContent.slice(0, match.index)
    const line = beforeMatch.split("\n").length
    violations.push({
      filePath,
      line,
      importText: match[0],
    })
  }
}

if (violations.length) {
  throw new Error(
    `Worker runtime source import check failed. apps/medusa-cloudflare/src must not import packages/*/src directly:\n${violations
      .map(
        (violation) =>
          `- ${path.relative(
            path.resolve(appDirectory, ".."),
            violation.filePath
          )}:${violation.line} ${violation.importText}`
      )
      .join(
        "\n"
      )}\nUse a package subpath export or keep source aliases inside validation/build scripts.`
  )
}

console.log("Worker runtime source import check passed")

function* walkSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      yield* walkSourceFiles(entryPath)
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      yield entryPath
    }
  }
}
