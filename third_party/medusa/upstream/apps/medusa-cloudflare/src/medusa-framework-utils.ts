import type {
  EventBusTypes,
  InterceptorSubscriber,
  InternalModuleDeclaration,
  InputFileConfig,
  JoinerServiceConfigAlias,
  ModuleJoinerConfig,
} from "@medusajs/types"
import { defineFileConfig as definePortableFileConfig } from "@medusajs/utils/common/define-file-config"
import { getCallerFilePath } from "@medusajs/utils/common/get-caller-file-path"
import { lowerCaseFirst as lowerCaseFirstValue } from "@medusajs/utils/common/lower-case-first"
import { kebabCase as kebabCaseValue } from "@medusajs/utils/common/to-kebab-case"
import {
  defineJoinerConfigFromModels,
  type JoinerConfigModels,
} from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  buildSchema,
  Kind,
  parse,
  print,
  visit,
  type GraphQLSchema,
  type TypeNode,
} from "graphql"
import { mergeTypeDefs as mergeGraphQLTypeDefs } from "@graphql-tools/merge"
import { ProductStatus as ProductStatusValue } from "@medusajs/utils/product/enums"
import * as PromotionUtilsValue from "@medusajs/utils/promotion"

export { arrayDifference } from "@medusajs/utils/common/array-difference"
export { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
export { createPortableId } from "@medusajs/utils/common/create-portable-id"
export { DmlEntity } from "@medusajs/utils/dml/entity"
export { deepCopy } from "@medusajs/utils/common/deep-copy"
export { deepEqualObj } from "@medusajs/utils/common/deep-equal-obj"
export { deduplicate } from "@medusajs/utils/common/deduplicate"
export { getDuplicates } from "@medusajs/utils/common/get-duplicates"
export { GetIsoStringFromDate } from "@medusajs/utils/common/get-iso-string-from-date"
export { getSetDifference } from "@medusajs/utils/common/get-set-difference"
export { getSelectsAndRelationsFromObjectArray } from "@medusajs/utils/common/get-selects-and-relations-from-object-array"
export { groupBy } from "@medusajs/utils/common/group-by"
export { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first"
export {
  MedusaError,
  MedusaErrorCodes,
  MedusaErrorTypes,
} from "@medusajs/utils/common/errors"
export { generateEntityId } from "@medusajs/utils/common/generate-entity-id"
export { flattenObjectToKeyValuePairs } from "@medusajs/utils/common/flatten-object-to-key-value-pairs"
export { isDate } from "@medusajs/utils/common/is-date"
export { isDefined } from "@medusajs/utils/common/is-defined"
export { isObject } from "@medusajs/utils/common/is-object"
export { isPresent } from "@medusajs/utils/common/is-present"
export { isString } from "@medusajs/utils/common/is-string"
export { isValidHandle } from "@medusajs/utils/common/validate-handle"
export { kebabCase } from "@medusajs/utils/common/to-kebab-case"
export { normalizeLocale } from "@medusajs/utils/common/normalize-locale"
export { partitionArray } from "@medusajs/utils/common/partition-array"
export { pickValueFromObject } from "@medusajs/utils/common/pick-value-from-object"
export { promiseAll } from "@medusajs/utils/common/promise-all"
export { removeUndefined } from "@medusajs/utils/common/remove-undefined"
export { removeNullish } from "@medusajs/utils/common/remove-nullisih"
export { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
export { toHandle } from "@medusajs/utils/common/to-handle"
export { toCamelCase } from "@medusajs/utils/common/to-camel-case"
export { toSnakeCase } from "@medusajs/utils/common/to-snake-case"
export { upperCaseFirst } from "@medusajs/utils/common/upper-case-first"
export { CommonEvents } from "@medusajs/utils/event-bus/common-events"
export {
  AuthWorkflowEvents,
  CustomerWorkflowEvents,
} from "@medusajs/utils/core-flows/events"
export { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
export { getVariantAvailability, getTotalVariantAvailability } from "@medusajs/utils/product/get-variant-availability"
export { MessageAggregator } from "@medusajs/utils/event-bus/message-aggregator"
export { QueryContext } from "@medusajs/utils/modules-sdk/query-context"
export * as DefaultsUtils from "@medusajs/utils/defaults/countries"
export { model } from "@medusajs/utils/dml/model"
export { ProductStatus } from "@medusajs/utils/product/enums"
export { PriceListStatus, PriceListType } from "@medusajs/utils/pricing/price-list"
export { PricingRuleOperator } from "@medusajs/utils/pricing/enums"
export {
  ApplicationMethodAllocation,
  ApplicationMethodTargetType,
  ApplicationMethodType,
  CampaignBudgetType,
  ComputedActions,
  PromotionRuleOperator,
  PromotionStatus,
  PromotionType,
} from "@medusajs/utils/promotion"
export { AbstractPaymentProvider } from "@medusajs/utils/payment/abstract-payment-provider"
export { ApiKeyType } from "@medusajs/utils/api-key/api-key-type"
export { FulfillmentEvents } from "@medusajs/utils/fulfillment/events"
export { GeoZoneType } from "@medusajs/utils/fulfillment/geo-zone"
export { ShippingOptionPriceType } from "@medusajs/utils/fulfillment/shipping-options"
export { PaymentCollectionStatus } from "@medusajs/utils/payment/payment-collection"
export { PaymentSessionStatus } from "@medusajs/utils/payment/payment-session"
export {
  PaymentActions,
  PaymentWebhookEvents,
} from "@medusajs/utils/payment/webhook"
export { NotificationStatus } from "@medusajs/utils/notification/common"
export { UserEvents } from "@medusajs/utils/user/events"
export {
  applyTranslationsToTaxLines,
} from "@medusajs/utils/translations/apply-translations-to-tax-lines"
export {
  calculateAmountsWithTax,
} from "@medusajs/utils/totals/tax"
export {
  ClaimReason,
  ClaimType,
  OrderStatus,
  ReturnStatus,
} from "@medusajs/utils/order/status"
export { ChangeActionType } from "@medusajs/utils/order/order-change-action"
export {
  OrderChangeStatus,
  OrderChangeType,
} from "@medusajs/utils/order/order-change"
export { BigNumber } from "@medusajs/utils/totals/big-number"
export { MathBN } from "@medusajs/utils/totals/math"
export { getShippingMethodsTotals } from "@medusajs/utils/totals/shipping-method"
export { calculateAdjustmentAmountFromPromotion } from "@medusajs/utils/totals/promotion"
export { Modules } from "@medusajs/utils/modules-sdk/definition"
export {
  TransactionHandlerType,
  TransactionState,
  TransactionStepState,
} from "@medusajs/utils/orchestration/types"
export { RuleOperator } from "@medusajs/utils/common/rules"
export { MedusaContext } from "@medusajs/utils/modules-sdk/decorators/context-parameter"
export { InjectSharedContext } from "@medusajs/utils/modules-sdk/decorators/inject-shared-context"
export {
  Policy,
  PolicyOperation,
  PolicyResource,
} from "@medusajs/utils/modules-sdk/policy-registry"
export { EmitEvents } from "@medusajs/utils/modules-sdk/decorators/emit-events"
export { InjectManager } from "@medusajs/utils/modules-sdk/decorators/inject-manager"
export { InjectTransactionManager } from "@medusajs/utils/modules-sdk/decorators/inject-transaction-manager"
export { moduleEventBuilderFactory } from "@medusajs/utils/modules-sdk/event-builder-factory"
export { MedusaService } from "@medusajs/utils/modules-sdk/medusa-service"
export { ModulesSdkUtils } from "@medusajs/utils/modules-sdk/portable"
export { createRawPropertiesFromBigNumber } from "@medusajs/utils/totals/create-raw-properties-from-bignumber"
export { transformPropertiesToBigNumber } from "@medusajs/utils/totals/transform-properties-to-bignumber"
export { decorateCartTotals } from "@medusajs/utils/totals/cart"

export const ProductUtils = {
  ProductStatus: ProductStatusValue,
}

export const PromotionUtils = PromotionUtilsValue

export type { GraphQLSchema } from "graphql"

export function buildModuleResourceEventName({
  prefix,
  objectName,
  action,
}: {
  prefix?: string
  objectName: string
  action: string
}): string {
  const kebabCaseName = lowerCaseFirstValue(kebabCaseValue(objectName))
  return `${prefix ? `${prefix}.` : ""}${kebabCaseName}.${action}`
}

export function defineFileConfig(config?: InputFileConfig): void {
  if (!config) {
    definePortableFileConfig(config)
    return
  }

  const filePath = config?.path ?? getCallerFilePath(3)
  definePortableFileConfig(filePath ? { ...config, path: filePath } : config)
}

export function generateJwtToken(
  tokenPayload: Record<string, unknown>,
  _jwtConfig: {
    secret?: unknown
    expiresIn?: number | string
    jwtOptions?: Record<string, unknown>
  }
): string {
  return [
    encodeStaticJwtSegment({ alg: "none", typ: "JWT" }),
    encodeStaticJwtSegment(tokenPayload),
    "worker-http-proof",
  ].join(".")
}

function encodeStaticJwtSegment(value: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export const GraphQLUtils = {
  cleanGraphQLSchema,
  makeExecutableSchema,
  mergeTypeDefs,
}

type SubscriberWithId = EventBusTypes.Subscriber & {
  subscriberId?: string
}

let subscriberSequence = 0

export abstract class AbstractEventBusModuleService
  implements EventBusTypes.IEventBusModuleService
{
  protected isWorkerMode = true

  protected eventToSubscribersMap_: Map<
    string | symbol,
    EventBusTypes.SubscriberDescriptor[]
  > = new Map()

  protected interceptorSubscribers_: Set<InterceptorSubscriber> = new Set()

  public get eventToSubscribersMap(): Map<
    string | symbol,
    EventBusTypes.SubscriberDescriptor[]
  > {
    return this.eventToSubscribersMap_
  }

  protected constructor(
    _cradle: Record<string, unknown>,
    _moduleOptions = {},
    moduleDeclaration: InternalModuleDeclaration
  ) {
    this.isWorkerMode = moduleDeclaration.worker_mode !== "server"
  }

  abstract emit<T>(
    data: EventBusTypes.Message<T> | EventBusTypes.Message<T>[],
    options: Record<string, unknown>
  ): Promise<void>

  abstract releaseGroupedEvents(eventGroupId: string): Promise<void>

  abstract clearGroupedEvents(
    eventGroupId: string,
    options?: {
      eventNames?: string[]
    }
  ): Promise<void>

  public subscribe(
    eventName: string | symbol,
    subscriber: EventBusTypes.Subscriber,
    context?: EventBusTypes.SubscriberContext
  ): this {
    if (typeof subscriber !== "function") {
      throw new Error("Subscriber must be a function")
    }

    const event = eventName.toString()
    const subscriberId =
      context?.subscriberId ?? `${event}-${++subscriberSequence}`
    const subscriberWithId = subscriber as SubscriberWithId
    subscriberWithId.subscriberId = subscriberId

    const existingSubscribers = this.eventToSubscribersMap_.get(event) ?? []
    if (
      existingSubscribers.some(
        (existingSubscriber) => existingSubscriber.id === subscriberId
      )
    ) {
      throw new Error(`Subscriber with id ${subscriberId} already exists`)
    }

    this.eventToSubscribersMap_.set(event, [
      ...existingSubscribers,
      { subscriber, id: subscriberId },
    ])

    return this
  }

  public unsubscribe(
    eventName: string | symbol,
    subscriber: EventBusTypes.Subscriber,
    context?: EventBusTypes.SubscriberContext
  ): this {
    if (!this.isWorkerMode) {
      return this
    }

    const subscriberWithId = subscriber as SubscriberWithId
    const subscriberId = context?.subscriberId ?? subscriberWithId.subscriberId
    const existingSubscribers = this.eventToSubscribersMap_.get(eventName)

    if (!existingSubscribers?.length || !subscriberId) {
      return this
    }

    this.eventToSubscribersMap_.set(
      eventName,
      existingSubscribers.filter(
        (existingSubscriber) => existingSubscriber.id !== subscriberId
      )
    )

    return this
  }

  public addInterceptor(interceptor: InterceptorSubscriber): this {
    this.interceptorSubscribers_.add(interceptor)
    return this
  }

  public removeInterceptor(interceptor: InterceptorSubscriber): this {
    this.interceptorSubscribers_.delete(interceptor)
    return this
  }

  protected async callInterceptors<T = unknown>(
    message: EventBusTypes.Message<T>,
    context?: { isGrouped?: boolean; eventGroupId?: string }
  ): Promise<void> {
    for (const interceptor of this.interceptorSubscribers_) {
      try {
        await interceptor(message, context)
      } catch (error) {
        console.error("Error in event bus interceptor:", error)
      }
    }
  }
}

function cleanGraphQLSchema(schema: string): {
  schema: string
  notFound: Record<string, Record<string, string>>
} {
  const extractTypeNameAndKind = (
    type: TypeNode
  ): [string | null, TypeNode["kind"] | null] => {
    if (type.kind === Kind.NAMED_TYPE) {
      return [type.name.value, type.kind]
    }
    if (type.kind === Kind.NON_NULL_TYPE || type.kind === Kind.LIST_TYPE) {
      return extractTypeNameAndKind(type.type)
    }
    return [null, null]
  }

  const ast = parse(schema)
  const typeNames = new Set(["String", "Int", "Float", "Boolean", "ID"])
  const namedDefinitionKinds = new Set<string>([
    Kind.OBJECT_TYPE_DEFINITION,
    Kind.INTERFACE_TYPE_DEFINITION,
    Kind.ENUM_TYPE_DEFINITION,
    Kind.SCALAR_TYPE_DEFINITION,
    Kind.INPUT_OBJECT_TYPE_DEFINITION,
    Kind.UNION_TYPE_DEFINITION,
  ])

  for (const definition of ast.definitions) {
    const definitionName =
      "name" in definition ? definition.name?.value : undefined
    if (definitionName && namedDefinitionKinds.has(definition.kind)) {
      typeNames.add(definitionName)
    }
  }

  const notFound: Record<string, Record<string, string>> = {}
  const parentStack: string[] = []
  const cleanedAst = visit(ast, {
    ObjectTypeExtension: {
      enter(node) {
        const typeName = node.name.value
        parentStack.push(typeName)
        if (!typeNames.has(typeName)) {
          notFound[typeName] ??= {}
          notFound[typeName].__extended = ""
          return null
        }
        return undefined
      },
      leave() {
        parentStack.pop()
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        parentStack.push(node.name.value)
      },
      leave() {
        parentStack.pop()
      },
    },
    FieldDefinition: {
      leave(node) {
        const [typeName, kind] = extractTypeNameAndKind(node.type)
        if (typeName && !typeNames.has(typeName) && kind === Kind.NAMED_TYPE) {
          const currentParent = parentStack[parentStack.length - 1]
          if (currentParent) {
            notFound[currentParent] ??= {}
            notFound[currentParent][node.name.value] = typeName
          }
          return null
        }
        return undefined
      },
    },
  })

  return {
    schema: print(cleanedAst),
    notFound,
  }
}

function mergeTypeDefs(typeDefs: string): string {
  return print(mergeGraphQLTypeDefs(typeDefs))
}

function makeExecutableSchema({ typeDefs }: { typeDefs: string }): GraphQLSchema {
  return buildSchema(typeDefs)
}

export type DefineJoinerConfigOptions = {
  alias?: JoinerServiceConfigAlias[]
  idPrefixToEntityName?: Record<string, string>
  schema?: string
  models?: JoinerConfigModels
  linkableKeys?: ModuleJoinerConfig["linkableKeys"]
  primaryKeys?: string[]
}

export function defineJoinerConfig(
  serviceName: string,
  options: DefineJoinerConfigOptions = {}
): ModuleJoinerConfig {
  return defineJoinerConfigFromModels(serviceName, {
    ...options,
    models: options.models ?? [],
  })
}

export function createMedusaMikroOrmEventSubscriber(
  keys: string[],
  service: {
    interceptEntityMutationEvents: (
      event: "afterCreate" | "afterUpdate" | "afterUpsert" | "afterDelete",
      args: unknown,
      context: unknown
    ) => unknown
  }
) {
  const klass = class MikroOrmEventSubscriber {
    readonly #context: unknown

    constructor(context: unknown) {
      this.#context = context
    }

    async afterCreate(args: unknown): Promise<void> {
      await service.interceptEntityMutationEvents(
        "afterCreate",
        args,
        this.#context
      )
    }

    async afterUpdate(args: unknown): Promise<void> {
      await service.interceptEntityMutationEvents(
        "afterUpdate",
        args,
        this.#context
      )
    }

    async afterUpsert(args: unknown): Promise<void> {
      await service.interceptEntityMutationEvents(
        "afterUpsert",
        args,
        this.#context
      )
    }

    async afterDelete(args: unknown): Promise<void> {
      await service.interceptEntityMutationEvents(
        "afterDelete",
        args,
        this.#context
      )
    }
  }

  Object.defineProperty(klass, "name", {
    value: keys.join(","),
    writable: false,
  })

  return klass
}
