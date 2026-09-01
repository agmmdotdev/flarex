import type {
  IAnalyticsProvider,
  ProviderIdentifyAnalyticsEventDTO,
  ProviderTrackAnalyticsEventDTO,
} from "@medusajs/types"

const trackedEvents: ProviderTrackAnalyticsEventDTO[] = []
const identifiedEvents: ProviderIdentifyAnalyticsEventDTO[] = []

export class WorkerMemoryAnalyticsProvider implements IAnalyticsProvider {
  static identifier = "worker-memory-analytics"

  async track(data: ProviderTrackAnalyticsEventDTO): Promise<void> {
    trackedEvents.push(data)
  }

  async identify(data: ProviderIdentifyAnalyticsEventDTO): Promise<void> {
    identifiedEvents.push(data)
  }
}

export const workerMemoryAnalyticsProvider = {
  services: [WorkerMemoryAnalyticsProvider],
}

export function resetWorkerMemoryAnalytics(): void {
  trackedEvents.length = 0
  identifiedEvents.length = 0
}

export function getWorkerMemoryAnalyticsSnapshot(): {
  tracked: ProviderTrackAnalyticsEventDTO[]
  identified: ProviderIdentifyAnalyticsEventDTO[]
} {
  return {
    tracked: [...trackedEvents],
    identified: [...identifiedEvents],
  }
}
