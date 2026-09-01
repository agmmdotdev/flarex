import { resolve } from "node:path"

import {
  assertPassingTestRun,
  assertTestResultParity,
  normalizeTestResults,
} from "../normalize-test-results"

const repositoryRoot = resolve(process.cwd())
const resultFile = resolve(
  repositoryRoot,
  "scripts/test-runner/contracts/example.spec.ts"
)

function createAssertion(status: string): Record<string, unknown> {
  const title =
    status === "pending" || status === "skipped" ? "skipped" : status

  return {
    ancestorTitles: ["result normalizer"],
    fullName: `result normalizer ${title}`,
    status,
    title,
  }
}

function createResult(
  statuses: readonly string[],
  snapshotOverrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    success: !statuses.includes("failed"),
    snapshot: {
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
      ...snapshotOverrides,
    },
    testResults: [
      {
        assertionResults: statuses.map(createAssertion),
        name: resultFile,
      },
    ],
  }
}

describe("Jest and Vitest result normalization", () => {
  it("canonicalizes runner-specific skipped states without losing exact results", () => {
    const jestResult = normalizeTestResults(
      createResult(["passed", "failed", "pending", "todo"]),
      repositoryRoot
    )
    const vitestResult = normalizeTestResults(
      createResult(["passed", "failed", "skipped", "todo"]),
      repositoryRoot
    )

    expect(() => assertTestResultParity(jestResult, vitestResult)).not.toThrow()
    expect(jestResult).toEqual(vitestResult)
    expect(jestResult.testCounts).toEqual({
      failed: 1,
      passed: 1,
      skipped: 1,
      todo: 1,
      total: 4,
    })
    expect(jestResult.success).toBe(false)
    expect(jestResult.snapshots.matched).toBe(1)
  })

  it("rejects malformed result fields plus failed or empty runs", () => {
    const invalidSuccessResult = createResult(["passed"])
    invalidSuccessResult.success = "true"
    const failedResult = normalizeTestResults(
      createResult(["failed"]),
      repositoryRoot
    )
    const unsuccessfulResult = normalizeTestResults(
      {
        ...createResult(["passed"]),
        success: false,
      },
      repositoryRoot
    )
    const emptyResult = normalizeTestResults(
      {
        ...createResult(["passed"]),
        testResults: [],
      },
      repositoryRoot
    )

    expect(() =>
      normalizeTestResults(createResult(["unknown"]), repositoryRoot)
    ).toThrow("unsupported status")
    expect(() =>
      normalizeTestResults(invalidSuccessResult, repositoryRoot)
    ).toThrow("success must be a boolean")
    expect(() => assertPassingTestRun("Jest", failedResult)).toThrow(
      "Jest did not pass"
    )
    expect(() => assertPassingTestRun("Vitest", unsuccessfulResult)).toThrow(
      "Vitest did not pass"
    )
    expect(() => assertPassingTestRun("Vitest", emptyResult)).toThrow(
      "Vitest must collect at least one suite and one test"
    )
    expect(() =>
      normalizeTestResults(
        createResult(["passed"], { matched: "1" }),
        repositoryRoot
      )
    ).toThrow("snapshot.matched must be a non-negative integer")
  })
})
