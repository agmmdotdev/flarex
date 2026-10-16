import type {
  Context,
  DAL,
  INotificationModuleService,
  InternalModuleDeclaration,
  Logger,
  ModulesSdkTypes,
  NotificationTypes,
} from "@medusajs/types"
import {
  EmitEvents,
  InjectManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils/portable"
import { Notification } from "../models"
import NotificationProviderService from "./notification-provider"
import { createNotificationsWithDelivery, prepareNotificationDelivery,
  type NotificationDeliveryPhases, type NotificationDeliveryProvider, type NotificationDeliveryRow, type NotificationDeliveryUpdate,
} from "./notification-delivery"

type NativeDependencies = {
  notificationService: ModulesSdkTypes.IMedusaInternalService<typeof Notification>
  notificationProviderService: NotificationProviderService
  notificationDeliveryPhases?: never
}
type DetachedPhaseDependencies = {
  notificationService?: never
  notificationProviderService?: never
  notificationDeliveryPhases: (context: Context) => NotificationDeliveryPhases<NotificationDeliveryProvider, NotificationDeliveryRow>
}
type InjectedDependencies = {
  logger?: Logger
  baseRepository: DAL.RepositoryService
} & (NativeDependencies | DetachedPhaseDependencies)

export default class NotificationModuleService
  extends MedusaService<{
    Notification: { dto: NotificationTypes.NotificationDTO }
  }>({ Notification })
  implements INotificationModuleService
{
  protected baseRepository_: DAL.RepositoryService
  protected readonly notificationService_: ModulesSdkTypes.IMedusaInternalService<
    typeof Notification
  > | undefined
  protected readonly notificationProviderService_: NotificationProviderService | undefined
  protected readonly notificationDeliveryPhases_: DetachedPhaseDependencies["notificationDeliveryPhases"] | undefined

  constructor(
    {
      baseRepository,
      notificationService,
      notificationProviderService,
      notificationDeliveryPhases,
    }: InjectedDependencies,
    protected readonly moduleDeclaration: InternalModuleDeclaration
  ) {
    // @ts-ignore
    super(...arguments)
    this.baseRepository_ = baseRepository
    this.notificationService_ = notificationService
    this.notificationProviderService_ = notificationProviderService
    this.notificationDeliveryPhases_ = notificationDeliveryPhases
  }

  /** Private persistence phase entry. Native mutation aggregation remains in
   * this module; a detached owner retains the returned messages until its outer
   * createNotifications invocation succeeds. Delivery is absent from this call. */
  @InjectManager()
  @EmitEvents()
  async prepareNotificationsForDelivery(
    data: NotificationTypes.CreateNotificationDTO[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    const notificationService = this.notificationService_
    const notificationProviderService = this.notificationProviderService_
    if (!notificationService || !notificationProviderService) {
      throw new Error("Notification delivery preparation is not configured")
    }
    const prepared = await prepareNotificationDelivery(data, {
      transaction: (work) => this.baseRepository_.transaction(work),
      listNotifications: (filters, config, context) => notificationService.list(filters, config, context),
      createNotifications: (input, context) => notificationService.create(input, context),
      getProviderForChannels: (channels) => notificationProviderService.getProviderForChannels(channels),
    }, sharedContext)
    return { prepared, messages: sharedContext.messageAggregator?.getMessages().default ?? [] }
  }

  /** A separate fresh transaction persists the genuine terminal updates. */
  @InjectManager()
  @EmitEvents()
  async finalizeNotificationsDelivery(
    updates: NotificationDeliveryUpdate[],
    @MedusaContext() sharedContext: Context = {}
  ) {
    if (!this.notificationService_) throw new Error("Notification delivery finalization is not configured")
    const rows = await this.notificationService_.update(updates, sharedContext)
    return { rows, messages: sharedContext.messageAggregator?.getMessages().default ?? [] }
  }

  // @ts-expect-error
  createNotifications(
    data: NotificationTypes.CreateNotificationDTO[],
    sharedContext?: Context
  ): Promise<NotificationTypes.NotificationDTO[]>
  // @ts-expect-error
  createNotifications(
    data: NotificationTypes.CreateNotificationDTO,
    sharedContext?: Context
  ): Promise<NotificationTypes.NotificationDTO>

  @InjectManager()
  @EmitEvents()
  // @ts-expect-error
  async createNotifications(
    data:
      | NotificationTypes.CreateNotificationDTO
      | NotificationTypes.CreateNotificationDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<
    NotificationTypes.NotificationDTO | NotificationTypes.NotificationDTO[]
  > {
    const normalized = Array.isArray(data) ? data : [data]

    const createdNotifications = await this.createNotifications_(
      normalized,
      sharedContext
    )

    const serialized = await this.baseRepository_.serialize<
      NotificationTypes.NotificationDTO[]
    >(createdNotifications)

    return Array.isArray(data) ? serialized : serialized[0]
  }

  @InjectManager()
  protected async createNotifications_(
    data: NotificationTypes.CreateNotificationDTO[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<NotificationDeliveryRow[]> {
    if (this.notificationDeliveryPhases_) {
      return await createNotificationsWithDelivery(data, this.notificationDeliveryPhases_(sharedContext))
    }
    const notificationService = this.notificationService_
    const notificationProviderService = this.notificationProviderService_
    if (!notificationService || !notificationProviderService) {
      throw new Error("Notification delivery persistence is not configured")
    }
    return await createNotificationsWithDelivery(data, {
      prepare: (input) => prepareNotificationDelivery(input, {
        transaction: (work) => this.baseRepository_.transaction(work),
        listNotifications: (filters, config, context) => notificationService.list(filters, config, context),
        createNotifications: (input, context) => notificationService.create(input, context),
        getProviderForChannels: (channels) => notificationProviderService.getProviderForChannels(channels),
      }, sharedContext),
      // SAFETY: native dispatch forwards this object unchanged, including its
      // optional template. The original DAL's loose transaction result erased
      // that DTO mismatch; the admitted local-feed adapter requires admin-ui.
      send: (provider, notification) => notificationProviderService.send(provider, notification as NotificationTypes.ProviderSendNotificationDTO),
      updateNotifications: (input) => notificationService.update(input, sharedContext),
    })
  }
}
