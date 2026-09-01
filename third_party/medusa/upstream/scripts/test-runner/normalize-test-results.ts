import { isDeepStrictEqual } from "node:util"
import { isAbsolute, relative, resolve, sep } from "node:path"

export type NormalizedTestStatus = "failed" | "passed" | "skipped" | "todo"

export interface NormalizedTestCase {
  readonly ancestorTitles: readonly string[]
  readonly fullName: string
  readonly status: NormalizedTestStatus
  readonly title: string
}

export interface NormalizedTestSuite {
  readonly file: string
  readonly status: Exclude<NormalizedTestStatus, "todo">
  readonly tests: readonly NormalizedTestCase[]
}

export interface NormalizedResultCounts {
  readonly failed: number
  readonly passed: number
  readonly skipped: number
  readonly todo: number
  readonly total: number
}

export interface NormalizedSnapshotSummary {
  readonly added: number
  readonly filesAdded: number
  readonly filesRemoved: number
  readonly filesUnmatched: number
  readonly filesUpdated: number
  readonly matched: number
  readonly total: number
  readonly unchecked: number
  readonly uncheckedKeys: readonly string[]
  readonly unmatched: number
  readonly updated: number
}

export interface NormalizedTestRun {
  readonly snapshots: NormalizedSnapshotSummary
  readonly success: boolean
  readonly suites: readonly NormalizedTestSuite[]
  readonly suiteCounts: Omit<NormalizedResultCounts, "todo">
  readonly testCounts: NormalizedResultCounts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return value
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }

  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`)
  }

  return value
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`)
  }

  return value
}

