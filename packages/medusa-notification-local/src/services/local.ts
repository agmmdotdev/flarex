import type {
  LocalNotificationServiceOptions,
  Logger,
  NotificationTypes,
} from "@medusajs/types"
import { AbstractNotificationProviderService } from "@medusajs/utils/notification/abstract-notification-provider"
import { MedusaError } from "@medusajs/utils/common/errors"

type InjectedDependencies = {
  logger: Logger
}

interface LocalServiceConfig {}

export class LocalNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-local"
  protected config_: LocalServiceConfig
  protected logger_: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: LocalNotificationServiceOptions
  ) {
    super()
    this.config_ = options
    this.logger_ = logger
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No notification information provided`
      )
    }

    const message =
      `Attempting to send a notification to: '${notification.to}'` +
      ` on the channel: '${notification.channel}' with template: '${notification.template}'` +
      ` and data: '${JSON.stringify(notification.data)}'`

    this.logger_.info(message)
    return {}
  }
}
