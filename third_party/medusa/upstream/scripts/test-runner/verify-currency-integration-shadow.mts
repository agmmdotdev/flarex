import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertPassingTestRun,
  assertTestResultParity,
  normalizeTestResults,
  type NormalizedTestRun,
} from "./normalize-test-results.ts"

const CURRENCY_BACKENDS = ["postgresql", "pglite", "drizzle"] as const
type CurrencyBackend = (typeof CURRENCY_BACKENDS)[number]
type CurrencyRunner = "jest" | "vitest"

interface CommandResult {
  readonly status: number
  readonly stderr: string
  readonly stdout: string
}

interface BackendParityResult {
  readonly backend: CurrencyBackend
  readonly jest: NormalizedTestRun
  readonly vitest: NormalizedTestRun
}

const RUNNER_TIMEOUT = 240_000
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const currencyPackagePath = resolve(
  repositoryRoot,
  "packages/modules/currency/package.json"
)
const currencyTestFile =
  "packages/modules/currency/integration-tests/__tests__/currency-module-service.spec.ts"
const currencyTestPath = resolve(repositoryRoot, currencyTestFile)
const expectedCurrencySourceDigest =
  "73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f"
const expectedFullNames = [
  " Currency Module Service should export the appropriate linkable configuration",
  " Currency Module Service list list currencies",
  " Currency Module Service list list currencies by code",
  " Currency Module Service list list currencies by code regardless of case-sensitivity",
  " Currency Module Service listAndCountCurrenciesCurrencies should return currencies and count",
  " Currency Module Service listAndCountCurrenciesCurrencies should return currencies and count when filtered",
  " Currency Module Service listAndCountCurrenciesCurrencies should return currencies and count when using skip and take",
  " Currency Module Service listAndCountCurrenciesCurrencies should return requested fields",
  " Currency Module Service retrieve should return currency for the given code",
  " Currency Module Service retrieve should return currency for the given code in a case-insensitive manner",
  " Currency Module Service retrieve should throw an error when a code is not provided",
  " Currency Module Service retrieve should throw an error when currency with code does not exist",
  " Currency Module Service retrieve should return currency based on config select param",
].sort((left, right) => left.localeCompare(right))

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireStatus(
  label: string,
  result: ReturnType<typeof spawnSync>,
  expectedStatus = 0
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

  const stdout = result.stdout?.toString() ?? ""
  const stderr = result.stderr?.toString() ?? ""

  if (result.status !== expectedStatus) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
    throw new Error(
      `${label} exited with ${String(result.status)}; expected ${String(
        expectedStatus
      )}.`
    )
  }

  return { status: result.status, stderr, stdout }
}

function runPnpm(
  label: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv
): CommandResult {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", ...arguments_]
      : [...arguments_]

  return requireStatus(
    label,
    spawnSync(command, commandArguments, {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 10 * 1024 * 1024,
      stdio: "pipe",
      timeout: RUNNER_TIMEOUT,
      windowsHide: true,
    })
  )
}

function createControlledEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NODE_OPTIONS: "--no-deprecation",
    NO_COLOR: "1",
    PGTZ: "UTC",
    TZ: "UTC",
  }

  for (const key of [
    "CHUNK",
    "DATABASE_URL",
    "DB_TEMP_NAME",
    "JEST_WORKER_ID",
    "MEDUSA_MODULE_TEST_PERSISTENCE",
    "MEDUSA_PGLITE_TESTS",
    "MEDUSA_TEST_WORKER_ID",
    "PGHOST",
    "PGPASSWORD",
    "PGPORT",
    "PGUSER",
    "VITEST_POOL_ID",
  ] as const) {
    delete environment[key]
  }

  return environment
}

function requirePostgresEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of ["DB_HOST", "DB_PORT", "DB_USERNAME"] as const) {
    if (!environment[key]) {
      throw new Error(
        `Currency PostgreSQL parity requires an explicit ${key} value.`
      )
    }
  }
}

function createBackendEnvironment(
  backend: CurrencyBackend,
  runner: CurrencyRunner
): NodeJS.ProcessEnv {
  const environment = createControlledEnvironment()

  if (backend === "postgresql") {
    requirePostgresEnvironment(environment)
  } else {
    for (const key of [
      "DB_HOST",
      "DB_PASSWORD",
      "DB_PORT",
      "DB_USERNAME",
    ] as const) {
      delete environment[key]
    }

    environment.MEDUSA_MODULE_TEST_PERSISTENCE = backend
    if (backend === "pglite") {
      environment.MEDUSA_PGLITE_TESTS = "1"
    }
  }

  if (runner === "jest") {
    environment.NODE_OPTIONS = `${
      environment.NODE_OPTIONS ?? ""
    } --experimental-vm-modules`.trim()
  }

  return environment
}

function assertPackageScripts(): void {
  const packageValue: unknown = JSON.parse(
    readFileSync(currencyPackagePath, "utf8")
  )

  if (!isRecord(packageValue) || !isRecord(packageValue.scripts)) {
    throw new Error("Currency package scripts must be an object.")
  }

  assert.equal(
    packageValue.scripts["test:integration"],
    "vitest run --config vitest.integration.config.mts"
  )
  assert.equal(
    packageValue.scripts["test:integration:jest"],
    'jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\\.ts"'
  )
  assert.equal(packageValue.scripts["test:integration:vitest"], undefined)
}

