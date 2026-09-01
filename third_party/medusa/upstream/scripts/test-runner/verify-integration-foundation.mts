import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { isDeepStrictEqual } from "node:util"

import {
  assertPassingTestRun,
  assertTestResultParity,
  normalizeTestResults,
  type NormalizedTestRun,
} from "./normalize-test-results.ts"

type FoundationRunner = "jest" | "vitest"

interface CommandResult {
  readonly status: number
  readonly stderr: string
  readonly stdout: string
}

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const orchestratorPath = resolve(
  repositoryRoot,
  "scripts/run-pglite-integration-tests.mjs"
)
const foundationTestFile =
  "packages/medusa-test-utils/test-runner-contracts/module-test-runner-lifecycle.spec.ts"
const expectedFiles = [
  "packages/medusa-test-utils/src/__tests__/module-test-persistence-selection.spec.ts",
  "packages/medusa-test-utils/src/__tests__/pglite-module-test-persistence-adapter.spec.ts",
  foundationTestFile,
] as const
const RUNNER_TIMEOUT = 180_000

function requireStatus(
  label: string,
  result: ReturnType<typeof spawnSync>,
  expectedStatus: number
): CommandResult {
  if (result.error) {
    throw result.error
  }

  if (result.signal) {
    throw new Error(`${label} terminated with signal ${result.signal}.`)
  }

  if (result.status === null) {
    throw new Error(`${label} terminated without an exit status.`)
  }

  const status = result.status
  const stdout = result.stdout?.toString() ?? ""
  const stderr = result.stderr?.toString() ?? ""

  if (status !== expectedStatus) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    throw new Error(
      `${label} exited with ${String(status)}; expected ${String(
        expectedStatus
      )}.`
    )
  }

  return { status, stderr, stdout }
}

function runOrchestrator(
  label: string,
  arguments_: readonly string[],
  expectedStatus: number,
  environment: NodeJS.ProcessEnv = process.env
): CommandResult {
  return requireStatus(
    label,
    spawnSync(process.execPath, [orchestratorPath, ...arguments_], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      stdio: "pipe",
      timeout: RUNNER_TIMEOUT,
      windowsHide: true,
    }),
    expectedStatus
  )
}

function createOrchestratorParentEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    MEDUSA_TEST_EXPECT_GENERATED_DB_TEMP_NAME: "1",
    NODE_OPTIONS: "--no-deprecation",
    NO_COLOR: "1",
  }
  delete environment.CHUNK
  delete environment.DB_TEMP_NAME
  delete environment.JEST_WORKER_ID
  delete environment.MEDUSA_TEST_WORKER_ID
  delete environment.MEDUSA_MODULE_TEST_PERSISTENCE
  delete environment.MEDUSA_PGLITE_TESTS
  delete environment.VITEST_POOL_ID
  return environment
}

function createFoundationEnvironment(
  runner: FoundationRunner
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    MEDUSA_MODULE_TEST_PERSISTENCE: "pglite",
    MEDUSA_PGLITE_TESTS: "1",
    MEDUSA_TEST_EXPECT_GENERATED_DB_TEMP_NAME: "1",
    NODE_OPTIONS: "--no-deprecation",
    NO_COLOR: "1",
  }
  delete environment.CHUNK
  delete environment.DB_TEMP_NAME
  delete environment.JEST_WORKER_ID
  delete environment.MEDUSA_TEST_WORKER_ID
  delete environment.VITEST_POOL_ID

  if (runner === "vitest") {
    return environment
  }

  const experimentalVmModules = "--experimental-vm-modules"
  const currentNodeOptions = environment.NODE_OPTIONS?.trim() ?? ""
  environment.NODE_OPTIONS = currentNodeOptions.includes(experimentalVmModules)
    ? currentNodeOptions
    : `${currentNodeOptions} ${experimentalVmModules}`.trim()
  return environment
}

function runPnpm(
  label: string,
  arguments_: readonly string[],
  runner: FoundationRunner
): void {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", ...arguments_]
      : [...arguments_]
  const result = spawnSync(command, commandArguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: createFoundationEnvironment(runner),
    stdio: "pipe",
    timeout: RUNNER_TIMEOUT,
    windowsHide: true,
  })

  requireStatus(label, result, 0)
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
    throw new Error(
      `Refusing to clean unexpected foundation directory: ${path}`
    )
  }
}

