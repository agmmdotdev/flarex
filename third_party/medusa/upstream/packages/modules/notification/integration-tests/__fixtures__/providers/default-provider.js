// @ts-check

const {
  AbstractNotificationProviderService,
} = require("@medusajs/framework/utils")

/** @typedef {import("@medusajs/framework/types").NotificationTypes.ProviderSendNotificationDTO} ProviderSendNotificationDTO */
/** @typedef {import("@medusajs/framework/types").NotificationTypes.ProviderSendNotificationResultsDTO} ProviderSendNotificationResultsDTO */

class NotificationProviderServiceFixtures extends AbstractNotificationProviderService {
  static identifier = "fixtures-notification-provider"

  /**
   * @param {ProviderSendNotificationDTO} notification
   * @returns {Promise<ProviderSendNotificationResultsDTO>}
   */
  async send(notification) {
    if (notification.to === "fail") {
      throw new Error("Failed to send notification")
    }
    return { id: "external_id" }
  }
}

const services = [NotificationProviderServiceFixtures]

module.exports = { NotificationProviderServiceFixtures, services }