function assertCurrencySource(): void {
  const source = readFileSync(currencyTestPath, "utf8").replaceAll("\r\n", "\n")
  const digest = createHash("sha256").update(source).digest("hex")

  assert.equal(digest, expectedCurrencySourceDigest)
}

function runRealPgliteSelectors(): void {
  const environment = createControlledEnvironment()
  for (const { label, arguments_, runner } of [
    {
      arguments_: ["test:integration:pglite", "--only=currency"],
      label: "Currency default-Jest PGlite selector",
      runner: "jest",
    },
    {
      arguments_: [
        "test:integration:pglite",
        "--runner=vitest",
        "--only=currency",
      ],
      label: "Currency Vitest PGlite selector",
      runner: "vitest",
    },
  ] as const) {
    const result = runPnpm(label, arguments_, environment)
    const combinedOutput = `${result.stdout}\n${result.stderr}`

    assert.match(result.stdout, /\[pglite 1\/1\] @medusajs\/currency/)
    assert.match(result.stdout, /PGlite integration matrix passed: 1 lanes\./)
    if (runner === "jest") {
      assert.match(combinedOutput, /Test Suites:\s+1 passed, 1 total/)
      assert.match(combinedOutput, /Tests:\s+13 passed, 13 total/)
    } else {
      assert.match(combinedOutput, /Test Files\s+1 passed \(1\)/)
      assert.match(combinedOutput, /Tests\s+13 passed \(13\)/)
    }
  }
}

function runReporter(
  backend: CurrencyBackend,
  runner: CurrencyRunner,
  outputPath: string
): void {
  const commonArguments = ["--filter=@medusajs/currency"] as const
  const runnerArguments =
    runner === "jest"
      ? [
          "test:integration:jest",
          "--runInBand",
          "--no-cache",
          "--json",
          `--outputFile=${outputPath}`,
        ]
      : ["test:integration", "--reporter=json", `--outputFile=${outputPath}`]

  runPnpm(
    `${backend} ${runner} reporter`,
    [...commonArguments, ...runnerArguments],
    createBackendEnvironment(backend, runner)
  )
}

function readNormalizedResult(path: string): NormalizedTestRun {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"))
  return normalizeTestResults(value, repositoryRoot)
}

function assertBackendResult(
  backend: CurrencyBackend,
  runner: CurrencyRunner,
  result: NormalizedTestRun
): void {
  assertPassingTestRun(`${backend} ${runner}`, result)
  assert.deepEqual(result.suiteCounts, {
    failed: 0,
    passed: 1,
    skipped: 0,
    total: 1,
  })
  assert.deepEqual(result.testCounts, {
    failed: 0,
    passed: 13,
    skipped: 0,
    todo: 0,
    total: 13,
  })
  assert.deepEqual(result.snapshots, {
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
  assert.deepEqual(
    result.suites.map((suite) => suite.file),
    [currencyTestFile]
  )

  const suite = result.suites[0]
  if (!suite) {
    throw new Error(`${backend} ${runner} did not report the Currency suite.`)
  }

  assert.deepEqual(
    suite.tests.map((test) => test.fullName),
    expectedFullNames
  )
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
      `Refusing to clean unexpected Currency parity path: ${path}`
    )
  }
}

assertPackageScripts()
assertCurrencySource()
requirePostgresEnvironment(createControlledEnvironment())

const outputDirectory = mkdtempSync(
  join(resolve(tmpdir()), "medusa-currency-integration-shadow-")
)
const backendResults: BackendParityResult[] = []

try {
  for (const backend of CURRENCY_BACKENDS) {
    const jestOutput = join(outputDirectory, `${backend}-jest.json`)
    const vitestOutput = join(outputDirectory, `${backend}-vitest.json`)

    runReporter(backend, "jest", jestOutput)
    runReporter(backend, "vitest", vitestOutput)

    const jestResult = readNormalizedResult(jestOutput)
    const vitestResult = readNormalizedResult(vitestOutput)
    assertTestResultParity(jestResult, vitestResult)
    assertBackendResult(backend, "jest", jestResult)
    assertBackendResult(backend, "vitest", vitestResult)
    backendResults.push({ backend, jest: jestResult, vitest: vitestResult })
  }

  const baseline = backendResults[0]
  if (!baseline) {
    throw new Error("Expected at least one Currency integration backend.")
  }

  for (const result of backendResults.slice(1)) {
    assert.deepEqual(
      result.jest,
      baseline.jest,
      `${result.backend} assertions drifted from ${baseline.backend}.`
    )
  }

  runRealPgliteSelectors()

  console.log(
    "Currency integration cut-over parity passed: Vitest default and Jest rollback have exact 1-file/13-test/0-snapshot parity on PostgreSQL, PGlite, and Drizzle/SQLite, plus real PGlite selector executions."
  )
} finally {
  assertSafeTemporaryDirectory(outputDirectory)
  rmSync(outputDirectory, { force: true, recursive: true })
}
