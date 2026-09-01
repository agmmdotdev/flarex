import type { NotificationTypes } from "@medusajs/types"

export class WorkerMemoryNotificationProvider
  implements NotificationTypes.INotificationProvider
{
  static identifier = "worker-memory"

  readonly sent: NotificationTypes.ProviderSendNotificationDTO[] = []

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    this.sent.push(notification)
    return {
      id: `worker-memory-${this.sent.length}`,
    }
  }
}

export const workerMemoryNotificationProvider = {
  services: [WorkerMemoryNotificationProvider],
}
