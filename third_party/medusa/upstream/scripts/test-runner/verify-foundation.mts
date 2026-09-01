import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import {
  assertTestResultParity,
  normalizeTestResults,
  type NormalizedTestRun,
} from "./normalize-test-results.ts"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const parityFiles = [
  "scripts/test-runner/contracts/__tests__/runner-compatibility.ts",
  "scripts/test-runner/contracts/decorator-metadata.spec.ts",
  "scripts/test-runner/contracts/normalize-test-results.spec.ts",
  "packages/core/utils/src/dal/mikro-orm/__tests__/big-number-field.spec.ts",
  "packages/core/utils/src/modules-sdk/decorators/__tests__/emit-events.ts",
] as const

function runPnpm(label: string, arguments_: readonly string[]): void {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", ...arguments_]
      : [...arguments_]
  const result = spawnSync(command, commandArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdio: "pipe",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "")
    process.stderr.write(result.stderr ?? "")
    throw new Error(`${label} failed with exit code ${String(result.status)}.`)
  }
}

function readNormalizedResult(path: string): NormalizedTestRun {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"))
  return normalizeTestResults(value, repositoryRoot)
}

function assertSafeTemporaryDirectory(path: string): void {
  const tempRoot = resolve(tmpdir())
  const relativePath = relative(tempRoot, resolve(path))

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(dirname(path)) !== tempRoot
  ) {
    throw new Error(`Refusing to clean unexpected parity directory: ${path}`)
  }
}

const outputDirectory = mkdtempSync(
  join(resolve(tmpdir()), "medusa-runner-parity-")
)
const jestOutput = join(outputDirectory, "jest.json")
const vitestOutput = join(outputDirectory, "vitest.json")

try {
  runPnpm("Jest parity contract", [
    "exec",
    "jest",
    "--config",
    "scripts/test-runner/jest.config.cjs",
    "--runInBand",
    "--json",
    `--outputFile=${jestOutput}`,
  ])
  runPnpm("Vitest parity contract", [
    "exec",
    "vitest",
    "run",
    "--config",
    "scripts/test-runner/vitest.config.mts",
    "--maxWorkers=1",
    "--fileParallelism=false",
    "--reporter=json",
    `--outputFile=${vitestOutput}`,
  ])

  const jestResult = readNormalizedResult(jestOutput)
  const vitestResult = readNormalizedResult(vitestOutput)
  assertTestResultParity(jestResult, vitestResult)

  const expectedFiles = [...parityFiles].sort((left, right) =>
    left.localeCompare(right)
  )
  const actualFiles = jestResult.suites.map((suite) => suite.file)

  if (!isDeepStrictEqual(actualFiles, expectedFiles)) {
    throw new Error(
      `Parity discovery drifted. Expected ${JSON.stringify(
        expectedFiles
      )}, received ${JSON.stringify(actualFiles)}.`
    )
  }

  if (jestResult.suiteCounts.total !== parityFiles.length) {
    throw new Error(
      `Expected ${parityFiles.length} parity suites, received ${jestResult.suiteCounts.total}.`
    )
  }

  const expectedSuiteCounts = {
    failed: 0,
    passed: 5,
    skipped: 0,
    total: 5,
  }
  const expectedTestCounts = {
    failed: 0,
    passed: 8,
    skipped: 1,
    todo: 1,
    total: 10,
  }
  const expectedSnapshots = {
    added: 0,
    filesAdded: 0,
    filesRemoved: 0,
    filesUnmatched: 0,
    filesUpdated: 0,
    matched: 1,
    total: 1,
    unchecked: 0,
    uncheckedKeys: [],
    unmatched: 0,
    updated: 0,
  }

  if (
    !isDeepStrictEqual(jestResult.suiteCounts, expectedSuiteCounts) ||
    !isDeepStrictEqual(jestResult.testCounts, expectedTestCounts) ||
    !isDeepStrictEqual(jestResult.snapshots, expectedSnapshots)
  ) {
    throw new Error(
      `Parity totals drifted: ${JSON.stringify({
        snapshots: jestResult.snapshots,
        suiteCounts: jestResult.suiteCounts,
        testCounts: jestResult.testCounts,
      })}`
    )
  }

  console.log(
    `Jest/Vitest parity passed: ${jestResult.suiteCounts.total} files, ${jestResult.testCounts.passed} passed, ${jestResult.testCounts.skipped} skipped, ${jestResult.testCounts.todo} todo, ${jestResult.snapshots.matched} snapshot matched.`
  )
} finally {
  assertSafeTemporaryDirectory(outputDirectory)
  rmSync(outputDirectory, { force: true, recursive: true })
}
