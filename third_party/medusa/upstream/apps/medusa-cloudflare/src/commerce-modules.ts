import {
  analyticsModuleDefinition,
  analyticsModuleExports,
  analyticsStaticResources,
} from "@medusajs/analytics/static-manifest"
import {
  apiKeyModuleDefinition,
  apiKeyModuleExports,
  apiKeyModuleModels,
  apiKeyStaticResources,
} from "@medusajs/api-key/static-manifest"
import {
  authModuleDefinition,
  authModuleExports,
  authModuleModels,
  authStaticResources,
} from "@medusajs/auth/static-manifest"
import {
  cartModuleDefinition,
  cartModuleExports,
  cartModuleModels,
  cartStaticResources,
} from "@medusajs/cart/static-manifest"
import { CartModuleService } from "@medusajs/cart/services"
import {
  cachingModuleDefinition,
  cachingModuleExports,
  cachingStaticResources,
} from "@medusajs/caching/static-manifest"
import {
  eventBusCloudflareModuleDefinition,
  eventBusCloudflareModuleExports,
  eventBusCloudflareStaticResources,
} from "@medusajs/event-bus-cloudflare/static-manifest"
import type { CloudflareQueueProducer } from "@medusajs/event-bus-cloudflare"
import {
  lockingModuleDefinition,
  lockingModuleExports,
  lockingStaticResources,
} from "@medusajs/locking/static-manifest"
import { lockingCloudflareProvider } from "@medusajs/locking-cloudflare/provider"
import { Currency } from "@medusajs/currency/models"
import {
  currencyModuleDefinition,
  currencyModuleExports,
  currencyStaticResources,
} from "@medusajs/currency/static-manifest"
import { CurrencyModuleService } from "@medusajs/currency/services"
import {
  customerModuleDefinition,
  customerModuleExports,
  customerModuleModels,
  customerStaticResources,
} from "@medusajs/customer/static-manifest"
import { CustomerModuleService } from "@medusajs/customer/services"
import {
  fileModuleDefinition,
  fileModuleExports,
  fileStaticResources,
} from "@medusajs/file/static-manifest"
import {
  fulfillmentModuleDefinition,
  fulfillmentModuleExports,
  fulfillmentModuleModels,
  fulfillmentStaticResources,
} from "@medusajs/fulfillment/static-manifest"
import {
  inventoryModuleDefinition,
  inventoryModuleExports,
  inventoryModuleModels,
  inventoryStaticResources,
} from "@medusajs/inventory/static-manifest"
import { InventoryModuleService } from "@medusajs/inventory/services"
import {
  notificationModuleDefinition,
  notificationModuleExports,
  notificationModuleModels,
  notificationStaticResources,
} from "@medusajs/notification/static-manifest"
import {
  paymentModuleDefinition,
  paymentModuleExports,
  paymentModuleModels,
  paymentStaticResources,
} from "@medusajs/payment/static-manifest"
import { PaymentModuleService } from "@medusajs/payment/services"
import {
  orderModuleDefinition,
  orderModuleExports,
  orderModuleModels,
  orderStaticResources,
} from "@medusajs/order/static-manifest"
import {
  productModuleDefinition,
  productModuleExports,
  productModuleModels,
  productStaticResources,
} from "@medusajs/product/static-manifest"
import {
  pricingModuleDefinition,
  pricingModuleExports,
  pricingModuleModels,
  pricingStaticResources,
} from "@medusajs/pricing/static-manifest"
import {
  promotionModuleDefinition,
  promotionModuleExports,
  promotionModuleModels,
  promotionStaticResources,
} from "@medusajs/promotion/static-manifest"
import {
  rbacModuleDefinition,
  rbacModuleExports,
  rbacModuleModels,
  rbacStaticResources,
} from "@medusajs/rbac/static-manifest"
import {
  regionModuleDefinition,
  regionModuleExports,
  regionModuleModels,
  regionStaticResources,
} from "@medusajs/region/static-manifest"
import { RegionModuleService } from "@medusajs/region/services"
import {
  storeModuleDefinition,
  storeModuleExports,
  storeModuleModels,
  storeStaticResources,
} from "@medusajs/store/static-manifest"
import { StoreModuleService } from "@medusajs/store/services"
import {
  stockLocationModuleDefinition,
  stockLocationModuleExports,
  stockLocationModuleModels,
  stockLocationStaticResources,
} from "@medusajs/stock-location/static-manifest"
import { StockLocationModuleService } from "@medusajs/stock-location/services"
import {
  taxModuleDefinition,
  taxModuleExports,
  taxModuleModels,
  taxStaticResources,
} from "@medusajs/tax/static-manifest"
import { TaxModuleService } from "@medusajs/tax/services"
import {
  translationModuleDefinition,
  translationModuleExports,
  translationModuleModels,
  translationStaticResources,
} from "@medusajs/translation/static-manifest"
import {
  userModuleDefinition,
  userModuleExports,
  userModuleModels,
  userStaticResources,
} from "@medusajs/user/static-manifest"
import {
  workflowEngineInMemoryModuleDefinition,
  workflowEngineInMemoryModuleExports,
  workflowEngineInMemoryStaticResources,
} from "@medusajs/workflow-engine-inmemory/static-manifest"
import {
  salesChannelModuleDefinition,
  salesChannelModuleExports,
  salesChannelModuleModels,
  salesChannelStaticResources,
} from "@medusajs/sales-channel/static-manifest"
import { SalesChannelModuleService } from "@medusajs/sales-channel/services"
import {
  settingsModuleDefinition,
  settingsModuleExports,
  settingsModuleModels,
  settingsStaticResources,
} from "@medusajs/settings/static-manifest"
import {
  drizzleModulePersistenceAdapter,
  type DrizzleMedusaManager,
} from "@medusajs/drizzle/medusa"
import { asValue } from "@medusajs/deps/awilix"
import {
  loadStaticModules,
  registerStaticRemoteQuery,
  type StaticModuleLoadConfig,
} from "@medusajs/modules-sdk/static-app"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import type {
  IAnalyticsModuleService,
  IApiKeyModuleService,
  IAuthModuleService,
  ICartModuleService,
  ICachingModuleService,
  ICurrencyModuleService,
  ICustomerModuleService,
  IEventBusModuleService,
  IFileModuleService,
  IFulfillmentModuleService,
  IInventoryService,
  ILockingModule,
  INotificationModuleService,
  IOrderModuleService,
  IPaymentModuleService,
  IPricingModuleService,
  IProductModuleService,
  IPromotionModuleService,
  IRbacModuleService,
  IRegionModuleService,
  ISalesChannelModuleService,
  ISettingsModuleService,
  IStockLocationService,
  IStoreModuleService,
  ITaxModuleService,
  ITranslationModuleService,
  IUserModuleService,
  IWorkflowEngineService,
} from "@medusajs/types"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { CartModuleRuntime } from "./cart-module"
import type { CurrencyModuleRuntime } from "./currency-module"
import { workerMemoryAnalyticsProvider } from "./analytics-memory-provider"
import { workerMemoryCachingProvider } from "./caching-memory-provider"
import { workerMemoryFileProvider } from "./file-memory-provider"
import { workerMemoryNotificationProvider } from "./notification-memory-provider"
import type { DurableObjectWorkflowExecutionStore } from "@medusajs/workflow-engine-cloudflare/execution-store"
import type { DurableObjectWorkflowDelayedActionStore } from "@medusajs/workflow-engine-cloudflare/delayed-action-store"
import type { CloudflareWorkflowSchedulerAdapter } from "@medusajs/workflow-engine-cloudflare/scheduler-adapter"
import type { DurableObjectWorkflowScheduleStore } from "@medusajs/workflow-engine-cloudflare/schedule-store"

