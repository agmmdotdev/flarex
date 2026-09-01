import { readFileSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import {
  assertPassingTestRun,
  assertTestResultParity,
  normalizeTestResults,
} from "./normalize-test-results.ts"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const [jestResultPath, vitestResultPath, ...expectedFileArguments] =
  process.argv.slice(2)

function readUnknownJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function normalizeExpectedFile(path: string): string {
  const absolutePath = isAbsolute(path)
    ? resolve(path)
    : resolve(repositoryRoot, path)
  const relativePath = relative(repositoryRoot, absolutePath)

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Expected test file is outside the repository: ${path}`)
  }

  return relativePath.replaceAll("\\", "/")
}

if (
  jestResultPath === undefined ||
  vitestResultPath === undefined ||
  expectedFileArguments.length === 0
) {
  throw new Error(
    "Usage: compare-test-results.mts <jest.json> <vitest.json> <expected-file> [expected-file...]"
  )
}

const jestResult = normalizeTestResults(
  readUnknownJson(jestResultPath),
  repositoryRoot
)
const vitestResult = normalizeTestResults(
  readUnknownJson(vitestResultPath),
  repositoryRoot
)

assertTestResultParity(jestResult, vitestResult)
assertPassingTestRun("Jest", jestResult)
assertPassingTestRun("Vitest", vitestResult)

const expectedFiles = expectedFileArguments
  .map(normalizeExpectedFile)
  .sort((left, right) => left.localeCompare(right))
const actualFiles = jestResult.suites.map((suite) => suite.file)

if (!isDeepStrictEqual(actualFiles, expectedFiles)) {
  throw new Error(
    `Shadow discovery drifted. Expected ${JSON.stringify(
      expectedFiles
    )}, received ${JSON.stringify(actualFiles)}.`
  )
}

console.log(
  `Exact shadow parity passed: ${jestResult.suiteCounts.total} files, ${jestResult.testCounts.passed} passed, ${jestResult.testCounts.failed} failed, ${jestResult.testCounts.skipped} skipped, ${jestResult.testCounts.todo} todo, ${jestResult.snapshots.total} snapshots.`
)
