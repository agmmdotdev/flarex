import { cloudflareWorkflowSchedulerAdapter } from "../scheduler-adapter"

describe("cloudflareWorkflowSchedulerAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("delegates timers to Worker-compatible global timer APIs", () => {
    const timeout = 1 as unknown as ReturnType<typeof globalThis.setTimeout>
    const interval = 2 as unknown as ReturnType<typeof globalThis.setInterval>
    const setTimeoutMock = jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((() => timeout) as typeof globalThis.setTimeout)
    const clearTimeoutMock = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation((() => undefined) as typeof globalThis.clearTimeout)
    const setIntervalMock = jest
      .spyOn(globalThis, "setInterval")
      .mockImplementation((() => interval) as typeof globalThis.setInterval)
    const clearIntervalMock = jest
      .spyOn(globalThis, "clearInterval")
      .mockImplementation((() => undefined) as typeof globalThis.clearInterval)

    const timeoutCallback = jest.fn()
    const intervalCallback = jest.fn()

    expect(
      cloudflareWorkflowSchedulerAdapter.setTimeout(timeoutCallback, 1000)
    ).toBe(timeout)
    expect(
      cloudflareWorkflowSchedulerAdapter.setInterval(intervalCallback, 2000)
    ).toBe(interval)

    cloudflareWorkflowSchedulerAdapter.clearTimeout(timeout)
    cloudflareWorkflowSchedulerAdapter.clearInterval(interval)

    expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 1000)
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 2000)
    expect(clearTimeoutMock).toHaveBeenCalledWith(timeout)
    expect(clearIntervalMock).toHaveBeenCalledWith(interval)
  })

  it("does not provide a cron parser", () => {
    expect("parseCron" in cloudflareWorkflowSchedulerAdapter).toBe(false)
  })
})