type CartService = InstanceType<typeof CartModuleService> & ICartModuleService
type CachingService = InstanceType<
  typeof cachingStaticResources.moduleService
> &
  ICachingModuleService
type EventBusService = IEventBusModuleService
type LockingService = InstanceType<typeof lockingStaticResources.moduleService> &
  ILockingModule
type AnalyticsService = InstanceType<
  typeof analyticsStaticResources.moduleService
> &
  IAnalyticsModuleService
type ApiKeyService = InstanceType<typeof apiKeyStaticResources.moduleService> &
  IApiKeyModuleService
type AuthService = InstanceType<typeof authStaticResources.moduleService> &
  IAuthModuleService
type CurrencyService = InstanceType<typeof CurrencyModuleService> &
  ICurrencyModuleService
type CustomerService = InstanceType<typeof CustomerModuleService> &
  ICustomerModuleService
type FileService = InstanceType<typeof fileStaticResources.moduleService> &
  IFileModuleService
type FulfillmentService = InstanceType<
  typeof fulfillmentStaticResources.moduleService
> &
  IFulfillmentModuleService
type InventoryService = InstanceType<typeof InventoryModuleService> &
  IInventoryService
type NotificationService = InstanceType<
  typeof notificationStaticResources.moduleService
> &
  INotificationModuleService
