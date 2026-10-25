import { buildQuery } from "@medusajs/utils/modules-sdk/build-query"
import type {
  Context,
  DAL,
  FindConfig,
  IEventBusModuleService,
  ILinkModule,
  InternalModuleDeclaration,
  LinkOperationCompensation,
  LinkOperationHandle,
  LinkOperationRequest,
  LinkOperationResult,
  Message,
  ModuleJoinerConfig,
  RestoreReturn,
  SoftDeleteReturn,
} from "@medusajs/framework/types"
import {
  CommonEvents,
  EmitEvents,
  InjectManager,
  InjectTransactionManager,
  isDefined,
  mapObjectTo,
  type MapToConfig,
  MedusaContext,
  MedusaError,
  moduleEventBuilderFactory,
  Modules,
} from "@medusajs/framework/utils/portable"
import LinkService from "./link"
import { LinkOperationService } from "../operations/service"
import { decodeLinkOperationRows, type LinkOperationEventIntent } from "../operations/contracts"

type InjectedDependencies = {
  baseRepository: DAL.RepositoryService
  linkService: LinkService<any>
  primaryKey: string | string[]
  foreignKey: string
  extraFields: string[]
  entityName: string
  serviceName: string
  [Modules.EVENT_BUS]?: IEventBusModuleService
}

export default class LinkModuleService implements ILinkModule {
  protected baseRepository_: DAL.RepositoryService
  protected readonly linkService_: LinkService<any>
  protected readonly eventBusModuleService_?: IEventBusModuleService
  protected readonly entityName_: string
  protected readonly serviceName_: string
  protected primaryKey_: string[]
  protected foreignKey_: string
  protected extraFields_: string[]
  protected readonly linkOperationService_?: LinkOperationService

  constructor(
    {
      baseRepository,
      linkService,
      primaryKey,
      foreignKey,
      extraFields,
      entityName,
      serviceName,
      [Modules.EVENT_BUS]: eventBusModuleService,
    }: InjectedDependencies,
    readonly moduleDeclaration: InternalModuleDeclaration
  ) {
    this.baseRepository_ = baseRepository
    this.linkService_ = linkService
    this.eventBusModuleService_ = eventBusModuleService
    this.primaryKey_ = !Array.isArray(primaryKey) ? [primaryKey] : primaryKey
    this.foreignKey_ = foreignKey
    this.extraFields_ = extraFields
    this.entityName_ = entityName
    this.serviceName_ = serviceName
    const store = linkService.linkOperationStore
    if (store !== undefined) {
      const serialize = async (rows: unknown) => decodeLinkOperationRows(await baseRepository.serialize(rows))
      this.linkOperationService_ = new LinkOperationService(store, {
        active: async (pairs, context) => {
          const rows = await baseRepository.serialize<object[]>(await linkService.list(
            { $or: pairs.map(pair => this.buildData(pair.primary, pair.foreign)) }, { take: pairs.length + 1 }, context))
          decodeLinkOperationRows(rows)
          return store.pairs(rows)
        },
        create: async (pairs, context) => serialize(await linkService.create(pairs.map(pair => this.buildData(pair.primary, pair.foreign)), context)),
        dismiss: async (pairs, context) => serialize(await linkService.dismiss(pairs.map(pair => this.buildData(pair.primary, pair.foreign)), context)),
        restore: async (pairs, context) => {
          const [rows] = await linkService.restore(pairs.map(pair => this.buildData(pair.primary, pair.foreign)), context)
          return await serialize(rows)
        },
      })
    }
  }

  private operationEvents(events: readonly (typeof LinkOperationEventIntent.Type)[], context: Context): void {
    if (events.length === 0) return
    if (context.messageAggregator === undefined) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing native Link event owner")
    for (const event of events) context.messageAggregator.saveRawMessageData({
      source: this.serviceName_, object: this.entityName_, action: event.action,
      eventName: this.entityName_ + "." + event.action, data: { id: event.id }, context,
    }, { options: { event_id: event.event_id } })
  }

  @EmitEvents()
  async applyOperation(request: LinkOperationRequest, @MedusaContext() sharedContext: Context = {}): Promise<LinkOperationResult> {
    if (this.linkOperationService_ === undefined) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native durable Link operations are not enabled")
    const outcome = await this.linkOperationService_.apply(request, sharedContext)
    this.operationEvents(outcome.events, sharedContext)
    return outcome.result
  }

  @EmitEvents()
  async compensateOperation(handle: LinkOperationHandle, @MedusaContext() sharedContext: Context = {}): Promise<LinkOperationCompensation> {
    if (this.linkOperationService_ === undefined) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native durable Link operations are not enabled")
    const outcome = await this.linkOperationService_.compensate(handle, sharedContext)
    this.operationEvents(outcome.events, sharedContext)
    return outcome.result
  }

  __joinerConfig(): ModuleJoinerConfig {
    return {} as ModuleJoinerConfig
  }

