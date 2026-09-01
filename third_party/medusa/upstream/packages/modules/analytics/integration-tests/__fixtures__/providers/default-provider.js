// @ts-check

const {
  AbstractAnalyticsProviderService,
} = require("@medusajs/framework/utils")

/** @typedef {import("@medusajs/framework/types").ProviderIdentifyAnalyticsEventDTO} ProviderIdentifyAnalyticsEventDTO */
/** @typedef {import("@medusajs/framework/types").ProviderTrackAnalyticsEventDTO} ProviderTrackAnalyticsEventDTO */

class AnalyticsProviderServiceFixtures extends AbstractAnalyticsProviderService {
  static identifier = "fixtures-analytics-provider"

  /**
   * @param {ProviderTrackAnalyticsEventDTO} data
   * @returns {Promise<void>}
   */
  async track(data) {
    return Promise.resolve()
  }

  /**
   * @param {ProviderIdentifyAnalyticsEventDTO} data
   * @returns {Promise<void>}
   */
  async identify(data) {
    return Promise.resolve()
  }

  /** @returns {Promise<void>} */
  async shutdown() {
    return Promise.resolve()
  }
}

const services = [AnalyticsProviderServiceFixtures]

module.exports = { AnalyticsProviderServiceFixtures, services }