type OrderService = InstanceType<typeof orderStaticResources.moduleService> &
  IOrderModuleService
type PaymentService = InstanceType<typeof PaymentModuleService> &
  IPaymentModuleService
type ProductService = InstanceType<typeof productStaticResources.moduleService> &
  IProductModuleService
type PricingService = InstanceType<typeof pricingStaticResources.moduleService> &
  IPricingModuleService
type PromotionService = InstanceType<
  typeof promotionStaticResources.moduleService
> &
  IPromotionModuleService
type RbacService = InstanceType<typeof rbacStaticResources.moduleService> &
  IRbacModuleService
type RegionService = InstanceType<typeof RegionModuleService> &
  IRegionModuleService
type SalesChannelService = InstanceType<typeof SalesChannelModuleService> &
  ISalesChannelModuleService
type SettingsService = InstanceType<typeof settingsStaticResources.moduleService> &
  ISettingsModuleService
type StockLocationService = InstanceType<typeof StockLocationModuleService> &
  IStockLocationService
type StoreService = InstanceType<typeof StoreModuleService> & IStoreModuleService
type TaxService = InstanceType<typeof TaxModuleService> & ITaxModuleService
type TranslationService = InstanceType<
  typeof translationStaticResources.moduleService
> &
  ITranslationModuleService
type UserService = InstanceType<typeof userStaticResources.moduleService> &
  IUserModuleService
type WorkflowEngineService = IWorkflowEngineService

