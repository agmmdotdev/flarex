import type { Context, NotificationTypes } from "@medusajs/types"
import { generateEntityId } from "@medusajs/utils/common/generate-entity-id"
import { MedusaError } from "@medusajs/utils/common/errors"
import { promiseAll } from "@medusajs/utils/common/promise-all"
import { NotificationStatus } from "@medusajs/utils/notification/common"

/** Extracted from the pinned NotificationModuleService.createNotifications_.
 * Native policy and ordering stay here; phase ports own their persistence or
 * provider lifetimes. No manager crosses the returned preparation boundary. */
export interface NotificationDeliveryProvider {
  readonly id: string
  readonly channels: readonly string[]
  readonly is_enabled: boolean
}
export interface NotificationDeliveryRow {
  readonly id: string
  readonly idempotency_key?: string | null
  readonly status?: string | null
}
export type NotificationDeliveryData = NotificationTypes.CreateNotificationDTO & {
  id: string
  provider_id: string | undefined
  status?: NotificationStatus
  external_id?: string | undefined
}
/** Every queued native branch assigns SUCCESS or FAILURE before pushing the
 * original DTO. Status stays optional in its structural type because dispatch
 * mutates that same object; the port must still expose it to persistence. */
export type NotificationDeliveryUpdate = Pick<NotificationDeliveryData, "id" | "external_id" | "status">
export interface PreparedNotificationDelivery<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow> {
  notificationsToProcess: { provider: Provider | undefined; data: NotificationDeliveryData }[]
  createdNotifications: Row[]
}
export interface NotificationPreparationPorts<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow> {
  readonly transaction: <Value>(work: (manager: unknown) => Promise<Value>) => Promise<Value>
  readonly listNotifications: (filters: { idempotency_key: (string | null | undefined)[] }, config: Record<string, never>, context: Context) => Promise<Row[]>
  readonly createNotifications: (data: NotificationDeliveryData[], context: Context) => Promise<Row[]>
  readonly getProviderForChannels: (channels: string[]) => Promise<Provider[]>
}
export interface NotificationDeliveryPorts<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow> {
  readonly send: (provider: Provider, data: NotificationDeliveryData) => Promise<NotificationTypes.ProviderSendNotificationResultsDTO>
  readonly updateNotifications: (data: NotificationDeliveryUpdate[]) => Promise<Row[]>
}

/** This is the genuine native reservation transaction. The provider send is
 * deliberately absent; callers must settle this phase before delivery. */
export async function prepareNotificationDelivery<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow>(
  data: NotificationTypes.CreateNotificationDTO[],
  ports: NotificationPreparationPorts<Provider, Row>,
  sharedContext: Context = {}
): Promise<PreparedNotificationDelivery<Provider, Row>> {
  const idempotencyKeys = data.map((entry) => entry.idempotency_key).filter(Boolean)
  return await ports.transaction(async (txManager) => {
    const context = { ...sharedContext, transactionManager: txManager }
    const alreadySentNotifications = await ports.listNotifications({ idempotency_key: idempotencyKeys }, {}, context)
    const existsMap = new Map(alreadySentNotifications.map((n) => [n.idempotency_key as string, n]))
    const notificationsToProcess = data.filter((entry) =>
      !entry.idempotency_key || !existsMap.has(entry.idempotency_key) ||
      (existsMap.has(entry.idempotency_key) && existsMap.get(entry.idempotency_key)!.status === NotificationStatus.FAILURE)
    )
    const channels = notificationsToProcess.map((not) => not.channel)
    const providers = await ports.getProviderForChannels(channels)
    const normalizedNotificationsToProcess = notificationsToProcess.map((entry) => {
      const provider = providers.find((provider) => provider?.channels.includes(entry.channel))
      return { provider, data: { id: generateEntityId(undefined, "noti"), ...entry, provider_id: provider?.id } }
    })
    const toCreate = normalizedNotificationsToProcess
      .filter((e) => !e.data.idempotency_key || !existsMap.has(e.data.idempotency_key)).map((e) => e.data)
    const createdNotifications = toCreate.length ? await ports.createNotifications(toCreate, context) : []
    return { notificationsToProcess: normalizedNotificationsToProcess, createdNotifications }
  })
}

/** Genuine native provider/finally body. A provider rejection still reaches
 * the final persistence port, and its failure can supersede the send failure. */
export async function deliverPreparedNotifications<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow>(
  prepared: PreparedNotificationDelivery<Provider, Row>, ports: NotificationDeliveryPorts<Provider, Row>
): Promise<Row[]> {
  const notificationsToProcess = prepared.notificationsToProcess
  let createdNotifications = prepared.createdNotifications
  const notificationToUpdate: NotificationDeliveryUpdate[] = []
  try {
    await promiseAll(notificationsToProcess.map(async (entry) => {
      const provider = entry.provider
      if (!provider?.is_enabled) {
        entry.data.status = NotificationStatus.FAILURE
        notificationToUpdate.push(entry.data)
        const errorMessage = !provider
          ? `Could not find a notification provider for channel: ${entry.data.channel} for notification id ${entry.data.id}`
          : `Notification provider ${provider.id} is not enabled. To enable it, configure it as a provider in the notification module options.`
        throw new MedusaError(MedusaError.Types.NOT_FOUND, errorMessage)
      }
      const res = await ports.send(provider, entry.data).catch((e) => {
        entry.data.status = NotificationStatus.FAILURE
        notificationToUpdate.push(entry.data)
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to send notification with id ${entry.data.id}:\n${e.message}`)
      })
      entry.data.external_id = res.id
      entry.data.status = NotificationStatus.SUCCESS
      notificationToUpdate.push(entry.data)
    }), { aggregateErrors: true })
  } finally {
    const updatedNotifications = await ports.updateNotifications(notificationToUpdate)
    const updatedNotificationsMap = new Map(updatedNotifications.map((n) => [n.id, n]))
    createdNotifications = createdNotifications.map((notification) => updatedNotificationsMap.get(notification.id) || notification)
  }
  return createdNotifications
}

/** Retains the native empty-input guard and the exact prepare/send/finalize
 * sequence. Fresh-host callers supply separate phase ports, never one borrowed
 * commerce transaction spanning the provider callback. */
export async function createNotificationsWithDelivery<Provider extends NotificationDeliveryProvider, Row extends NotificationDeliveryRow>(
  data: NotificationTypes.CreateNotificationDTO[],
  ports: NotificationDeliveryPorts<Provider, Row> & {
    readonly prepare: (data: NotificationTypes.CreateNotificationDTO[]) => Promise<PreparedNotificationDelivery<Provider, Row>>
  }
): Promise<Row[]> {
  if (!data.length) return []
  const prepared = await ports.prepare(data)
  return await deliverPreparedNotifications(prepared, ports)
}
