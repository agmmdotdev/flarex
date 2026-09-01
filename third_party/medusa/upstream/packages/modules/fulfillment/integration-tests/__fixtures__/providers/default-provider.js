// @ts-check

const {
  AbstractFulfillmentProviderService,
} = require("@medusajs/framework/utils")

class FulfillmentProviderServiceFixtures extends AbstractFulfillmentProviderService {
  static identifier = "fixtures-fulfillment-provider"

  /** @returns {Promise<any>} */
  async createFulfillment() {
    return {}
  }

  /** @returns {Promise<any>} */
  async cancelFulfillment() {
    return {}
  }

  /** @returns {Promise<any>} */
  async getFulfillmentOptions() {
    return {}
  }

  /** @returns {Promise<any>} */
  async createReturnFulfillment() {
    return {}
  }
}

const services = [FulfillmentProviderServiceFixtures]

module.exports = { FulfillmentProviderServiceFixtures, services }