function assertSelectorContract(): void {
  const defaultList = runOrchestrator("default lane list", ["--list"], 0)
  const defaultLines = defaultList.stdout.trim().split(/\r?\n/)
  assert.equal(defaultLines.length, 25)
  assert.match(defaultLines[0] ?? "", /^\s*1\. adapter\t/)
  assert.match(defaultLines[1] ?? "", /^\s*2\. currency\t/)
  assert.match(defaultLines.at(-1) ?? "", /^25\. order\t/)

  const explicitJest = runOrchestrator(
    "explicit Jest selector",
    ["--runner", "jest", "--only", "adapter", "--list"],
    0
  )
  assert.match(explicitJest.stdout, /^\s*1\. adapter\t/m)

  const explicitVitest = runOrchestrator(
    "explicit Vitest selector",
    ["--runner=vitest", "--only=adapter", "--list"],
    0
  )
  assert.match(explicitVitest.stdout, /^\s*1\. adapter\t/m)

  const currencyVitest = runOrchestrator(
    "Currency Vitest selector",
    ["--runner=vitest", "--only=currency", "--list"],
    0
  )
  assert.match(currencyVitest.stdout, /^\s*1\. currency\t/m)

  const apiKeyVitest = runOrchestrator(
    "API Key Vitest selector",
    ["--runner=vitest", "--only=api-key", "--list"],
    0
  )
  assert.match(apiKeyVitest.stdout, /^\s*1\. api-key\t/m)

  const translationVitest = runOrchestrator(
    "Translation Vitest selector",
    ["--runner=vitest", "--only=translation", "--list"],
    0
  )
  assert.match(translationVitest.stdout, /^\s*1\. translation\t/m)

  const settingsVitest = runOrchestrator(
    "Settings Vitest selector",
    ["--runner=vitest", "--only=settings", "--list"],
    0
  )
  assert.match(settingsVitest.stdout, /^\s*1\. settings\t/m)

  const storeVitest = runOrchestrator(
    "Store Vitest selector",
    ["--runner=vitest", "--only=store", "--list"],
    0
  )
  assert.match(storeVitest.stdout, /^\s*1\. store\t/m)

  const authVitest = runOrchestrator(
    "Auth Vitest selector",
    ["--runner=vitest", "--only=auth", "--list"],
    0
  )
  assert.match(authVitest.stdout, /^\s*1\. auth\t/m)

  const regionVitest = runOrchestrator(
    "Region Vitest selector",
    ["--runner=vitest", "--only=region", "--list"],
    0
  )
  assert.match(regionVitest.stdout, /^\s*1\. region\t/m)

  const rbacVitest = runOrchestrator(
    "RBAC Vitest selector",
    ["--runner=vitest", "--only=rbac", "--list"],
    0
  )
  assert.match(rbacVitest.stdout, /^\s*1\. rbac\t/m)

  const userVitest = runOrchestrator(
    "User Vitest selector",
    ["--runner=vitest", "--only=user", "--list"],
    0
  )
  assert.match(userVitest.stdout, /^\s*1\. user\t/m)

  const salesChannelVitest = runOrchestrator(
    "Sales Channel Vitest selector",
    ["--runner=vitest", "--only=sales-channel", "--list"],
    0
  )
  assert.match(salesChannelVitest.stdout, /^\s*1\. sales-channel\t/m)

  const fromCurrency = runOrchestrator(
    "resume lane list",
    ["--from", "currency", "--list"],
    0
  )
  const resumedLines = fromCurrency.stdout.trim().split(/\r?\n/)
  assert.equal(resumedLines.length, 24)
  assert.match(resumedLines[0] ?? "", /^\s*1\. currency\t/)

  for (const arguments_ of [
    ["--runner"],
    ["--runner="],
    ["--runner=jasmine"],
  ] as const) {
    const invalid = runOrchestrator(
      `invalid selector ${arguments_.join(" ")}`,
      arguments_,
      1
    )
    assert.match(invalid.stderr, /requires jest or vitest|Unsupported PGlite/)
  }

  const orderVitestList = runOrchestrator(
    "Order Vitest lane list",
    ["--runner=vitest", "--only=order", "--list"],
    0
  )
  assert.match(orderVitestList.stdout, /^\s*\d+\. order\t/m)

  const vitestLaneList = runOrchestrator(
    "Vitest lane list",
    ["--runner=vitest", "--list"],
    0
  )
  const vitestLines = vitestLaneList.stdout.trim().split(/\r?\n/)
  assert.equal(vitestLines.length, 25)
  assert.match(vitestLines[0] ?? "", /^\s*1\. adapter\t/)
}

