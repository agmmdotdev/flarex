type TimerHandle = ReturnType<typeof globalThis.setTimeout>
type IntervalHandle = ReturnType<typeof globalThis.setInterval>

export interface CloudflareWorkflowSchedulerAdapter {
  setTimeout(callback: () => void | Promise<void>, delay: number): TimerHandle
  clearTimeout(timer: TimerHandle): void
  setInterval(
    callback: () => void | Promise<void>,
    delay: number
  ): IntervalHandle
  clearInterval(timer: IntervalHandle): void
  unref?(timer: TimerHandle | IntervalHandle): void
}

export const cloudflareWorkflowSchedulerAdapter: CloudflareWorkflowSchedulerAdapter =
  {
    setTimeout: (callback, delay) => {
      return globalThis.setTimeout(async () => {
        await callback()
      }, delay)
    },
    clearTimeout: (timer) => {
      globalThis.clearTimeout(timer)
    },
    setInterval: (callback, delay) => {
      return globalThis.setInterval(async () => {
        await callback()
      }, delay)
    },
    clearInterval: (timer) => {
      globalThis.clearInterval(timer)
    },
  }
