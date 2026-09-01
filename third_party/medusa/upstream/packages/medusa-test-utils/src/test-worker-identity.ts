export type TestWorkerRunner = "vitest" | "jest" | "default"

export type TestWorkerIdentitySource =
  | "explicit"
  | "vitest"
  | "jest"
  | "default"

export interface TestWorkerIdentityInput {
  readonly explicitWorkerId?: string
  readonly vitestPoolId?: string
  readonly jestWorkerId?: string
}

export interface TestWorkerIdentity {
  readonly source: TestWorkerIdentitySource
  readonly runner: TestWorkerRunner
  /** A validated, one-based worker identifier. */
  readonly workerId: number
  /** A runner-aware suffix for database names. */
  readonly databaseSuffix: string
  /** The legacy zero-based Redis logical database projection. */
  readonly redisDatabase: number
}

interface SelectedWorkerId {
  readonly label: string
  readonly source: TestWorkerIdentitySource
  readonly value: string
}

function readTestWorkerIdentityInput(): TestWorkerIdentityInput {
  return {
    explicitWorkerId: process.env.MEDUSA_TEST_WORKER_ID,
    vitestPoolId: process.env.VITEST_POOL_ID,
    jestWorkerId: process.env.JEST_WORKER_ID,
  }
}

function selectWorkerId(input: TestWorkerIdentityInput): SelectedWorkerId {
  if (input.explicitWorkerId !== undefined) {
    return {
      label: "explicit worker override",
      source: "explicit",
      value: input.explicitWorkerId,
    }
  }

  if (input.vitestPoolId !== undefined) {
    return {
      label: "Vitest pool ID",
      source: "vitest",
      value: input.vitestPoolId,
    }
  }

  if (input.jestWorkerId !== undefined) {
    return {
      label: "Jest worker ID",
      source: "jest",
      value: input.jestWorkerId,
    }
  }

  return {
    label: "default worker ID",
    source: "default",
    value: "1",
  }
}

function resolveRunner(input: TestWorkerIdentityInput): TestWorkerRunner {
  if (input.vitestPoolId !== undefined) {
    return "vitest"
  }

  if (input.jestWorkerId !== undefined) {
    return "jest"
  }

  return "default"
}

function parseWorkerId(selected: SelectedWorkerId): number {
  if (!/^[1-9]\d*$/.test(selected.value)) {
    throw new Error(
      `Invalid ${selected.label} "${selected.value}": expected a positive safe integer.`
    )
  }

  const workerId = Number(selected.value)

  if (!Number.isSafeInteger(workerId)) {
    throw new Error(
      `Invalid ${selected.label} "${selected.value}": expected a positive safe integer.`
    )
  }

  return workerId
}

export function resolveTestWorkerIdentity(
  input: TestWorkerIdentityInput = readTestWorkerIdentityInput()
): TestWorkerIdentity {
  const selected = selectWorkerId(input)
  const runner = resolveRunner(input)
  const workerId = parseWorkerId(selected)

  return Object.freeze({
    source: selected.source,
    runner,
    workerId,
    databaseSuffix:
      runner === "vitest" ? `vitest-${workerId}` : String(workerId),
    redisDatabase: workerId - 1,
  })
}