function optionalCount(
  record: Record<string, unknown>,
  key: string,
  label: string
): number {
  const value = record[key]

  if (value === undefined) {
    return 0
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative integer.`)
  }

  return value
}

function normalizeStatus(value: unknown, label: string): NormalizedTestStatus {
  switch (value) {
    case "failed":
    case "passed":
    case "todo":
      return value
    case "disabled":
    case "pending":
    case "skipped":
      return "skipped"
    default:
      throw new Error(`${label} has unsupported status ${String(value)}.`)
  }
}

function normalizeFilePath(file: string, repositoryRoot: string): string {
  const absoluteFile = isAbsolute(file)
    ? resolve(file)
    : resolve(repositoryRoot, file)
  const relativeFile = relative(resolve(repositoryRoot), absoluteFile)

  if (
    relativeFile === "" ||
    relativeFile === ".." ||
    relativeFile.startsWith(`..${sep}`) ||
    isAbsolute(relativeFile)
  ) {
    throw new Error(`Test result path is outside the repository: ${file}`)
  }

  return relativeFile.replaceAll("\\", "/")
}

function normalizeTestCase(
  value: unknown,
  suiteLabel: string,
  index: number
): NormalizedTestCase {
  const label = `${suiteLabel}.assertionResults[${index}]`
  const test = requireRecord(value, label)
  const ancestorTitles = requireArray(
    test.ancestorTitles,
    `${label}.ancestorTitles`
  ).map((ancestor, ancestorIndex) =>
    requireString(ancestor, `${label}.ancestorTitles[${ancestorIndex}]`)
  )

  return {
    ancestorTitles,
    fullName: requireString(test.fullName, `${label}.fullName`),
    status: normalizeStatus(test.status, `${label}.status`),
    title: requireString(test.title, `${label}.title`),
  }
}

function deriveSuiteStatus(
  tests: readonly NormalizedTestCase[]
): NormalizedTestSuite["status"] {
  if (tests.some((test) => test.status === "failed")) {
    return "failed"
  }

  if (tests.some((test) => test.status === "passed")) {
    return "passed"
  }

  return "skipped"
}

function normalizeSuite(
  value: unknown,
  repositoryRoot: string,
  index: number
): NormalizedTestSuite {
  const label = `testResults[${index}]`
  const suite = requireRecord(value, label)
  const fileValue = suite.name ?? suite.testFilePath
  const tests = requireArray(
    suite.assertionResults,
    `${label}.assertionResults`
  )
    .map((test, testIndex) => normalizeTestCase(test, label, testIndex))
    .sort((left, right) => {
      const fullNameOrder = left.fullName.localeCompare(right.fullName)
      return fullNameOrder === 0
        ? left.status.localeCompare(right.status)
        : fullNameOrder
    })

  return {
    file: normalizeFilePath(
      requireString(fileValue, `${label}.name`),
      repositoryRoot
    ),
    status: deriveSuiteStatus(tests),
    tests,
  }
}

function normalizeSnapshots(
  root: Record<string, unknown>
): NormalizedSnapshotSummary {
  const value = root.snapshot

  if (value === undefined) {
    return {
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
    }
  }

  const snapshot = requireRecord(value, "snapshot")
  const uncheckedKeysValue = snapshot.uncheckedKeys ?? []
  const uncheckedKeys = requireArray(
    uncheckedKeysValue,
    "snapshot.uncheckedKeys"
  )
    .map((key, index) => requireString(key, `snapshot.uncheckedKeys[${index}]`))
    .sort((left, right) => left.localeCompare(right))

  return {
    added: optionalCount(snapshot, "added", "snapshot"),
    filesAdded: optionalCount(snapshot, "filesAdded", "snapshot"),
    filesRemoved: optionalCount(snapshot, "filesRemoved", "snapshot"),
    filesUnmatched: optionalCount(snapshot, "filesUnmatched", "snapshot"),
    filesUpdated: optionalCount(snapshot, "filesUpdated", "snapshot"),
    matched: optionalCount(snapshot, "matched", "snapshot"),
    total: optionalCount(snapshot, "total", "snapshot"),
    unchecked: optionalCount(snapshot, "unchecked", "snapshot"),
    uncheckedKeys,
    unmatched: optionalCount(snapshot, "unmatched", "snapshot"),
    updated: optionalCount(snapshot, "updated", "snapshot"),
  }
}

function countTests(
  suites: readonly NormalizedTestSuite[]
): NormalizedResultCounts {
  const tests = suites.flatMap((suite) => suite.tests)

  return {
    failed: tests.filter((test) => test.status === "failed").length,
    passed: tests.filter((test) => test.status === "passed").length,
    skipped: tests.filter((test) => test.status === "skipped").length,
    todo: tests.filter((test) => test.status === "todo").length,
    total: tests.length,
  }
}

function countSuites(
  suites: readonly NormalizedTestSuite[]
): Omit<NormalizedResultCounts, "todo"> {
  return {
    failed: suites.filter((suite) => suite.status === "failed").length,
    passed: suites.filter((suite) => suite.status === "passed").length,
    skipped: suites.filter((suite) => suite.status === "skipped").length,
    total: suites.length,
  }
}

export function normalizeTestResults(
  value: unknown,
  repositoryRoot: string
): NormalizedTestRun {
  const result = requireRecord(value, "test result")
  const suites = requireArray(result.testResults, "testResults")
    .map((suite, index) => normalizeSuite(suite, repositoryRoot, index))
    .sort((left, right) => left.file.localeCompare(right.file))

  return {
    snapshots: normalizeSnapshots(result),
    success: requireBoolean(result.success, "success"),
    suites,
    suiteCounts: countSuites(suites),
    testCounts: countTests(suites),
  }
}

export function assertPassingTestRun(
  runner: string,
  result: NormalizedTestRun
): void {
  if (result.suiteCounts.total === 0 || result.testCounts.total === 0) {
    throw new Error(
      `${runner} must collect at least one suite and one test before parity can pass.`
    )
  }

  if (
    !result.success ||
    result.suiteCounts.failed > 0 ||
    result.testCounts.failed > 0
  ) {
    throw new Error(
      `${runner} did not pass: ${result.suiteCounts.failed} failed suites and ${result.testCounts.failed} failed tests.`
    )
  }
}

export function assertTestResultParity(
  jestResult: NormalizedTestRun,
  vitestResult: NormalizedTestRun
): void {
  if (isDeepStrictEqual(jestResult, vitestResult)) {
    return
  }

  throw new Error(
    [
      "Jest and Vitest normalized results differ.",
      "Jest:",
      JSON.stringify(jestResult, null, 2),
      "Vitest:",
      JSON.stringify(vitestResult, null, 2),
    ].join("\n")
  )
}
