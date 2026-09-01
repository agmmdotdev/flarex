const callable = jest.fn((value: string) => value.length)
const target = {
  read: (): string => "value",
}

void callable("value")
void jest.spyOn(target, "read")
void jest.clearAllMocks()
void jest.restoreAllMocks()
void jest.setTimeout(5_000)
void jest.useFakeTimers().setSystemTime(1_700_000_000_000)
void jest.useRealTimers()

// @ts-expect-error The frozen bridge is readonly at compile time too.
jest.fn = jest.fn
// @ts-expect-error Module mocking requires a dedicated hoisting contract.
jest.mock("./module")
// @ts-expect-error Broader timer controls remain outside the narrow bridge.
jest.useFakeTimers().advanceTimersByTime(1_000)
// @ts-expect-error Module isolation is outside the early-wave bridge.
jest.resetModules()
