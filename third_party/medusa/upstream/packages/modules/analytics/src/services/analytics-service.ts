import type {
  TrackAnalyticsEventDTO,
  IdentifyAnalyticsEventDTO,
} from "@medusajs/types"
import AnalyticsProviderService from "./provider-service"
import { MedusaError } from "@medusajs/framework/utils"

type InjectedDependencies = {
  analyticsProviderService: AnalyticsProviderService
}

export default class AnalyticsService {
  protected readonly analyticsProviderService_: AnalyticsProviderService

  constructor({ analyticsProviderService }: InjectedDependencies) {
    this.analyticsProviderService_ = analyticsProviderService
  }

  __hooks = {
    onApplicationShutdown: async () => {
      await this.analyticsProviderService_.shutdown()
    },
  }

  getProvider() {
    return this.analyticsProviderService_
  }

  async track(data: TrackAnalyticsEventDTO): Promise<void> {
    try {
      await this.analyticsProviderService_.track(data)
    } catch (error: unknown) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Error tracking event for ${data.event}: ${errorMessage(error)}`
      )
    }
  }

  async identify(data: IdentifyAnalyticsEventDTO): Promise<void> {
    try {
      await this.analyticsProviderService_.identify(data)
    } catch (error: unknown) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Error identifying event for ${
          "group" in data ? data.group.id : data.actor_id
        }: ${errorMessage(error)}`
      )
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