export interface SalesChannelModuleRuntime {
  service: SalesChannelService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface AnalyticsModuleRuntime {
  service: AnalyticsService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface CachingModuleRuntime {
  service: CachingService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface EventBusModuleRuntime {
  service: EventBusService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface LockingModuleRuntime {
  service: LockingService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface SettingsModuleRuntime {
  service: SettingsService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface ApiKeyModuleRuntime {
  service: ApiKeyService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface AuthModuleRuntime {
  service: AuthService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface RegionModuleRuntime {
  service: RegionService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface CustomerModuleRuntime {
  service: CustomerService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface FileModuleRuntime {
  service: FileService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface FulfillmentModuleRuntime {
  service: FulfillmentService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface ProductModuleRuntime {
  service: ProductService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface PricingModuleRuntime {
  service: PricingService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface PromotionModuleRuntime {
  service: PromotionService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface RbacModuleRuntime {
  service: RbacService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface InventoryModuleRuntime {
  service: InventoryService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface NotificationModuleRuntime {
  service: NotificationService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface OrderModuleRuntime {
  service: OrderService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface PaymentModuleRuntime {
  service: PaymentService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface StoreModuleRuntime {
  service: StoreService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface StockLocationModuleRuntime {
  service: StockLocationService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface TaxModuleRuntime {
  service: TaxService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface TranslationModuleRuntime {
  service: TranslationService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface UserModuleRuntime {
  service: UserService
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface WorkflowEngineModuleRuntime {
  service: WorkflowEngineService
  executionStore: DurableObjectWorkflowExecutionStore
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface CommerceModulesRuntime {
  container: MedusaContainer
  analytics: AnalyticsModuleRuntime
  apiKey: ApiKeyModuleRuntime
  auth: AuthModuleRuntime
  cart: CartModuleRuntime
  caching: CachingModuleRuntime
  currency: CurrencyModuleRuntime
  customer: CustomerModuleRuntime
  eventBus: EventBusModuleRuntime
  locking: LockingModuleRuntime
  file: FileModuleRuntime
  fulfillment: FulfillmentModuleRuntime
  inventory: InventoryModuleRuntime
  notification: NotificationModuleRuntime
  order: OrderModuleRuntime
  payment: PaymentModuleRuntime
  pricing: PricingModuleRuntime
  product: ProductModuleRuntime
  promotion: PromotionModuleRuntime
  rbac: RbacModuleRuntime
  region: RegionModuleRuntime
  salesChannel: SalesChannelModuleRuntime
  settings: SettingsModuleRuntime
  stockLocation: StockLocationModuleRuntime
  store: StoreModuleRuntime
  tax: TaxModuleRuntime
  translation: TranslationModuleRuntime
  user: UserModuleRuntime
  workflowEngine: WorkflowEngineModuleRuntime
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

export interface CommerceModulesRuntimeOptions {
  lockingNamespace?: DurableObjectNamespace
  eventQueue?: CloudflareQueueProducer
  workflowSchedulerAdapter?: CloudflareWorkflowSchedulerAdapter
  workflowExecutionStore?: DurableObjectWorkflowExecutionStore
  workflowScheduleStore?: DurableObjectWorkflowScheduleStore
  workflowDelayedActionStore?: DurableObjectWorkflowDelayedActionStore
}

export const commerceModuleModels = [
  ...apiKeyModuleModels,
  ...authModuleModels,
  Currency,
  ...customerModuleModels,
  ...fileStaticResources.models,
  ...fulfillmentModuleModels,
  ...inventoryModuleModels,
  ...notificationModuleModels,
  ...orderModuleModels,
  ...paymentModuleModels,
  ...productModuleModels,
  ...pricingModuleModels,
  ...promotionModuleModels,
  ...rbacModuleModels,
  ...regionModuleModels,
  ...salesChannelModuleModels,
  ...settingsModuleModels,
  ...stockLocationModuleModels,
  ...storeModuleModels,
  ...taxModuleModels,
  ...translationModuleModels,
  ...userModuleModels,
  ...workflowEngineInMemoryStaticResources.models,
  ...cartModuleModels,
]

const commerceStaticModules: StaticModuleLoadConfig[] = [
  {
    manifest: {
      moduleDefinition: eventBusCloudflareModuleDefinition,
      moduleExports: eventBusCloudflareModuleExports,
      resources: eventBusCloudflareStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: lockingModuleDefinition,
      moduleExports: lockingModuleExports,
      resources: lockingStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: workflowEngineInMemoryModuleDefinition,
      moduleExports: workflowEngineInMemoryModuleExports,
      resources: workflowEngineInMemoryStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: analyticsModuleDefinition,
      moduleExports: analyticsModuleExports,
      resources: analyticsStaticResources,
    },
    moduleOptions: {
      providers: [
        {
          resolve: workerMemoryAnalyticsProvider,
          id: "worker-memory",
        },
      ],
    },
  },
  {
    manifest: {
      moduleDefinition: apiKeyModuleDefinition,
      moduleExports: apiKeyModuleExports,
      resources: apiKeyStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: authModuleDefinition,
      moduleExports: authModuleExports,
      resources: authStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: currencyModuleDefinition,
      moduleExports: currencyModuleExports,
      resources: currencyStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: cartModuleDefinition,
      moduleExports: cartModuleExports,
      resources: cartStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: cachingModuleDefinition,
      moduleExports: cachingModuleExports,
      resources: cachingStaticResources,
    },
    moduleOptions: {
      providers: [
        {
          resolve: workerMemoryCachingProvider,
          id: "worker-memory",
        },
      ],
    },
  },
  {
    manifest: {
      moduleDefinition: customerModuleDefinition,
      moduleExports: customerModuleExports,
      resources: customerStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: fileModuleDefinition,
      moduleExports: fileModuleExports,
      resources: fileStaticResources,
    },
    moduleOptions: {
      providers: [
        {
          resolve: workerMemoryFileProvider,
          id: "default",
        },
      ],
    },
  },
  {
    manifest: {
      moduleDefinition: fulfillmentModuleDefinition,
      moduleExports: fulfillmentModuleExports,
      resources: fulfillmentStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: inventoryModuleDefinition,
      moduleExports: inventoryModuleExports,
      resources: inventoryStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: notificationModuleDefinition,
      moduleExports: notificationModuleExports,
      resources: notificationStaticResources,
    },
    moduleOptions: {
      providers: [
        {
          resolve: workerMemoryNotificationProvider,
          id: "worker-email",
          options: {
            channels: ["email"],
          },
        },
      ],
    },
  },
  {
    manifest: {
      moduleDefinition: orderModuleDefinition,
      moduleExports: orderModuleExports,
      resources: orderStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: paymentModuleDefinition,
      moduleExports: paymentModuleExports,
      resources: paymentStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: productModuleDefinition,
      moduleExports: productModuleExports,
      resources: productStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: pricingModuleDefinition,
      moduleExports: pricingModuleExports,
      resources: pricingStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: promotionModuleDefinition,
      moduleExports: promotionModuleExports,
      resources: promotionStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: rbacModuleDefinition,
      moduleExports: rbacModuleExports,
      resources: rbacStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: regionModuleDefinition,
      moduleExports: regionModuleExports,
      resources: regionStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: storeModuleDefinition,
      moduleExports: storeModuleExports,
      resources: storeStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: salesChannelModuleDefinition,
      moduleExports: salesChannelModuleExports,
      resources: salesChannelStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: settingsModuleDefinition,
      moduleExports: settingsModuleExports,
      resources: settingsStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: stockLocationModuleDefinition,
      moduleExports: stockLocationModuleExports,
      resources: stockLocationStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: taxModuleDefinition,
      moduleExports: taxModuleExports,
      resources: taxStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: translationModuleDefinition,
      moduleExports: translationModuleExports,
      resources: translationStaticResources,
    },
  },
  {
    manifest: {
      moduleDefinition: userModuleDefinition,
      moduleExports: userModuleExports,
      resources: userStaticResources,
    },
    moduleOptions: {
      jwt_secret: "medusa-cloudflare-user-module-secret",
    },
  },
]

let commerceRuntimeCounter = 0

export async function createCommerceModulesRuntimeWithManager(
  manager: DrizzleMedusaManager,
  options: CommerceModulesRuntimeOptions = {}
): Promise<CommerceModulesRuntime> {
  const container = createMedusaContainer()
  const runtimeAliasPrefix =
    `cloudflare-commerce-runtime-${++commerceRuntimeCounter}`

  if (options.workflowScheduleStore) {
    container.register({
      workflowScheduleStore: asValue(options.workflowScheduleStore),
    })
  }
  if (options.workflowSchedulerAdapter) {
    container.register({
      workflowSchedulerAdapter: asValue(options.workflowSchedulerAdapter),
    })
  }
  if (options.workflowExecutionStore) {
    container.register({
      workflowExecutionStore: asValue(options.workflowExecutionStore),
    })
  }
  if (options.workflowDelayedActionStore) {
    container.register({
      workflowDelayedActionStore: asValue(options.workflowDelayedActionStore),
    })
  }

  const staticModules = createCommerceStaticModules(options)
  const loaded = await loadStaticModules({
    container,
    modules: staticModules.map(
      ({ manifest, moduleDeclaration, moduleOptions }) => {
        return {
          manifest,
          moduleDeclaration: {
            ...moduleDeclaration,
            alias: `${runtimeAliasPrefix}:${manifest.moduleDefinition.key}`,
          },
          moduleOptions: {
            ...moduleOptions,
            manager,
          },
        }
      }
    ),
    persistenceAdapter: drizzleModulePersistenceAdapter,
  })
  registerStaticRemoteQuery({
    container: loaded.container,
    modules: staticModules,
    services: loaded.services,
  })

  const analyticsService = loaded.services[analyticsModuleDefinition.key]
  const apiKeyService = loaded.services[apiKeyModuleDefinition.key]
  const authService = loaded.services[authModuleDefinition.key]
  const currencyService = loaded.services[currencyModuleDefinition.key]
  const cartService = loaded.services[cartModuleDefinition.key]
  const cachingService = loaded.services[cachingModuleDefinition.key]
  const customerService = loaded.services[customerModuleDefinition.key]
  const eventBusService = loaded.services[eventBusCloudflareModuleDefinition.key]
  const lockingService = loaded.services[lockingModuleDefinition.key]
  const fileService = loaded.services[fileModuleDefinition.key]
  const fulfillmentService = loaded.services[fulfillmentModuleDefinition.key]
  const inventoryService = loaded.services[inventoryModuleDefinition.key]
  const notificationService =
    loaded.services[notificationModuleDefinition.key]
  const orderService = loaded.services[orderModuleDefinition.key]
  const paymentService = loaded.services[paymentModuleDefinition.key]
  const productService = loaded.services[productModuleDefinition.key]
  const pricingService = loaded.services[pricingModuleDefinition.key]
  const promotionService = loaded.services[promotionModuleDefinition.key]
  const rbacService = loaded.services[rbacModuleDefinition.key]
  const regionService = loaded.services[regionModuleDefinition.key]
  const storeService = loaded.services[storeModuleDefinition.key]
  const salesChannelService =
    loaded.services[salesChannelModuleDefinition.key]
  const settingsService = loaded.services[settingsModuleDefinition.key]
  const stockLocationService =
    loaded.services[stockLocationModuleDefinition.key]
  const taxService = loaded.services[taxModuleDefinition.key]
  const translationService = loaded.services[translationModuleDefinition.key]
  const userService = loaded.services[userModuleDefinition.key]
  const workflowEngineService =
    loaded.services[workflowEngineInMemoryModuleDefinition.key]

  if (!isAnalyticsService(analyticsService)) {
    throw new Error(
      "Static commerce module set did not load Analytics service"
    )
  }
  if (!isApiKeyService(apiKeyService)) {
    throw new Error("Static commerce module set did not load API Key service")
  }
  if (!isAuthService(authService)) {
    throw new Error("Static commerce module set did not load Auth service")
  }
  if (!isCurrencyService(currencyService)) {
    throw new Error("Static commerce module set did not load Currency service")
  }
  if (!isCartService(cartService)) {
    throw new Error("Static commerce module set did not load Cart service")
  }
  if (!isCachingService(cachingService)) {
    throw new Error("Static commerce module set did not load Caching service")
  }
  if (!isCustomerService(customerService)) {
    throw new Error("Static commerce module set did not load Customer service")
  }
  if (!isEventBusService(eventBusService)) {
    throw new Error("Static commerce module set did not load Event Bus service")
  }
  if (!isLockingService(lockingService)) {
    throw new Error("Static commerce module set did not load Locking service")
  }
  if (!isFileService(fileService)) {
    throw new Error("Static commerce module set did not load File service")
  }
  if (!isFulfillmentService(fulfillmentService)) {
    throw new Error(
      "Static commerce module set did not load Fulfillment service"
    )
  }
  if (!isInventoryService(inventoryService)) {
    throw new Error("Static commerce module set did not load Inventory service")
  }
  if (!isNotificationService(notificationService)) {
    throw new Error(
      "Static commerce module set did not load Notification service"
    )
  }
  if (!isOrderService(orderService)) {
    throw new Error("Static commerce module set did not load Order service")
  }
  if (!isPaymentService(paymentService)) {
    throw new Error("Static commerce module set did not load Payment service")
  }
  if (!isProductService(productService)) {
    throw new Error("Static commerce module set did not load Product service")
  }
  if (!isPricingService(pricingService)) {
    throw new Error("Static commerce module set did not load Pricing service")
  }
  if (!isPromotionService(promotionService)) {
    throw new Error(
      "Static commerce module set did not load Promotion service"
    )
  }
  if (!isRbacService(rbacService)) {
    throw new Error("Static commerce module set did not load RBAC service")
  }
  if (!isRegionService(regionService)) {
    throw new Error("Static commerce module set did not load Region service")
  }
  if (!isStoreService(storeService)) {
    throw new Error("Static commerce module set did not load Store service")
  }
  if (!isSalesChannelService(salesChannelService)) {
    throw new Error(
      "Static commerce module set did not load Sales Channel service"
    )
  }
  if (!isSettingsService(settingsService)) {
    throw new Error("Static commerce module set did not load Settings service")
  }
  if (!isStockLocationService(stockLocationService)) {
    throw new Error(
      "Static commerce module set did not load Stock Location service"
    )
  }
  if (!isTaxService(taxService)) {
    throw new Error("Static commerce module set did not load Tax service")
  }
  if (!isTranslationService(translationService)) {
    throw new Error(
      "Static commerce module set did not load Translation service"
    )
  }
  if (!isUserService(userService)) {
    throw new Error("Static commerce module set did not load User service")
  }
  if (!isWorkflowEngineService(workflowEngineService)) {
    throw new Error(
      "Static commerce module set did not load Workflow Engine service"
    )
  }

  await cachingService.__hooks?.onApplicationStart?.()

  return {
    container,
    analytics: {
      service: analyticsService,
      transactionMode: manager.transactionMode,
    },
    apiKey: {
      service: apiKeyService,
      transactionMode: manager.transactionMode,
    },
    auth: {
      service: authService,
      transactionMode: manager.transactionMode,
    },
    currency: {
      service: currencyService,
      transactionMode: manager.transactionMode,
    },
    customer: {
      service: customerService,
      transactionMode: manager.transactionMode,
    },
    eventBus: {
      service: eventBusService,
      transactionMode: manager.transactionMode,
    },
    locking: {
      service: lockingService,
      transactionMode: manager.transactionMode,
    },
    file: {
      service: fileService,
      transactionMode: manager.transactionMode,
    },
    fulfillment: {
      service: fulfillmentService,
      transactionMode: manager.transactionMode,
    },
    inventory: {
      service: inventoryService,
      transactionMode: manager.transactionMode,
    },
    notification: {
      service: notificationService,
      transactionMode: manager.transactionMode,
    },
    order: {
      service: orderService,
      transactionMode: manager.transactionMode,
    },
    payment: {
      service: paymentService,
      transactionMode: manager.transactionMode,
    },
    product: {
      service: productService,
      transactionMode: manager.transactionMode,
    },
    pricing: {
      service: pricingService,
      transactionMode: manager.transactionMode,
    },
    promotion: {
      service: promotionService,
      transactionMode: manager.transactionMode,
    },
    rbac: {
      service: rbacService,
      transactionMode: manager.transactionMode,
    },
    region: {
      service: regionService,
      transactionMode: manager.transactionMode,
    },
    cart: {
      service: cartService,
      transactionMode: manager.transactionMode,
    },
    caching: {
      service: cachingService,
      transactionMode: manager.transactionMode,
    },
    salesChannel: {
      service: salesChannelService,
      transactionMode: manager.transactionMode,
    },
    settings: {
      service: settingsService,
      transactionMode: manager.transactionMode,
    },
    stockLocation: {
      service: stockLocationService,
      transactionMode: manager.transactionMode,
    },
    store: {
      service: storeService,
      transactionMode: manager.transactionMode,
    },
    tax: {
      service: taxService,
      transactionMode: manager.transactionMode,
    },
    translation: {
      service: translationService,
      transactionMode: manager.transactionMode,
    },
    user: {
      service: userService,
      transactionMode: manager.transactionMode,
    },
    workflowEngine: {
      service: workflowEngineService,
      executionStore: getRequiredRuntimeOption(
        options.workflowExecutionStore,
        "workflowExecutionStore"
      ),
      transactionMode: manager.transactionMode,
    },
    transactionMode: manager.transactionMode,
  }
}

function createCommerceStaticModules(
  options: CommerceModulesRuntimeOptions
): StaticModuleLoadConfig[] {
  return commerceStaticModules.map((moduleConfig) => {
    if (
      moduleConfig.manifest.moduleDefinition.key ===
      eventBusCloudflareModuleDefinition.key
    ) {
      if (!options.eventQueue) {
        throw new Error("Cloudflare Event Bus Queue binding is required")
      }

      return {
        ...moduleConfig,
        moduleOptions: {
          ...moduleConfig.moduleOptions,
          queue: options.eventQueue,
          dispatchLocalSubscribers: true,
        },
      }
    }

    if (
      moduleConfig.manifest.moduleDefinition.key ===
        workflowEngineInMemoryModuleDefinition.key &&
      (options.workflowScheduleStore ||
        options.workflowSchedulerAdapter ||
        options.workflowExecutionStore ||
        options.workflowDelayedActionStore)
    ) {
      const dependencies = new Set(
        moduleConfig.moduleDeclaration?.dependencies ?? []
      )
      if (options.workflowScheduleStore) {
        dependencies.add("workflowScheduleStore")
      }
      if (options.workflowSchedulerAdapter) {
        dependencies.add("workflowSchedulerAdapter")
      }
      if (options.workflowExecutionStore) {
        dependencies.add("workflowExecutionStore")
      }
      if (options.workflowDelayedActionStore) {
        dependencies.add("workflowDelayedActionStore")
      }

      return {
        ...moduleConfig,
        moduleDeclaration: {
          ...moduleConfig.moduleDeclaration,
          dependencies: [...dependencies],
        },
      }
    }

    if (
      moduleConfig.manifest.moduleDefinition.key !==
      lockingModuleDefinition.key
    ) {
      return moduleConfig
    }

    if (!options.lockingNamespace) {
      return moduleConfig
    }

    return {
      ...moduleConfig,
      moduleOptions: {
        ...moduleConfig.moduleOptions,
        providers: [
          {
            resolve: lockingCloudflareProvider,
            id: "locking-cloudflare",
            is_default: true,
            options: {
              namespace: options.lockingNamespace,
              instanceName: "medusa-locking",
            },
          },
        ],
      },
    }
  })
}

function getRequiredRuntimeOption<T>(
  value: T | undefined,
  name: string
): T {
  if (value === undefined) {
    throw new Error(`Cloudflare runtime option ${name} is required`)
  }

  return value
}

function isAnalyticsService(value: unknown): value is AnalyticsService {
  return value instanceof analyticsStaticResources.moduleService
}

function isApiKeyService(value: unknown): value is ApiKeyService {
  return value instanceof apiKeyStaticResources.moduleService
}

function isAuthService(value: unknown): value is AuthService {
  return value instanceof authStaticResources.moduleService
}

function isCurrencyService(value: unknown): value is CurrencyService {
  return value instanceof CurrencyModuleService
}

function isCartService(value: unknown): value is CartService {
  return value instanceof CartModuleService
}

function isCachingService(value: unknown): value is CachingService {
  return value instanceof cachingStaticResources.moduleService
}

function isCustomerService(value: unknown): value is CustomerService {
  return value instanceof CustomerModuleService
}

function isEventBusService(value: unknown): value is EventBusService {
  return (
    isRecord(value) &&
    typeof value.emit === "function" &&
    typeof value.subscribe === "function" &&
    typeof value.unsubscribe === "function" &&
    typeof value.releaseGroupedEvents === "function" &&
    typeof value.clearGroupedEvents === "function"
  )
}

function isWorkflowEngineService(
  value: unknown
): value is WorkflowEngineService {
  return (
    isRecord(value) &&
    typeof value.run === "function" &&
    typeof value.cancel === "function" &&
    typeof value.subscribe === "function" &&
    typeof value.unsubscribe === "function" &&
    typeof value.listWorkflowExecutions === "function"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isLockingService(value: unknown): value is LockingService {
  return value instanceof lockingStaticResources.moduleService
}

function isFileService(value: unknown): value is FileService {
  return value instanceof fileStaticResources.moduleService
}

function isFulfillmentService(
  value: unknown
): value is FulfillmentService {
  return value instanceof fulfillmentStaticResources.moduleService
}

function isInventoryService(value: unknown): value is InventoryService {
  return value instanceof InventoryModuleService
}

function isNotificationService(
  value: unknown
): value is NotificationService {
  return value instanceof notificationStaticResources.moduleService
}

function isOrderService(value: unknown): value is OrderService {
  return value instanceof orderStaticResources.moduleService
}

function isPaymentService(value: unknown): value is PaymentService {
  return value instanceof PaymentModuleService
}

function isProductService(value: unknown): value is ProductService {
  return value instanceof productStaticResources.moduleService
}

function isPricingService(value: unknown): value is PricingService {
  return value instanceof pricingStaticResources.moduleService
}

function isPromotionService(value: unknown): value is PromotionService {
  return value instanceof promotionStaticResources.moduleService
}

function isRbacService(value: unknown): value is RbacService {
  return value instanceof rbacStaticResources.moduleService
}

function isRegionService(value: unknown): value is RegionService {
  return value instanceof RegionModuleService
}

function isStoreService(value: unknown): value is StoreService {
  return value instanceof StoreModuleService
}

function isSalesChannelService(
  value: unknown
): value is SalesChannelService {
  return value instanceof SalesChannelModuleService
}

function isSettingsService(value: unknown): value is SettingsService {
  return value instanceof settingsStaticResources.moduleService
}

function isStockLocationService(
  value: unknown
): value is StockLocationService {
  return value instanceof StockLocationModuleService
}

function isTaxService(value: unknown): value is TaxService {
  return value instanceof TaxModuleService
}

function isTranslationService(value: unknown): value is TranslationService {
  return value instanceof translationStaticResources.moduleService
}

function isUserService(value: unknown): value is UserService {
  return value instanceof userStaticResources.moduleService
}