  private buildData(
    primaryKeyData: string | string[],
    foreignKeyData: string,
    extra: Record<string, unknown> = {}
  ) {
    if (this.primaryKey_.length > 1) {
      if (
        !Array.isArray(primaryKeyData) ||
        primaryKeyData.length !== this.primaryKey_.length
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Primary key data must be an array ${this.primaryKey_.length} values`
        )
      }
    }

    const pk = this.primaryKey_.join(",")
    if (Object.keys(extra).some((key) => key === pk || this.isValidKeyName(key))) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Link extra data cannot replace endpoint fields"
      )
    }
    return {
      [pk]: primaryKeyData,
      [this.foreignKey_]: foreignKeyData,
      ...extra,
    }
  }

  private isValidKeyName(name: string) {
    return this.primaryKey_.concat(this.foreignKey_).includes(name)
  }

  private validateFields(data: any | any[]) {
    const dataToValidate = Array.isArray(data) ? data : [data]
    dataToValidate.forEach((d) => {
      const keys = Object.keys(d)
      if (keys.some((k) => !this.isValidKeyName(k))) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid field name provided. Valid field names are ${this.primaryKey_.concat(
            this.foreignKey_
          )}`
        )
      }
    })
  }

  @InjectManager()
  async retrieve(
    primaryKeyData: string | string[],
    foreignKeyData: string,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<unknown> {
    const filter = this.buildData(primaryKeyData, foreignKeyData)
    const queryOptions = buildQuery<unknown>(filter)
    const entry = await this.linkService_.list(queryOptions, {}, sharedContext)

    if (!entry?.length) {
      const pk = this.primaryKey_.join(",")
      const errMessage = `${pk}[${primaryKeyData}] and ${this.foreignKey_}[${foreignKeyData}]`

      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Entry ${errMessage} was not found`
      )
    }

    return (await this.baseRepository_.serialize(entry[0])) as unknown
  }

  @InjectManager()
  async list(
    filters: Record<string, unknown> = {},
    config: FindConfig<unknown> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<unknown[]> {
    if (!isDefined(config.take)) {
      config.take = null
    }

    const rows = await this.linkService_.list(filters, config, sharedContext)

    return (await this.baseRepository_.serialize(rows)) as unknown[]
  }

  @InjectManager()
  async listAndCount(
    filters: Record<string, unknown> = {},
    config: FindConfig<unknown> = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[unknown[], number]> {
    if (!isDefined(config.take)) {
      config.take = null
    }

    let [rows, count] = await this.linkService_.listAndCount(
      filters,
      config,
      sharedContext
    )

    rows = (await this.baseRepository_.serialize(rows)) as unknown[]

    return [rows, count]
  }

  @InjectTransactionManager()
  @EmitEvents()
  async create(
    primaryKeyOrBulkData:
      | string
      | string[]
      | [string | string[], string, Record<string, unknown>][],
    foreignKeyData?: string,
    extraFields?: Record<string, unknown>,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const data: unknown[] = []
    if (foreignKeyData === undefined && Array.isArray(primaryKeyOrBulkData)) {
      for (const [primaryKey, foreignKey, extra] of primaryKeyOrBulkData) {
        data.push(
          this.buildData(
            primaryKey as string | string[],
            foreignKey as string,
            extra as Record<string, unknown>
          )
        )
      }
    } else {
      data.push(
        this.buildData(
          primaryKeyOrBulkData as string | string[],
          foreignKeyData!,
          extraFields
        )
      )
    }

    const links = await this.linkService_.create(data, sharedContext)

    moduleEventBuilderFactory({
      action: CommonEvents.ATTACHED,
      object: this.entityName_,
      source: this.serviceName_,
      eventName: this.entityName_ + "." + CommonEvents.ATTACHED,
    })({
      data: data as { id: string }[],
      sharedContext,
    })

    return (await this.baseRepository_.serialize(links)) as unknown[]
  }

  @InjectTransactionManager()
  @EmitEvents()
  async dismiss(
    primaryKeyOrBulkData: string | string[] | [string | string[], string][],
    foreignKeyData?: string,
    @MedusaContext() sharedContext: Context = {}
  ) {
    const data: unknown[] = []
    if (foreignKeyData === undefined && Array.isArray(primaryKeyOrBulkData)) {
      for (const [primaryKey, foreignKey] of primaryKeyOrBulkData) {
        data.push(this.buildData(primaryKey, foreignKey as string))
      }
    } else {
      data.push(
        this.buildData(
          primaryKeyOrBulkData as string | string[],
          foreignKeyData!
        )
      )
    }

    const links = await this.linkService_.dismiss(data, sharedContext)

    moduleEventBuilderFactory({
      action: CommonEvents.DETACHED,
      object: this.entityName_,
      source: this.serviceName_,
      eventName: this.entityName_ + "." + CommonEvents.DETACHED,
    })({
      data: links.map((link) => ({ id: link.id })),
      sharedContext,
    })

    return (await this.baseRepository_.serialize(links)) as unknown[]
  }

  @InjectTransactionManager()
  @EmitEvents()
  async delete(
    data: any,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    this.validateFields(data)

    await this.linkService_.delete(data, sharedContext)

    const allData = Array.isArray(data) ? data : [data]
    moduleEventBuilderFactory({
      action: CommonEvents.DETACHED,
      object: this.entityName_,
      source: this.serviceName_,
      eventName: this.entityName_ + "." + CommonEvents.DETACHED,
    })({
      data: allData as { id: string }[],
      sharedContext,
    })
  }

  @InjectTransactionManager()
  @EmitEvents()
  async softDelete(
    data: any,
    { returnLinkableKeys }: SoftDeleteReturn = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<Record<string, unknown[]> | void> {
    const inputArray = Array.isArray(data) ? data : [data]

    this.validateFields(inputArray)

    let [deletedEntities, cascadedEntitiesMap] = await this.softDelete_(
      inputArray,
      sharedContext
    )

    const pk = this.primaryKey_.join(",")
    const entityNameToLinkableKeysMap: MapToConfig = {
      LinkModel: [
        { mapTo: pk, valueFrom: pk },
        { mapTo: this.foreignKey_, valueFrom: this.foreignKey_ },
      ],
    }

    let mappedCascadedEntitiesMap
    if (returnLinkableKeys) {
      // Map internal table/column names to their respective external linkable keys
      // eg: product.id = product_id, variant.id = variant_id
      mappedCascadedEntitiesMap = mapObjectTo<Record<string, string[]>>(
        cascadedEntitiesMap,
        entityNameToLinkableKeysMap,
        {
          pick: returnLinkableKeys,
        }
      )
    }

    moduleEventBuilderFactory({
      action: CommonEvents.DETACHED,
      object: this.entityName_,
      source: this.serviceName_,
      eventName: this.entityName_ + "." + CommonEvents.DETACHED,
    })({
      data: deletedEntities as { id: string }[],
      sharedContext,
    })

    return mappedCascadedEntitiesMap ? mappedCascadedEntitiesMap : void 0
  }

  @InjectTransactionManager()
  protected async softDelete_(
    data: any[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[object[], Record<string, string[]>]> {
    return await this.linkService_.softDelete(data, sharedContext)
  }

  @InjectTransactionManager()
  @EmitEvents()
  async restore(
    data: any,
    { returnLinkableKeys }: RestoreReturn = {},
    @MedusaContext() sharedContext: Context = {}
  ): Promise<Record<string, unknown[]> | void> {
    const inputArray = Array.isArray(data) ? data : [data]
    this.validateFields(inputArray)

    let [restoredEntities, cascadedEntitiesMap] = await this.restore_(
      inputArray,
      sharedContext
    )

    const pk = this.primaryKey_.join(",")
    const entityNameToLinkableKeysMap: MapToConfig = {
      LinkModel: [
        { mapTo: pk, valueFrom: pk },
        { mapTo: this.foreignKey_, valueFrom: this.foreignKey_ },
      ],
    }

    let mappedCascadedEntitiesMap
    if (returnLinkableKeys) {
      // Map internal table/column names to their respective external linkable keys
      // eg: product.id = product_id, variant.id = variant_id
      mappedCascadedEntitiesMap = mapObjectTo<Record<string, string[]>>(
        cascadedEntitiesMap,
        entityNameToLinkableKeysMap,
        {
          pick: returnLinkableKeys,
        }
      )
    }

    moduleEventBuilderFactory({
      action: CommonEvents.ATTACHED,
      object: this.entityName_,
      source: this.serviceName_,
      eventName: this.entityName_ + "." + CommonEvents.ATTACHED,
    })({
      data: restoredEntities as { id: string }[],
      sharedContext,
    })

    return mappedCascadedEntitiesMap ? mappedCascadedEntitiesMap : void 0
  }

  @InjectTransactionManager()
  async restore_(
    data: any,
    @MedusaContext() sharedContext: Context = {}
  ): Promise<[object[], Record<string, string[]>]> {
    return await this.linkService_.restore(data, sharedContext)
  }

  protected async emitEvents_(groupedEvents: Record<string, Message[]> | undefined, context?: Context): Promise<void> {
    if (!this.eventBusModuleService_ || !groupedEvents) {
      return
    }

    const store = this.linkService_.linkOperationStore
    if (store !== undefined && context !== undefined &&
      store.deferPublication(context, () => this.publishEvents_(groupedEvents))) return
    await this.publishEvents_(groupedEvents)
  }

  private async publishEvents_(groupedEvents: Record<string, Message[]>): Promise<void> {
    if (!this.eventBusModuleService_) return

    const promises: Promise<void>[] = []
    for (const group of Object.keys(groupedEvents)) {
      promises.push(
        this.eventBusModuleService_.emit(groupedEvents[group], {
          internal: true,
        })
      )
    }

    await Promise.all(promises)
  }
}