assertSelectorContract()

const defaultJestExecution = runOrchestrator(
  "default Jest adapter execution",
  ["--only", "adapter"],
  0,
  createOrchestratorParentEnvironment()
)
assert.match(defaultJestExecution.stdout, /\[pglite 1\/1\]/)
assert.match(defaultJestExecution.stdout, /PGlite integration matrix passed/)
assert.match(
  `${defaultJestExecution.stdout}\n${defaultJestExecution.stderr}`,
  /Test Suites:\s+3 passed, 3 total/
)
assert.match(
  `${defaultJestExecution.stdout}\n${defaultJestExecution.stderr}`,
  /Tests:\s+34 passed, 34 total/
)

const vitestExecution = runOrchestrator(
  "Vitest adapter execution",
  ["--runner=vitest", "--only=adapter"],
  0,
  createOrchestratorParentEnvironment()
)
assert.match(vitestExecution.stdout, /\[pglite 1\/1\]/)
assert.match(vitestExecution.stdout, /PGlite integration matrix passed/)
assert.match(vitestExecution.stdout, /Test Files\s+3 passed \(3\)/)
assert.match(vitestExecution.stdout, /Tests\s+34 passed \(34\)/)

const outputDirectory = mkdtempSync(
  join(resolve(tmpdir()), "medusa-integration-foundation-")
)
const jestOutput = join(outputDirectory, "jest.json")
const vitestOutput = join(outputDirectory, "vitest.json")

try {
  runPnpm(
    "Jest integration foundation",
    [
      "--filter=@medusajs/test-utils",
      "exec",
      "jest",
      "src/__tests__/module-test-persistence-selection.spec.ts",
      "src/__tests__/pglite-module-test-persistence-adapter.spec.ts",
      "test-runner-contracts/module-test-runner-lifecycle.spec.ts",
      "--setupFiles=../../integration-tests/setup-env.js",
      "--runInBand",
      "--forceExit",
      "--json",
      `--outputFile=${jestOutput}`,
    ],
    "jest"
  )
  runPnpm(
    "Vitest integration foundation",
    [
      "--filter=@medusajs/test-utils",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.mts",
      "--reporter=json",
      `--outputFile=${vitestOutput}`,
    ],
    "vitest"
  )

  const jestResult = readNormalizedResult(jestOutput)
  const vitestResult = readNormalizedResult(vitestOutput)
  assertTestResultParity(jestResult, vitestResult)
  assertPassingTestRun("Jest", jestResult)
  assertPassingTestRun("Vitest", vitestResult)

  const actualFiles = jestResult.suites.map((suite) => suite.file)
  const sortedExpectedFiles = [...expectedFiles].sort((left, right) =>
    left.localeCompare(right)
  )
  assert.equal(isDeepStrictEqual(actualFiles, sortedExpectedFiles), true)
  assert.deepEqual(jestResult.suiteCounts, {
    failed: 0,
    passed: 3,
    skipped: 0,
    total: 3,
  })
  assert.deepEqual(jestResult.testCounts, {
    failed: 0,
    passed: 34,
    skipped: 0,
    todo: 0,
    total: 34,
  })
  assert.deepEqual(jestResult.snapshots, {
    added: 0,
    filesAdded: 0,
    filesRemoved: 0,
    filesUnmatched: 0,
    filesUpdated: 0,
    matched: 0,
    total: 0,
    unchecked: 0,
    uncheckedKeys: [],
    unmatched: 0,
    updated: 0,
  })

  console.log(
    "Integration runner foundation passed: 25 Jest-default lanes, real Jest/Vitest adapter executions, exact 3-file/34-test parity, and fail-closed unsupported Vitest lanes."
  )
} finally {
  assertSafeTemporaryDirectory(outputDirectory)
  rmSync(outputDirectory, { force: true, recursive: true })
}
