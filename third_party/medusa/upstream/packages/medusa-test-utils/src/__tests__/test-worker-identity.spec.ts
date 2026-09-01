import {
  resolveTestWorkerIdentity,
  type TestWorkerIdentity,
  type TestWorkerIdentityInput,
} from "../test-worker-identity"

const expectIdentity = (
  input: TestWorkerIdentityInput,
  expected: TestWorkerIdentity
): void => {
  expect(resolveTestWorkerIdentity(input)).toEqual(expected)
}

describe("test worker identity", () => {
  it("preserves the default single-worker identity", () => {
    expectIdentity(
      {},
      {
        source: "default",
        runner: "default",
        workerId: 1,
        databaseSuffix: "1",
        redisDatabase: 0,
      }
    )
  })

  it("preserves Jest database and Redis worker values", () => {
    expectIdentity(
      { jestWorkerId: "3" },
      {
        source: "jest",
        runner: "jest",
        workerId: 3,
        databaseSuffix: "3",
        redisDatabase: 2,
      }
    )

    const identity = resolveTestWorkerIdentity({ jestWorkerId: "3" })

    expect(`medusa-currency-integration-${identity.databaseSuffix}`).toBe(
      "medusa-currency-integration-3"
    )
    expect(`medusa-integration-${identity.databaseSuffix}-2`).toBe(
      "medusa-integration-3-2"
    )
  })

  it("uses the bounded Vitest pool identity and a separate database namespace", () => {
    expectIdentity(
      { vitestPoolId: "3", jestWorkerId: "8" },
      {
        source: "vitest",
        runner: "vitest",
        workerId: 3,
        databaseSuffix: "vitest-3",
        redisDatabase: 2,
      }
    )
  })

  it("lets an explicit worker slot override runner-provided values", () => {
    expectIdentity(
      {
        explicitWorkerId: "7",
        vitestPoolId: "3",
        jestWorkerId: "8",
      },
      {
        source: "explicit",
        runner: "vitest",
        workerId: 7,
        databaseSuffix: "vitest-7",
        redisDatabase: 6,
      }
    )

    expectIdentity(
      { explicitWorkerId: "7", jestWorkerId: "8" },
      {
        source: "explicit",
        runner: "jest",
        workerId: 7,
        databaseSuffix: "7",
        redisDatabase: 6,
      }
    )
  })

  it("rejects malformed selected worker identifiers", () => {
    const invalidValues = [
      "",
      " ",
      "0",
      "-1",
      "+1",
      "01",
      "1.5",
      "1e2",
      "2worker",
      String(Number.MAX_SAFE_INTEGER + 1),
    ] as const

    const inputFactories = [
      (value: string): TestWorkerIdentityInput => ({
        explicitWorkerId: value,
      }),
      (value: string): TestWorkerIdentityInput => ({ vitestPoolId: value }),
      (value: string): TestWorkerIdentityInput => ({ jestWorkerId: value }),
    ] as const

    for (const value of invalidValues) {
      for (const createInput of inputFactories) {
        expect(() => resolveTestWorkerIdentity(createInput(value))).toThrow(
          "expected a positive safe integer"
        )
      }
    }
  })

  it("accepts the largest safe positive worker identifier", () => {
    const value = String(Number.MAX_SAFE_INTEGER)
    const identity = resolveTestWorkerIdentity({ explicitWorkerId: value })

    expect(identity.workerId).toBe(Number.MAX_SAFE_INTEGER)
    expect(identity.databaseSuffix).toBe(value)
    expect(identity.redisDatabase).toBe(Number.MAX_SAFE_INTEGER - 1)
  })
})
