import type {
  Context,
  DAL,
  InferEntityType,
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
import { createNotificationsWithDelivery, prepareNotificationDelivery } from "./notification-delivery"

type InjectedDependencies = {
  logger?: Logger
  baseRepository: DAL.RepositoryService
  notificationService: ModulesSdkTypes.IMedusaInternalService<
    typeof Notification
  >
  notificationProviderService: NotificationProviderService
}

export default class NotificationModuleService
  extends MedusaService<{
    Notification: { dto: NotificationTypes.NotificationDTO }
  }>({ Notification })
  implements INotificationModuleService
{
  protected baseRepository_: DAL.RepositoryService
  protected readonly notificationService_: ModulesSdkTypes.IMedusaInternalService<
    typeof Notification
  >
  protected readonly notificationProviderService_: NotificationProviderService

  constructor(
    {
      baseRepository,
      notificationService,
      notificationProviderService,
    }: InjectedDependencies,
    protected readonly moduleDeclaration: InternalModuleDeclaration
  ) {
    // @ts-ignore
    super(...arguments)
    this.baseRepository_ = baseRepository
    this.notificationService_ = notificationService
    this.notificationProviderService_ = notificationProviderService
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
  ): Promise<InferEntityType<typeof Notification>[]> {
    return await createNotificationsWithDelivery(data, {
      prepare: (input) => prepareNotificationDelivery(input, {
        transaction: (work) => this.baseRepository_.transaction(work),
        listNotifications: (filters, config, context) => this.notificationService_.list(filters, config, context),
        createNotifications: (input, context) => this.notificationService_.create(input, context),
        getProviderForChannels: (channels) => this.notificationProviderService_.getProviderForChannels(channels),
      }, sharedContext),
      // SAFETY: native dispatch forwards this object unchanged, including its
      // optional template. The original DAL's loose transaction result erased
      // that DTO mismatch; the admitted local-feed adapter requires admin-ui.
      send: (provider, notification) => this.notificationProviderService_.send(provider, notification as NotificationTypes.ProviderSendNotificationDTO),
      updateNotifications: (input) => this.notificationService_.update(input, sharedContext),
    })
  }
}
