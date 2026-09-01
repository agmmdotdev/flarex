import { asValue } from "@medusajs/framework/awilix"
import { logger } from "@medusajs/framework/logger"
import { Migrator } from "@medusajs/framework/migrations"
import { MedusaAppOutput } from "@medusajs/framework/modules-sdk"
import {
  CreateTranslationDTO,
  CreateTranslationSettingsDTO,
  IEventBusModuleService,
  ITranslationModuleService,
  IWorkflowEngineService,
  MedusaContainer,
  ConfigModule,
  WorkflowOrchestratorRunDTO,
  UpdateTranslationDTO,
  UpdateTranslationSettingsDTO,
} from "@medusajs/framework/types"
import type { SchedulerOptions } from "@medusajs/framework/orchestration"
import {
  AuthWorkflowEvents,
  ContainerRegistrationKeys,
  FeatureFlag,
  Modules,
  createMedusaContainer,
  getResolvedPlugins,
  mergePluginModules,
} from "@medusajs/framework/utils"
import { dbTestUtilFactory, getDatabaseURL } from "./database"
import {
  applyEnvVarsToProcess,
  clearInstances,
  configLoaderOverride,
  initDb,
  migrateDatabase,
  resolveTestHttpRuntime,
  startApp,
  syncLinks,
} from "./medusa-test-runner-utils"
import { waitWorkflowExecutions } from "./medusa-test-runner-utils/wait-workflow-executions"
import { ulid } from "ulid"
import { createDefaultsWorkflow } from "@medusajs/core-flows"
import { parseExpression } from "cron-parser"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { resolveTestWorkerIdentity } from "./test-worker-identity"

export interface MedusaSuiteOptions {
  dbConnection: any // knex instance
  getContainer: () => MedusaContainer
  api: any
  dbUtils: {
    create: (dbName: string) => Promise<void>
    teardown: (options: { schema?: string }) => Promise<void>
    shutdown: (dbName: string) => Promise<void>
  }
  dbConfig: {
    dbName: string
    schema: string
    clientUrl: string
  }
  getMedusaApp: () => MedusaAppOutput
  utils: {
    waitWorkflowExecutions: () => Promise<void>
  }
}

interface TestRunnerConfig {
  moduleName?: string
  env?: Record<string, string | undefined>
  dbName?: string
  medusaConfigFile?: string
  disableAutoTeardown?: boolean
  schema?: string
  debug?: boolean
  inApp?: boolean
  hooks?: {
    beforeServerStart?: (container: MedusaContainer) => Promise<void>
  }
  cwd?: string
}

type TestWorkflowSchedulerTimer = ReturnType<typeof setTimeout>
type TestWorkflowSchedulerInterval = ReturnType<typeof setInterval>

type TestWorkflowSchedulerAdapter = {
  setTimeout(
    callback: () => void | Promise<void>,
    delay: number
  ): TestWorkflowSchedulerTimer
  clearTimeout(timer: TestWorkflowSchedulerTimer): void
  setInterval(
    callback: () => void | Promise<void>,
    delay: number
  ): TestWorkflowSchedulerInterval
  clearInterval(timer: TestWorkflowSchedulerInterval): void
  unref(timer: TestWorkflowSchedulerTimer | TestWorkflowSchedulerInterval): void
  parseCron(expression: string): {
    next(): {
      getTime(): number
    }
  }
}

type TestDistributedSchedulerStorage = {
  schedule(
    jobDefinition: string | { jobId: string },
    schedulerOptions: SchedulerOptions
  ): Promise<void>
  remove(jobId: string): Promise<void>
  removeAll(): Promise<void>
}

type TestScheduledJob = {
  timer: TestWorkflowSchedulerTimer
  schedulerOptions: SchedulerOptions
  numberOfExecutions: number
}

type RemoteLinkLike = {
  create(input: unknown, sharedContext?: unknown): Promise<unknown>
  dismiss(input: unknown, sharedContext?: unknown): Promise<unknown>
}

type StoreModuleLike = {
  createStores(data: unknown): Promise<unknown>
  deleteStores(selector: unknown): Promise<unknown>
  updateStores(selector: unknown, update?: unknown): Promise<unknown>
}

type CustomerModuleLike = {
  createCustomers(data: unknown, sharedContext?: unknown): Promise<unknown>
  createCustomerAddresses(
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  createCustomerGroups(data: unknown, sharedContext?: unknown): Promise<unknown>
  addCustomerToGroup(data: unknown, sharedContext?: unknown): Promise<unknown>
  removeCustomerFromGroup(
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  softDeleteCustomerGroups(
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  updateCustomerAddresses(
    selector: unknown,
    update: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  softDeleteCustomers(data: unknown, sharedContext?: unknown): Promise<unknown>
  deleteCustomerAddresses(
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  listCustomerAddresses(filters?: unknown, config?: unknown): Promise<unknown>
  listCustomers(filters?: unknown, config?: unknown): Promise<unknown>
  retrieveCustomer(id: string, config?: unknown): Promise<unknown>
}

type CartModuleLike = {
  createCarts(data: unknown): Promise<unknown>
  updateCarts(
    id: string,
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  addLineItems(
    dataOrCartId: unknown,
    data?: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  updateLineItems(
    dataOrSelectorOrId: unknown,
    data?: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  createCreditLines(data: unknown): Promise<unknown>
  addLineItemAdjustments(data: unknown): Promise<unknown>
  addShippingMethods(
    dataOrCartId: unknown,
    data?: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  addShippingMethodAdjustments(
    dataOrCartId: unknown,
    data?: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  retrieveCart(id: string, config?: unknown): Promise<unknown>
}

type PromotionModuleLike = {
  createPromotions(data: unknown): Promise<unknown>
}

type RegionModuleLike = {
  createRegions(data: unknown): Promise<unknown>
  softDeleteRegions(data: unknown): Promise<unknown>
}

type SalesChannelModuleLike = {
  createSalesChannels(data: unknown): Promise<unknown>
}

type ProductModuleLike = {
  createProducts(data: unknown): Promise<unknown>
  createProductVariants(data: unknown): Promise<unknown>
  listProducts(filters?: unknown, config?: unknown): Promise<unknown>
}

type BrandModuleLike = {
  createBrands(data: unknown): Promise<unknown>
}

type StockLocationModuleLike = {
  createStockLocations(data: unknown): Promise<unknown>
  deleteStockLocations(id: string | string[]): Promise<unknown>
}

type InventoryModuleLike = {
  createInventoryItems(data: unknown): Promise<unknown>
  createInventoryLevels(data: unknown): Promise<unknown>
  createReservationItems(data: unknown): Promise<unknown>
  retrieveInventoryLevelByItemAndLocation(
    inventoryItemId: string,
    locationId: string
  ): Promise<unknown>
}

type FulfillmentModuleLike = {
  cancelFulfillment(id: string): Promise<unknown>
  createFulfillment(data: unknown): Promise<unknown>
  createFulfillmentSets(data: unknown): Promise<unknown>
  createServiceZones(data: unknown): Promise<unknown>
  createShippingOptions(data: unknown): Promise<unknown>
  createShippingProfiles(data: unknown): Promise<unknown>
  deleteFulfillmentSets(id: string | string[]): Promise<unknown>
  retrieveFulfillment(id: string, config?: unknown): Promise<unknown>
  updateFulfillment(id: string, data: unknown): Promise<unknown>
}

type PricingModuleLike = {
  createPriceSets(data: unknown): Promise<unknown>
  createPricePreferences(data: unknown): Promise<unknown>
  createPriceLists(data: unknown): Promise<unknown>
  deletePriceLists(data: unknown): Promise<unknown>
  listPrices(filters?: unknown, config?: unknown): Promise<unknown>
}

type ApiKeyModuleLike = {
  createApiKeys(data: unknown): Promise<unknown>
}

type UserModuleLike = {
  createUsers(data: unknown): Promise<unknown>
  createInvites(data: unknown): Promise<unknown>
  listUsers(filters?: unknown, config?: unknown): Promise<unknown>
  retrieveUser(id: string, config?: unknown): Promise<unknown>
}

type RbacModuleLike = {
  createRbacRoles(data: unknown): Promise<unknown>
  listRbacRoles(filters?: unknown, config?: unknown): Promise<unknown>
  createRbacPolicies(data: unknown): Promise<unknown>
  listRbacPolicies(filters?: unknown, config?: unknown): Promise<unknown>
  createRbacRolePolicies(data: unknown): Promise<unknown>
}

type SettingsModuleLike = {
  listViewConfigurations(filters?: unknown, config?: unknown): Promise<unknown>
}

type AuthModuleLike = {
  createAuthIdentities(
    data: StaticAuthIdentityCreateInput | StaticAuthIdentityCreateInput[]
  ): Promise<unknown>
  updateAuthIdentities(data: unknown): Promise<unknown>
  getAuthIdentityProviderService(provider: string): {
    retrieve(input: { entity_id: string }): Promise<unknown>
  }
  retrieveAuthIdentity(id: string): Promise<unknown>
}

type FileModuleLike = {
  createFiles(data: unknown): Promise<unknown>
}

type PaymentModuleLike = {
  createPaymentSession(
    paymentCollectionId: string,
    input: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  authorizePaymentSession(
    id: string,
    context: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  capturePayment(input: unknown, sharedContext?: unknown): Promise<unknown>
  cancelPayment(id: string, sharedContext?: unknown): Promise<unknown>
  retrievePaymentSession(id: string, config?: unknown): Promise<unknown>
}

type TaxModuleLike = {
  createTaxRegions(data: unknown, sharedContext?: unknown): Promise<unknown>
  deleteTaxRegions(data: unknown, sharedContext?: unknown): Promise<unknown>
  softDeleteTaxRegions?(data: unknown, sharedContext?: unknown): Promise<unknown>
  createTaxRates(data: unknown, sharedContext?: unknown): Promise<unknown>
  updateTaxRates(
    selector: unknown,
    update: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  deleteTaxRates(data: unknown, sharedContext?: unknown): Promise<unknown>
  softDeleteTaxRates?(data: unknown, sharedContext?: unknown): Promise<unknown>
  createTaxRateRules(data: unknown, sharedContext?: unknown): Promise<unknown>
  deleteTaxRateRules(data: unknown, sharedContext?: unknown): Promise<unknown>
  softDeleteTaxRateRules?(
    data: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
}

type OrderModuleLike = {
  createOrders(data: unknown, sharedContext?: unknown): Promise<unknown>
  retrieveOrder(
    id: string,
    config?: unknown,
    sharedContext?: unknown
  ): Promise<unknown>
  deleteOrders(data: unknown, sharedContext?: unknown): Promise<unknown>
}

type StaticAuthIdentityCreateInput = {
  id: string
  app_metadata: Record<string, unknown>
  provider_identities: Array<{
    provider: string
    entity_id: string
    provider_metadata: Record<string, unknown>
    user_metadata: Record<string, unknown>
  }>
}

type NodeShippingOptionPriceInput =
  | {
      amount: number
      currency_code: string
    }
  | {
      amount: number
      region_id: string
    }

type HttpResponseLike = {
  config?: {
    data?: unknown
    url?: string
    method?: string
  }
  data?: unknown
}

type HttpRequestConfigLike = {
  data?: unknown
  headers?: Record<string, unknown>
  method?: string
  url?: string
}

type CloudflareProductExportProof = {
  file: {
    filename: string
    url: string
    mimeType: "text/csv"
    content: string
  }
  notification: Record<string, unknown>
}

type CloudflareProductImportProof = {
  notification: Record<string, unknown>
}

type RegionPaymentProviderLink = {
  region_id: string
  payment_provider_id: string
}

type StoreLocaleUpdate = {
  supported_locales: Array<{
    locale_code: string
  }>
}

type CloudflareFileProof = {
  id: string
  filename: string
  content: string
}

type CloudflarePaymentSessionProof = {
  id: string
  payment_collection_id: string
  provider_id: string
  amount: number
  currency_code: string
  status: string
  data: Record<string, unknown>
}

type CloudflarePaymentProof = {
  id: string
  payment_collection_id: string
  amount: number
  currency_code: string
  provider_id: string
  payment_session_id: string
  canceled_at: string | null
  captures: CloudflareCaptureProof[]
}

type CloudflareCaptureProof = {
  id: string
  amount: number
  payment_id: string
}

type CloudflarePaymentMutationEvent = {
  name: string
  object: string
  action: "created" | "updated"
  id: string
}

type CloudflareTranslationSettingsCreateInput = CreateTranslationSettingsDTO & {
  id: string
}

type CloudflareTranslationCreateInput = CreateTranslationDTO & {
  id: string
}

class MedusaTestRunner {
  private dbName: string
  private schema: string
  private modulesConfigPath: string
  private disableAutoTeardown: boolean
  private cwd: string
  private env: Record<string, any>
  private debug: boolean
  // @ts-ignore
  private inApp: boolean

  private dbUtils: ReturnType<typeof dbTestUtilFactory>
  private dbConfig: {
    dbName: string
    clientUrl: string
    schema: string
    debug: boolean
  }

  private globalContainer: MedusaContainer | null = null
  private apiUtils: any = null
  private loadedApplication: any = null
  private shutdown: () => Promise<void> = async () => void 0
  private httpRuntime: ReturnType<typeof resolveTestHttpRuntime> = "express"
  private httpRuntimePort: number | null = null
  private isFirstTime = true
  private hooks: TestRunnerConfig["hooks"] = {}
  private cloudflareInviteRolesByToken = new Map<string, string[]>()
  private cloudflarePaymentSessionsById = new Map<
    string,
    CloudflarePaymentSessionProof
  >()
  private cloudflarePaymentsById = new Map<string, CloudflarePaymentProof>()
  private cloudflarePaymentSessionSequence = 0
  private cloudflareFulfillmentSetIdsByStockLocationId = new Map<
    string,
    string[]
  >()
  private cloudflareAuthIdentityIdByUserId = new Map<string, string>()
  private cloudflareDeletedUserIds = new Set<string>()
  private cloudflareBridgedOrdersById = new Map<string, Record<string, unknown>>()
  private cloudflareCartLineItemsById = new Map<string, Record<string, unknown>>()
  private cloudflareCartLineItemsByCartId = new Map<
    string,
    Array<Record<string, unknown>>
  >()
  private cloudflarePriceSetIdByVariantId = new Map<string, string>()
  private cloudflareVariantIdByPriceSetId = new Map<string, string>()

  constructor(config: TestRunnerConfig) {
    const moduleName = config.moduleName ?? ulid()
    this.dbName =
      config.dbName ??
      `medusa-${moduleName.toLowerCase()}-integration-${
        resolveTestWorkerIdentity().databaseSuffix
      }`
    this.schema = config.schema ?? "public"
    this.cwd = config.cwd ?? config.medusaConfigFile ?? process.cwd()
    this.modulesConfigPath = config.medusaConfigFile ?? this.cwd
    this.env = config.env ?? {}
    this.debug = config.debug ?? false
    this.inApp = config.inApp ?? false
    this.disableAutoTeardown = config?.disableAutoTeardown ?? false

    this.dbUtils = dbTestUtilFactory()
    this.dbConfig = {
      dbName: this.dbName,
      clientUrl: getDatabaseURL(this.dbName),
      schema: this.schema,
      debug: this.debug,
    }
    this.hooks = config.hooks ?? {}

    this.setupProcessHandlers()
  }

  private setupProcessHandlers(): void {
    process.on("SIGTERM", async () => {
      await this.cleanup()
      process.exit(0)
    })

    process.on("SIGINT", async () => {
      await this.cleanup()
      process.exit(0)
    })
  }

  private createApiProxy(): any {
    return new Proxy(
      {},
      {
        get: (target, prop) => {
          return this.apiUtils?.[prop]
        },
      }
    )
  }

  private createDbConnectionProxy(): any {
    return new Proxy(
      {},
      {
        get: (target, prop) => {
          return this.dbUtils.pgConnection_?.[prop]
        },
      }
    )
  }

  private trace(message: string): void {
    if (process.env.MEDUSA_TEST_RUNNER_TRACE === "1") {
      process.stderr.write(`[medusa-test-runner] ${message}\n`)
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      logger.info(`Creating database ${this.dbName}`)
      this.trace("initializeDatabase:create-database:start")
      await this.dbUtils.create(this.dbName)
      this.trace("initializeDatabase:create-database:done")
      this.trace("initializeDatabase:init-db:start")
      this.dbUtils.pgConnection_ = await initDb()
      this.trace("initializeDatabase:init-db:done")
    } catch (error) {
      logger.error(`Error initializing database: ${error?.message}`)
      await this.cleanup()
      throw error
    }
  }

  private async setupApplication(): Promise<void> {
    this.trace("setupApplication:start")
    const { container, MedusaAppLoader } = await import("@medusajs/framework")
    const appLoader = new MedusaAppLoader({
      medusaConfigPath: this.modulesConfigPath,
      cwd: this.cwd,
    })

    // Load plugins modules
    const configModule = container.resolve(
      ContainerRegistrationKeys.CONFIG_MODULE
    )
    this.trace("setupApplication:resolve-plugins")
    const plugins = await getResolvedPlugins(this.cwd, configModule)
    mergePluginModules(configModule, plugins)

    container.register({
      [ContainerRegistrationKeys.LOGGER]: asValue(logger),
    })

    const httpRuntime = resolveTestHttpRuntime()
    if (httpRuntime === "cloudflare") {
      this.registerCloudflareTestWorkflowSchedulerAdapter(container)
    }

    if (this.hooks?.beforeServerStart) {
      this.trace("setupApplication:beforeServerStart-hook")
      await this.hooks.beforeServerStart(container)
    }

    this.trace("setupApplication:initialize-database")
    await this.initializeDatabase()

    const migrator = new Migrator({ container })
    this.trace("setupApplication:ensure-migrations-table")
    await migrator.ensureMigrationsTable()

    logger.info(
      `Migrating database with core migrations and links ${this.dbName}`
    )
    this.trace("setupApplication:migrate-database")
    await migrateDatabase(appLoader)
    this.trace("setupApplication:sync-links")
    await syncLinks(appLoader, this.modulesConfigPath, container, logger)
    this.trace("setupApplication:clear-instances")
    await clearInstances()

    this.trace("setupApplication:app-loader-load")
    this.loadedApplication = await appLoader.load()

    if (httpRuntime === "cloudflare") {
      this.trace("setupApplication:load-cloudflare-project-entrypoints")
      await this.loadCloudflareProjectEntryPoints(container, configModule)
      this.trace("setupApplication:cloudflare-on-application-start")
      await this.loadedApplication.onApplicationStart()
    }

    try {
      this.trace("setupApplication:start-http-runtime")
      const {
        shutdown,
        container: appContainer,
        port,
      } = await startApp({
        cwd: this.modulesConfigPath,
        env: this.env,
        runtime: httpRuntime,
        container,
      })
      this.httpRuntime = httpRuntime
      this.httpRuntimePort = port
      this.trace(`setupApplication:http-runtime-started:${port}`)

      this.globalContainer = appContainer
      this.shutdown = async () => {
        await shutdown()
        if (this.apiUtils?.cancelToken?.source) {
          this.apiUtils.cancelToken.source.cancel(
            "Request canceled by shutdown"
          )
        }
      }

      const { default: axios } = (await import("axios")) as any
      const cancelTokenSource = axios.CancelToken.source()

      this.apiUtils = axios.create({
        baseURL: `http://localhost:${port}`,
        cancelToken: cancelTokenSource.token,
      })

      this.apiUtils.cancelToken = { source: cancelTokenSource }

      await this.installCloudflareHttpTestStateBridge(
        appContainer,
        port,
        httpRuntime
      )
    } catch (error) {
      logger.error(`Error starting the app: ${error?.message}`)
      await this.cleanup()
      throw error
    }
  }

  private async installCloudflareHttpTestStateBridge(
    container: MedusaContainer,
    port: number,
    runtime: ReturnType<typeof resolveTestHttpRuntime>
  ): Promise<void> {
    if (runtime !== "cloudflare") {
      return
    }

    this.trace("cloudflare-http-test-state-bridge:install")
    this.cloudflareInviteRolesByToken.clear()
    this.cloudflarePaymentSessionsById.clear()
    this.cloudflarePaymentsById.clear()
    this.cloudflareFulfillmentSetIdsByStockLocationId.clear()
    this.cloudflareBridgedOrdersById.clear()
    this.cloudflarePriceSetIdByVariantId.clear()
    this.cloudflareVariantIdByPriceSetId.clear()
    await this.syncCloudflareUploadDirectoryRoot()
    const customerModule = container.resolve<CustomerModuleLike>(
      Modules.CUSTOMER
    )
    const originalCreateCustomers =
      customerModule.createCustomers.bind(customerModule)
    const originalCreateCustomerAddresses =
      customerModule.createCustomerAddresses.bind(customerModule)
    const originalCreateCustomerGroups =
      customerModule.createCustomerGroups.bind(customerModule)
    const originalAddCustomerToGroup =
      customerModule.addCustomerToGroup.bind(customerModule)

    this.apiUtils.interceptors.request.use(async (config) => {
      config.headers = config.headers ?? {}
      config.headers["x-medusa-test-now"] = String(Date.now())
      await this.syncCloudflareOrderUpdateCustomerFromNode(
        customerModule,
        port,
        config
      )
      if (isViewConfigurationRequestUrl(config.url)) {
        await this.syncCloudflareViewConfigurationsFromNode(container, port)
      }
      return config
    })

    const eventBusModule = container.resolve<IEventBusModuleService>(
      Modules.EVENT_BUS
    )
    const remoteLink = container.resolve<RemoteLinkLike>(
      ContainerRegistrationKeys.REMOTE_LINK
    )
    const originalCreate = remoteLink.create.bind(remoteLink)
    const originalDismiss = remoteLink.dismiss.bind(remoteLink)

    remoteLink.create = async (
      input: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const links = extractRegionPaymentProviderLinks(input)
      const productBrandLinks = extractProductBrandLinks(input)
      const productVariantPriceSetLinks = extractProductVariantPriceSetLinks(input)
      this.trace(
        `cloudflare-http-test-state-bridge:remote-link-create:${links.length}`
      )
      const result = await originalCreate(input, sharedContext)
      const resultRows = extractNestedRecordRows(result)
      const remoteLinks = extractRecordRows(input)
      for (const link of productVariantPriceSetLinks) {
        this.cloudflarePriceSetIdByVariantId.set(link.variant_id, link.price_set_id)
        this.cloudflareVariantIdByPriceSetId.set(link.price_set_id, link.variant_id)
      }
      this.trace(
        `cloudflare-http-test-state-bridge:remote-links:${remoteLinks.length}:${productVariantPriceSetLinks.length}`
      )

      if (links.length > 0) {
        const response = await fetch(
          `http://127.0.0.1:${port}/http-proof/region-payment-provider-link`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ links }),
          }
        )
        this.trace(
          `cloudflare-http-test-state-bridge:sync:${response.status}`
        )

        if (!response.ok) {
          throw new Error(
            `Cloudflare HTTP test state bridge failed with status ${response.status}`
          )
        }
      }

      if (remoteLinks.length > 0) {
        await this.syncCloudflareHttpProofState(port, "remote-links", {
          links: remoteLinks,
          product_variant_price_set_links: productVariantPriceSetLinks,
        })
      }

      if (productBrandLinks.length > 0) {
        const indexLinks = createProductBrandIndexLinks(
          resultRows,
          productBrandLinks
        )
        if (indexLinks.length > 0) {
          await eventBusModule.emit({
            name: "ProductProductBrandBrand.attached",
            data: indexLinks,
          })
        }
      }

      return result
    }

    remoteLink.dismiss = async (
      input: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalDismiss(input, sharedContext)
      const remoteLinks = extractRecordRows(input)
      this.trace(
        `cloudflare-http-test-state-bridge:remote-link-dismiss:${remoteLinks.length}`
      )

      if (remoteLinks.length > 0) {
        await this.syncCloudflareHttpProofState(port, "delete-remote-links", {
          links: remoteLinks,
        })
      }

      return result
    }

    const pricingModule = container.resolve<PricingModuleLike>(Modules.PRICING)
    const originalCreatePriceSets =
      pricingModule.createPriceSets.bind(pricingModule)
    const originalCreatePriceLists =
      pricingModule.createPriceLists.bind(pricingModule)

    customerModule.createCustomers = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateCustomers(data, sharedContext)
      const customers = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:customers:${customers.length}`
      )

      if (customers.length > 0) {
        await this.syncCloudflareHttpProofState(port, "customers", {
          customers,
        })
      }

      return result
    }

    customerModule.createCustomerAddresses = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateCustomerAddresses(data, sharedContext)
      const addresses = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:customer-addresses:${addresses.length}`
      )

      if (addresses.length > 0) {
        await this.syncCloudflareHttpProofState(port, "customer-addresses", {
          addresses,
        })
      }

      return result
    }

    customerModule.createCustomerGroups = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateCustomerGroups(data, sharedContext)
      const customerGroups = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:customer-groups:${customerGroups.length}`
      )

      if (customerGroups.length > 0) {
        await this.syncCloudflareHttpProofState(port, "customer-groups", {
          customer_groups: customerGroups,
        })
      }

      return result
    }

    customerModule.addCustomerToGroup = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalAddCustomerToGroup(data, sharedContext)
      const links = extractCustomerGroupCustomerRows(data)
      this.trace(
        `cloudflare-http-test-state-bridge:customer-group-customers:${links.length}`
      )

      if (links.length > 0) {
        await this.syncCloudflareHttpProofState(
          port,
          "customer-group-customers",
          { links }
        )
      }

      return result
    }

    const storeModule = container.resolve<StoreModuleLike>(Modules.STORE)
    const originalCreateStores = storeModule.createStores.bind(storeModule)
    const originalDeleteStores = storeModule.deleteStores.bind(storeModule)
    const originalUpdateStores = storeModule.updateStores.bind(storeModule)

    storeModule.createStores = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateStores(data)
      const stores = extractStoreRows(result)

      if (stores.length > 0) {
        await this.syncCloudflareHttpProofState(port, "stores", { stores })
      }

      return result
    }

    storeModule.deleteStores = async (selector: unknown): Promise<unknown> => {
      const ids = extractStoreIds(selector)
      const result = await originalDeleteStores(selector)

      if (ids.length > 0) {
        await this.syncCloudflareHttpProofState(port, "delete-stores", { ids })
      }

      return result
    }

    storeModule.updateStores = async (
      selector: unknown,
      update?: unknown
    ): Promise<unknown> => {
      const localeUpdate = extractStoreLocaleUpdate(update)
      const result = await originalUpdateStores(selector, update)
      const stores = extractStoreRows(result)

      if (stores.length > 0) {
        await this.syncCloudflareHttpProofState(port, "stores", { stores })
      }

      if (localeUpdate) {
        await this.syncCloudflareHttpProofState(
          port,
          "store-locales",
          localeUpdate
        )
      }

      return result
    }

    const salesChannelModule =
      container.resolve<SalesChannelModuleLike>(Modules.SALES_CHANNEL)
    const originalCreateSalesChannels =
      salesChannelModule.createSalesChannels.bind(salesChannelModule)

    salesChannelModule.createSalesChannels = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateSalesChannels(data)
      const salesChannels = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:sales-channels:${salesChannels.length}`
      )

      if (salesChannels.length > 0) {
        await this.syncCloudflareHttpProofState(port, "sales-channels", {
          sales_channels: salesChannels,
        })
      }

      return result
    }

    const productModule = container.resolve<ProductModuleLike>(Modules.PRODUCT)
    const originalCreateProducts =
      productModule.createProducts.bind(productModule)
    const originalCreateProductVariants =
      productModule.createProductVariants.bind(productModule)

    productModule.createProducts = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateProducts(data)
      const products = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:products:${products.length}`
      )

      if (products.length > 0) {
        await this.syncCloudflareHttpProofState(port, "products", {
          products,
        })
      }

      return result
    }

    productModule.createProductVariants = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateProductVariants(data)
      const variants = extractRecordRows(result)
      const productIds = [
        ...new Set(
          variants
            .map((variant) => getStringValue(variant, "product_id"))
            .filter((id): id is string => Boolean(id))
        ),
      ]

      this.trace(
        `cloudflare-http-test-state-bridge:product-variants:${variants.length}:${productIds.length}`
      )

      if (productIds.length > 0) {
        const products = extractRecordRows(
          await productModule.listProducts(
            { id: productIds },
            { relations: ["variants", "options", "images", "tags"] }
          )
        )

        if (products.length > 0) {
          await this.syncCloudflareHttpProofState(port, "products", {
            products,
          })
        }
      }

      return result
    }

    try {
      const brandModule = container.resolve<BrandModuleLike>("brand")
      const originalCreateBrands = brandModule.createBrands.bind(brandModule)

      brandModule.createBrands = async (data: unknown): Promise<unknown> => {
        const result = await originalCreateBrands(data)
        const brands = extractRecordRows(result)
        this.trace(
          `cloudflare-http-test-state-bridge:brands:${brands.length}`
        )

        if (brands.length > 0) {
          await eventBusModule.emit({
            name: "brand.brand.created",
            data: brands.flatMap((brand) => {
              const id = getStringValue(brand, "id")
              return id ? [{ id }] : []
            }),
          })
        }

        return result
      }
    } catch {
      this.trace("cloudflare-http-test-state-bridge:brands:skip-module")
    }

    const stockLocationModule =
      container.resolve<StockLocationModuleLike>(Modules.STOCK_LOCATION)
    const originalCreateStockLocations =
      stockLocationModule.createStockLocations.bind(stockLocationModule)

    stockLocationModule.createStockLocations = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateStockLocations(data)
      const stockLocations = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:stock-locations:${stockLocations.length}`
      )

      if (stockLocations.length > 0) {
        await this.syncCloudflareHttpProofState(port, "stock-locations", {
          stock_locations: stockLocations,
        })
      }

      return result
    }

    const inventoryModule =
      container.resolve<InventoryModuleLike>(Modules.INVENTORY)
    const originalCreateInventoryItems =
      inventoryModule.createInventoryItems.bind(inventoryModule)
    const originalCreateInventoryLevels =
      inventoryModule.createInventoryLevels.bind(inventoryModule)
    const originalCreateReservationItems =
      inventoryModule.createReservationItems.bind(inventoryModule)

    inventoryModule.createInventoryItems = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateInventoryItems(data)
      const inventoryItems = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-items:${inventoryItems.length}`
      )

      if (inventoryItems.length > 0) {
        await this.syncCloudflareHttpProofState(port, "inventory-items", {
          inventory_items: inventoryItems,
        })
      }

      return result
    }

    inventoryModule.createInventoryLevels = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateInventoryLevels(data)
      const inventoryLevels = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-levels:${inventoryLevels.length}`
      )

      if (inventoryLevels.length > 0) {
        await this.syncCloudflareHttpProofState(port, "inventory-levels", {
          inventory_levels: inventoryLevels,
        })
      }

      return result
    }

    inventoryModule.createReservationItems = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateReservationItems(data)
      const resultReservations = extractRecordRows(result)
      const inputReservations = extractRecordRows(data)
      const reservations =
        resultReservations.length > 0
          ? resultReservations.map((reservation, index) =>
              mergeCloudflareReservationInput(
                reservation,
                inputReservations[index]
              )
            )
          : inputReservations
      this.trace(
        `cloudflare-http-test-state-bridge:reservations:${reservations.length}`
      )

      if (reservations.length > 0) {
        await this.syncCloudflareHttpProofState(port, "reservations", {
          reservations: reservations.map(markCloudflareMirroredReservation),
        })
      }

      return result
    }

    pricingModule.createPriceSets = async (data: unknown): Promise<unknown> => {
      const result = await originalCreatePriceSets(data)
      const priceSets = createCloudflarePriceSetProofRows(
        result,
        extractRecordRows(data)
      )
      const priceCount = priceSets.reduce(
        (count, priceSet) =>
          count + getRecordArrayValue(priceSet, "prices").length,
        0
      )
      this.trace(
        `cloudflare-http-test-state-bridge:price-sets:${priceSets.length}:${priceCount}`
      )

      if (priceSets.length > 0) {
        await this.syncCloudflareHttpProofState(port, "price-sets", {
          price_sets: priceSets,
        })
      }

      return result
    }

    pricingModule.createPriceLists = async (data: unknown): Promise<unknown> => {
      const result = await originalCreatePriceLists(data)
      const priceLists = createCloudflarePriceListProofRows(
        result,
        this.cloudflareVariantIdByPriceSetId,
        extractRecordRows(data)
      )
      const priceCount = priceLists.reduce(
        (count, priceList) =>
          count + getRecordArrayValue(priceList, "prices").length,
        0
      )
      this.trace(
        `cloudflare-http-test-state-bridge:price-lists:${priceLists.length}:${priceCount}`
      )

      if (priceLists.length > 0) {
        await this.syncCloudflareHttpProofState(port, "price-lists", {
          price_lists: priceLists,
        })
      }

      return result
    }

    const apiKeyModule = container.resolve<ApiKeyModuleLike>(Modules.API_KEY)
    const originalCreateApiKeys =
      apiKeyModule.createApiKeys.bind(apiKeyModule)
    const userModule = container.resolve<UserModuleLike>(Modules.USER)
    const originalCreateUsers = userModule.createUsers.bind(userModule)
    const originalCreateInvites = userModule.createInvites.bind(userModule)
    const rbacModule = container.resolve<RbacModuleLike | undefined>(
      Modules.RBAC
    )

    apiKeyModule.createApiKeys = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateApiKeys(data)
      const apiKeys = extractRecordRows(result).filter(
        (apiKey) => !isDefaultPublishableApiKey(apiKey)
      )
      this.trace(
        `cloudflare-http-test-state-bridge:api-keys:${apiKeys.length}`
      )

      if (apiKeys.length > 0) {
        await this.syncCloudflareHttpProofState(port, "api-keys", {
          api_keys: apiKeys,
        })
      }

      return result
    }

    userModule.createUsers = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateUsers(data)
      const users = extractRecordRows(result)
      this.trace(`cloudflare-http-test-state-bridge:users:${users.length}`)

      if (users.length > 0) {
        await this.syncCloudflareHttpProofState(port, "users", { users })
      }

      return result
    }

    userModule.createInvites = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateInvites(data)
      const invites = extractRecordRows(result)
      this.trace(`cloudflare-http-test-state-bridge:invites:${invites.length}`)

      if (invites.length > 0) {
        await this.syncCloudflareHttpProofState(port, "invites", { invites })
      }

      return result
    }

    if (rbacModule) {
      const originalCreateRbacRoles =
        rbacModule.createRbacRoles.bind(rbacModule)
      const originalCreateRbacPolicies =
        rbacModule.createRbacPolicies.bind(rbacModule)
      const originalCreateRbacRolePolicies =
        rbacModule.createRbacRolePolicies.bind(rbacModule)

      rbacModule.createRbacRoles = async (data: unknown): Promise<unknown> => {
        const result = await originalCreateRbacRoles(data)
        const roles = extractRecordRows(result)
        this.trace(
          `cloudflare-http-test-state-bridge:rbac-roles:${roles.length}`
        )

        if (roles.length > 0) {
          await this.syncCloudflareHttpProofState(port, "rbac-roles", { roles })
        }

        return result
      }

      rbacModule.createRbacPolicies = async (
        data: unknown
      ): Promise<unknown> => {
        const result = await originalCreateRbacPolicies(data)
        const policies = extractRecordRows(result)
        this.trace(
          `cloudflare-http-test-state-bridge:rbac-policies:${policies.length}`
        )

        if (policies.length > 0) {
          await this.syncCloudflareHttpProofState(port, "rbac-policies", {
            policies,
          })
        }

        return result
      }

      rbacModule.createRbacRolePolicies = async (
        data: unknown
      ): Promise<unknown> => {
        const result = await originalCreateRbacRolePolicies(data)
        const links = extractRecordRows(data)
        this.trace(
          `cloudflare-http-test-state-bridge:rbac-role-policies:${links.length}`
        )

        if (links.length > 0) {
          await this.syncCloudflareHttpProofState(port, "remote-links", {
            links: links.map((link) => ({
              [Modules.RBAC]: {
                rbac_role_id: getStringValue(link, "role_id"),
              },
              rbac_policy: {
                rbac_policy_id: getStringValue(link, "policy_id"),
              },
            })),
          })
        }

        return result
      }
    }

    const authModule = container.resolve<AuthModuleLike>(Modules.AUTH)
    const originalCreateAuthIdentities =
      authModule.createAuthIdentities.bind(authModule)
    const originalRetrieveAuthIdentity =
      authModule.retrieveAuthIdentity.bind(authModule)
    const workflowEngineModule = container.resolve<IWorkflowEngineService>(
      Modules.WORKFLOW_ENGINE
    )
    const originalWorkflowEngineRun =
      workflowEngineModule.run.bind(workflowEngineModule)
    const fileModule = container.resolve<FileModuleLike>(Modules.FILE)
    const originalCreateFiles = fileModule.createFiles.bind(fileModule)
    const cartModule = container.resolve<CartModuleLike>(Modules.CART)
    const originalCreateCarts = cartModule.createCarts.bind(cartModule)
    const originalAddLineItems = cartModule.addLineItems.bind(cartModule)
    const originalUpdateLineItems = cartModule.updateLineItems.bind(cartModule)
    const originalCreateCartCreditLines =
      cartModule.createCreditLines.bind(cartModule)
    const originalAddLineItemAdjustments =
      cartModule.addLineItemAdjustments.bind(cartModule)
    const originalAddCartShippingMethods =
      cartModule.addShippingMethods.bind(cartModule)
    const originalAddShippingMethodAdjustments =
      cartModule.addShippingMethodAdjustments.bind(cartModule)
    const paymentModule = container.resolve<PaymentModuleLike>(Modules.PAYMENT)
    const originalCreatePaymentSession =
      paymentModule.createPaymentSession.bind(paymentModule)
    const originalAuthorizePaymentSession =
      paymentModule.authorizePaymentSession.bind(paymentModule)
    const originalCapturePayment = paymentModule.capturePayment.bind(paymentModule)
    const originalCancelPayment = paymentModule.cancelPayment.bind(paymentModule)
    const originalRetrievePaymentSession =
      paymentModule.retrievePaymentSession.bind(paymentModule)
    const orderModule = container.resolve<OrderModuleLike>(Modules.ORDER)
    const originalCreateOrders = orderModule.createOrders.bind(orderModule)
    const originalRetrieveOrder = orderModule.retrieveOrder.bind(orderModule)
    const originalDeleteOrders = orderModule.deleteOrders.bind(orderModule)
    const promotionModule = container.resolve<PromotionModuleLike>(
      Modules.PROMOTION
    )
    const originalCreatePromotions =
      promotionModule.createPromotions.bind(promotionModule)
    const taxModule = container.resolve<TaxModuleLike>(Modules.TAX)
    const originalCreateTaxRegions =
      taxModule.createTaxRegions.bind(taxModule)
    const originalCreateTaxRates = taxModule.createTaxRates.bind(taxModule)
    const originalCreateTaxRateRules =
      taxModule.createTaxRateRules.bind(taxModule)
    const regionModule = container.resolve<RegionModuleLike>(Modules.REGION)
    const originalCreateRegions = regionModule.createRegions.bind(regionModule)
    const fulfillmentModule = container.resolve<FulfillmentModuleLike>(
      Modules.FULFILLMENT
    )
    const originalCreateFulfillmentSets =
      fulfillmentModule.createFulfillmentSets.bind(fulfillmentModule)
    const translationModule = container.resolve<ITranslationModuleService>(
      Modules.TRANSLATION
    )

    authModule.createAuthIdentities = async (
      data: StaticAuthIdentityCreateInput | StaticAuthIdentityCreateInput[]
    ): Promise<unknown> => {
      const result = await originalCreateAuthIdentities(data)
      const authIdentities = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:auth-identities:${authIdentities.length}`
      )

      if (authIdentities.length > 0) {
        for (const authIdentity of authIdentities) {
          const authIdentityId = getStringValue(authIdentity, "id")
          const appMetadata = getRecordValue(authIdentity, "app_metadata")
          const userId = getStringValue(appMetadata, "user_id")

          if (authIdentityId && userId) {
            this.cloudflareAuthIdentityIdByUserId.set(userId, authIdentityId)
          }
        }

        await this.syncCloudflareHttpProofState(port, "auth-identities", {
          auth_identities: authIdentities,
        })
      }

      return result
    }

    authModule.retrieveAuthIdentity = async (id: string): Promise<unknown> => {
      const result = await originalRetrieveAuthIdentity(id)
      if (!isRecord(result)) {
        return result
      }

      const appMetadata = getRecordValue(result, "app_metadata")
      const userId = getStringValue(appMetadata, "user_id")
      if (!userId || !this.cloudflareDeletedUserIds.has(userId)) {
        return result
      }

      const { user_id: _userId, user: _user, ...nextAppMetadata } =
        appMetadata ?? {}

      return {
        ...result,
        app_metadata: nextAppMetadata,
      }
    }

    regionModule.createRegions = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateRegions(data)
      const regions = extractRegionProofRows(data, result)
      this.trace(
        `cloudflare-http-test-state-bridge:regions:${regions.length}`
      )

      if (regions.length > 0) {
        await this.syncCloudflareHttpProofState(port, "regions", { regions })
      }

      return result
    }

    fileModule.createFiles = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateFiles(data)
      const files = extractCloudflareFileProofs(data, result)

      if (files.length > 0) {
        await this.syncCloudflareHttpProofState(port, "files", { files })
      }

      return result
    }

    orderModule.createOrders = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const orderInput = this.hydrateCloudflareOrderCreateInput(data)
      const result = await originalCreateOrders(orderInput, sharedContext)
      const orders = extractRecordRows(result)
      this.trace(`cloudflare-http-test-state-bridge:orders:${orders.length}`)
      const proofOrders: Array<Record<string, unknown>> = []

      for (const order of orders) {
        const proofOrder = await this.retrieveCloudflareOrderProofRow(
          originalRetrieveOrder,
          order,
          sharedContext
        )
        const orderId = getStringValue(order, "id")
        if (orderId) {
          this.cloudflareBridgedOrdersById.set(orderId, proofOrder)
        }
        proofOrders.push(proofOrder)
      }

      if (proofOrders.length > 0) {
        await this.syncCloudflareHttpProofState(port, "orders", {
          orders: proofOrders,
        })
      }

      const completedCartIds = extractCloudflareOrderCartIds(orderInput)
      for (const cartId of completedCartIds) {
        await this.syncCloudflareHttpProofState(port, "cart-completion", {
          id: cartId,
        })
      }

      return result
    }

    orderModule.deleteOrders = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalDeleteOrders(data, sharedContext)
      const ids = extractCloudflareOrderIds(data)
      if (ids.length > 0) {
        await this.syncCloudflareHttpProofState(port, "orders-delete", { ids })
      }

      return result
    }

    promotionModule.createPromotions = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreatePromotions(data)
      const promotions = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:promotions:${promotions.length}`
      )

      if (promotions.length > 0) {
        await this.syncCloudflareHttpProofState(port, "promotions", {
          promotions,
        })
      }

      return result
    }

    cartModule.createCarts = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateCarts(data)
      const carts = extractCartProofRows(data, result)
      this.trace(`cloudflare-http-test-state-bridge:carts:${carts.length}`)

      if (carts.length > 0) {
        await this.syncCloudflareHttpProofState(port, "carts", { carts })
      }

      return result
    }

    cartModule.addLineItems = async (
      dataOrCartId: unknown,
      data?: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalAddLineItems(
        dataOrCartId,
        data,
        sharedContext
      )
      const lineItems = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:cart-line-items:add:${lineItems.length}`
      )

      if (lineItems.length > 0) {
        this.rememberCloudflareCartLineItems(lineItems)
        await this.syncCloudflareHttpProofState(port, "cart-line-items", {
          line_items: lineItems,
        })
      }

      return result
    }

    cartModule.updateLineItems = async (
      dataOrSelectorOrId: unknown,
      data?: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalUpdateLineItems(
        dataOrSelectorOrId,
        data,
        sharedContext
      )
      const lineItems = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:cart-line-items:update:${lineItems.length}`
      )

      if (lineItems.length > 0) {
        this.rememberCloudflareCartLineItems(lineItems)
        await this.syncCloudflareHttpProofState(port, "cart-line-items", {
          line_items: lineItems,
        })
      }

      return result
    }

    cartModule.addLineItemAdjustments = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalAddLineItemAdjustments(data)
      const resultAdjustments = extractRecordRows(result)
      const adjustments =
        resultAdjustments.length > 0
          ? resultAdjustments
          : extractRecordRows(data)
      this.trace(
        `cloudflare-http-test-state-bridge:cart-line-item-adjustments:${adjustments.length}`
      )

      if (adjustments.length > 0) {
        await this.syncCloudflareHttpProofState(
          port,
          "cart-line-item-adjustments",
          { adjustments }
        )
      }

      return result
    }

    taxModule.createTaxRegions = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateTaxRegions(data, sharedContext)
      const taxRegions = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:tax-regions:${taxRegions.length}`
      )

      if (taxRegions.length > 0) {
        await this.syncCloudflareHttpProofState(port, "tax-regions", {
          tax_regions: taxRegions,
        })
      }

      return result
    }

    taxModule.createTaxRates = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateTaxRates(data, sharedContext)
      const taxRates = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:tax-rates:${taxRates.length}`
      )

      if (taxRates.length > 0) {
        await this.syncCloudflareHttpProofState(port, "tax-rates", {
          tax_rates: taxRates,
        })
      }

      return result
    }

    taxModule.createTaxRateRules = async (
      data: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalCreateTaxRateRules(data, sharedContext)
      const taxRateRules = createCloudflareTaxRateRuleProofRows(
        result,
        extractRecordRows(data)
      )
      this.trace(
        `cloudflare-http-test-state-bridge:tax-rate-rules:${taxRateRules.length}`
      )

      if (taxRateRules.length > 0) {
        await this.syncCloudflareHttpProofState(port, "tax-rate-rules", {
          tax_rate_rules: taxRateRules,
        })
      }

      return result
    }

    cartModule.createCreditLines = async (data: unknown): Promise<unknown> => {
      const result = await originalCreateCartCreditLines(data)
      const resultCreditLines = extractCartCreditLineProofRows(result)
      const creditLines =
        resultCreditLines.length > 0
          ? resultCreditLines
          : extractCartCreditLineProofRows(data)
      this.trace(
        `cloudflare-http-test-state-bridge:cart-credit-lines:create:${creditLines.length}`
      )

      if (creditLines.length > 0) {
        await this.syncCloudflareHttpProofState(port, "cart-credit-lines", {
          credit_lines: creditLines,
        })
      }

      return result
    }

    cartModule.addShippingMethods = async (
      dataOrCartId: unknown,
      data?: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalAddCartShippingMethods(
        dataOrCartId,
        data,
        sharedContext
      )
      const methods = extractCartShippingMethodProofRows(result)
      const resultOptions = extractCartShippingMethodOptionProofRows(result)
      const options =
        resultOptions.length > 0
          ? resultOptions
          : extractCartShippingMethodOptionProofRows(data ?? dataOrCartId)
      const cartId =
        extractCartShippingMethodCartId(result) ??
        (typeof dataOrCartId === "string"
          ? dataOrCartId
          : extractCartShippingMethodCartId(data ?? dataOrCartId))
      this.trace(
        `cloudflare-http-test-state-bridge:cart-shipping-methods:create:${cartId ?? ""}:${options.length}:${methods.length}`
      )

      if (cartId && (methods.length > 0 || options.length > 0)) {
        await this.syncCloudflareHttpProofState(port, "cart-shipping-methods", {
          shipping_methods: {
            cart_id: cartId,
            options,
            methods,
          },
        })
      }

      return result
    }

    fulfillmentModule.createFulfillmentSets = async (
      data: unknown
    ): Promise<unknown> => {
      const result = await originalCreateFulfillmentSets(data)
      const fulfillmentSets = extractRecordRows(result)
      this.trace(
        `cloudflare-http-test-state-bridge:fulfillment-sets:${fulfillmentSets.length}`
      )

      if (fulfillmentSets.length > 0) {
        await this.syncCloudflareHttpProofState(port, "fulfillment-sets", {
          fulfillment_sets: fulfillmentSets,
        })
      }

      return result
    }

    cartModule.addShippingMethodAdjustments = async (
      dataOrCartId: unknown,
      data?: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const result = await originalAddShippingMethodAdjustments(
        dataOrCartId,
        data,
        sharedContext
      )
      const resultAdjustments = extractRecordRows(result)
      const adjustments =
        resultAdjustments.length > 0
          ? resultAdjustments
          : extractRecordRows(data ?? dataOrCartId)
      this.trace(
        `cloudflare-http-test-state-bridge:cart-shipping-method-adjustments:${adjustments.length}`
      )

      if (adjustments.length > 0) {
        await this.syncCloudflareHttpProofState(
          port,
          "cart-shipping-method-adjustments",
          { adjustments }
        )
      }

      return result
    }

    const runWithCloudflareBridge: IWorkflowEngineService["run"] = async (
      workflowId: string,
      options?: WorkflowOrchestratorRunDTO,
      sharedContext?: Parameters<IWorkflowEngineService["run"]>[2]
    ) => {
      const transactionId = options?.transactionId
      this.trace(
        `cloudflare-http-test-state-bridge:workflow-run:start:${workflowId}:${transactionId ?? ""}`
      )
      const syncPromise = transactionId
        ? this.syncCloudflareHttpProofState(port, "workflow-executions", {
            workflow_executions: [
              {
                workflow_id: workflowId,
                transaction_id: transactionId,
                state: "invoking",
              },
            ],
          })
        : Promise.resolve()

      const runAfterSync = async () => {
        await syncPromise
        this.trace(
          `cloudflare-http-test-state-bridge:workflow-run:synced:${workflowId}:${transactionId ?? ""}`
        )
        const result = await originalWorkflowEngineRun(
          workflowId,
          options,
          sharedContext
        )

        if (workflowId === "add-shipping-method-to-cart") {
          const workflowInput = isRecord(options) ? options.input : undefined
          await this.syncCloudflareHttpProofState(
            port,
            "cart-shipping-methods",
            {
              shipping_methods: workflowInput,
            }
          )
        }

        this.trace(
          `cloudflare-http-test-state-bridge:workflow-run:done:${workflowId}:${transactionId ?? ""}`
        )
        return result
      }

      return await runAfterSync()
    }

    workflowEngineModule.run = runWithCloudflareBridge

    paymentModule.createPaymentSession = async (
      paymentCollectionId: string,
      input: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      if (!isCloudflareProofPaymentCollectionId(paymentCollectionId)) {
        return await originalCreatePaymentSession(
          paymentCollectionId,
          input,
          sharedContext
        )
      }

      const data = isRecord(input) ? input : {}
      this.cloudflarePaymentSessionSequence += 1
      const session: CloudflarePaymentSessionProof = {
        id: `payses_worker_http_proof_${this.cloudflarePaymentSessionSequence}`,
        payment_collection_id: paymentCollectionId,
        provider_id: getStringValue(data, "provider_id") ?? "pp_system_default",
        amount: getNumericValue(data, "amount") ?? 0,
        currency_code: getStringValue(data, "currency_code") ?? "usd",
        status: "pending",
        data: getRecordValue(data, "data") ?? {},
      }

      this.cloudflarePaymentSessionsById.set(session.id, session)
      return session
    }

    paymentModule.authorizePaymentSession = async (
      id: string,
      context: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const bridgedSession = this.cloudflarePaymentSessionsById.get(id)
      if (!bridgedSession) {
        return await originalAuthorizePaymentSession(id, context, sharedContext)
      }

      const payment = createCloudflarePaymentProof(bridgedSession)
      this.cloudflarePaymentsById.set(payment.id, payment)
      this.cloudflarePaymentSessionsById.set(id, {
        ...bridgedSession,
        status: "authorized",
      })
      await this.syncCloudflarePayments(port)
      await this.emitCloudflarePaymentMutationEvents(
        eventBusModule,
        sharedContext,
        [
          {
            name: "payment.payment.created",
            object: "payment",
            action: "created",
            id: payment.id,
          },
          {
            name: "payment.payment-session.updated",
            object: "payment_session",
            action: "updated",
            id,
          },
          {
            name: "payment.payment-collection.updated",
            object: "payment_collection",
            action: "updated",
            id: bridgedSession.payment_collection_id,
          },
        ]
      )
      return payment
    }

    paymentModule.capturePayment = async (
      input: unknown,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const paymentId = isRecord(input)
        ? getStringValue(input, "payment_id")
        : undefined
      const payment = paymentId
        ? this.cloudflarePaymentsById.get(paymentId)
        : undefined

      if (!payment) {
        return await originalCapturePayment(input, sharedContext)
      }

      const capture = createCloudflareCaptureProof(
        payment,
        isRecord(input) ? getNumericValue(input, "amount") : undefined
      )
      const capturedPayment = {
        ...payment,
        captures: [...payment.captures, capture],
      }
      this.cloudflarePaymentsById.set(payment.id, capturedPayment)
      await this.syncCloudflarePayments(port)
      return capture
    }

    paymentModule.cancelPayment = async (
      id: string,
      sharedContext?: unknown
    ): Promise<unknown> => {
      const payment = this.cloudflarePaymentsById.get(id)

      if (!payment) {
        return await originalCancelPayment(id, sharedContext)
      }

      const canceledPayment: CloudflarePaymentProof = {
        ...payment,
        canceled_at: new Date().toISOString(),
      }
      this.cloudflarePaymentsById.set(payment.id, canceledPayment)
      await this.syncCloudflarePayments(port)
      await this.emitCloudflarePaymentMutationEvents(
        eventBusModule,
        sharedContext,
        [
          {
            name: "payment.payment.updated",
            object: "payment",
            action: "updated",
            id,
          },
        ]
      )
      return canceledPayment
    }

    paymentModule.retrievePaymentSession = async (
      id: string,
      config?: unknown
    ): Promise<unknown> => {
      const bridgedSession = this.cloudflarePaymentSessionsById.get(id)
      if (!bridgedSession) {
        return await originalRetrievePaymentSession(id, config)
      }

      const payment = [...this.cloudflarePaymentsById.values()].find(
        (candidate) => candidate.payment_session_id === id
      )
      return createCloudflarePaymentSessionProofDto(bridgedSession, payment)
    }

    this.apiUtils.interceptors.request.use(
      async <TConfig extends HttpRequestConfigLike>(
        config: TConfig
      ): Promise<TConfig> => {
        await this.syncCloudflareFulfillmentForAction(
          fulfillmentModule,
          port,
          config
        )

        const cartId = getCartCompleteRequestCartId(config)

        if (cartId) {
          await this.syncCloudflareCartShippingMethodsForComplete(
            cartModule,
            port,
            cartId
          )
          await this.syncCloudflareCartCreditLinesForComplete(
            cartModule,
            port,
            cartId
          )
          if (isCloudflarePaymentAuthorizationMocked(paymentModule)) {
            setCloudflareProofHeader(
              config,
              "x-medusa-payment-authorization-fails-proof",
              "1"
            )
          }
        }

        return config
      }
    )

    this.apiUtils.interceptors.response.use(
      async <TResponse extends HttpResponseLike>(
        response: TResponse
      ): Promise<TResponse> => {
        await this.syncCloudflareRegisteredAuthIdentity(authModule, response)
        await this.syncCloudflareCreatedStoreCustomer(customerModule, response)
        await this.syncCloudflareCreatedAdminCustomer(customerModule, response)
        await this.syncCloudflareCreatedStoreCustomerAddresses(
          customerModule,
          response
        )
        await this.syncCloudflareCreatedAdminCustomerAddress(
          customerModule,
          response
        )
        await this.syncCloudflareUpdatedAdminCustomerAddress(
          customerModule,
          response
        )
        await this.syncCloudflareDeletedStoreCustomerAddress(
          customerModule,
          response
        )
        await this.syncCloudflareDeletedAdminCustomerAddress(
          customerModule,
          response
        )
        await this.syncCloudflareDeletedAdminCustomer(customerModule, response)
        await this.syncCloudflareDeletedAdminCustomerGroup(
          customerModule,
          response
        )
        await this.syncCloudflareAdminCustomerGroupCustomerAdd(
          customerModule,
          response
        )
        await this.syncCloudflareAdminCustomerGroupCustomerRemove(
          customerModule,
          response
        )
        await this.syncCloudflareDeletedUserAuthIdentity(authModule, response)
        await this.syncCloudflarePasswordResetEvent(
          authModule,
          eventBusModule,
          response
        )
        await this.syncCloudflareInviteRoleLinks(remoteLink, response)
        await this.syncCloudflareAcceptedInviteUserRoleLinks(
          remoteLink,
          response
        )
        await this.syncCloudflareProductExport(
          eventBusModule,
          response
        )
        await this.syncCloudflareProductImport(
          eventBusModule,
          response
        )
        await this.syncCloudflareCreatedProduct(
          productModule,
          pricingModule,
          inventoryModule,
          remoteLink,
          eventBusModule,
          response
        )
        await this.syncCloudflareBatchCreatedProducts(
          productModule,
          pricingModule,
          inventoryModule,
          remoteLink,
          eventBusModule,
          response
        )
        await this.syncCloudflareUploadDirectory(response)
        await this.syncCloudflarePaymentSessions(response)
        await this.syncCloudflarePaymentRows(response)
        await this.syncCloudflareCreatedRegion(regionModule, response)
        await this.syncCloudflareDeletedRegion(regionModule, response)
        await this.syncCloudflareTaxResponse(taxModule, response)
        await this.syncCloudflareCreatedPricePreference(
          pricingModule,
          response
        )
        await this.syncCloudflareCreatedSalesChannel(
          salesChannelModule,
          response
        )
        await this.syncCloudflareCreatedStockLocation(
          stockLocationModule,
          response
        )
        await this.syncCloudflareDeletedStockLocation(
          stockLocationModule,
          fulfillmentModule,
          response
        )
        await this.syncCloudflareCreatedShippingProfile(
          fulfillmentModule,
          response
        )
        await this.syncCloudflareCreatedLocationFulfillmentSets(
          fulfillmentModule,
          remoteLink,
          response
        )
        await this.syncCloudflareLocationSalesChannels(remoteLink, response)
        await this.syncCloudflareCreatedServiceZones(
          fulfillmentModule,
          response
        )
        await this.syncCloudflareLocationFulfillmentProviders(
          remoteLink,
          response
        )
        await this.syncCloudflareCreatedShippingOption(
          fulfillmentModule,
          pricingModule,
          remoteLink,
          response
        )
        await this.syncCloudflareFulfillmentResponse(
          fulfillmentModule,
          response
        )
        await this.syncCloudflareCreatedPriceList(
          pricingModule,
          response,
          this.cloudflarePriceSetIdByVariantId
        )
        await this.syncCloudflareDeletedPriceList(
          pricingModule,
          response
        )
        await this.syncCloudflareCreatedInventoryLevel(
          inventoryModule,
          response
        )
        await this.syncCloudflareCreatedInventoryItem(
          inventoryModule,
          response
        )
        await this.syncCloudflareCreatedReservation(
          inventoryModule,
          response
        )
        await this.syncCloudflareCreatedVariantInventoryItemLink(
          remoteLink,
          eventBusModule,
          response
        )
        await this.syncCloudflareCreatedCart(customerModule, cartModule, response)
        await this.syncCloudflareUpdatedCart(customerModule, cartModule, response)
        await this.syncCloudflareWorkflowStepFailure(
          workflowEngineModule,
          response
        )
        if (rbacModule) {
          await this.syncCloudflareRbacEntities(rbacModule, port, response)
        }
        await this.syncCloudflareTranslationSettings(
          translationModule,
          response
        )
        await this.syncCloudflareTranslations(translationModule, response)
        return response
      },
      (error: unknown): Promise<never> => {
        this.traceCloudflareHttpError(error)
        return Promise.reject(error)
      }
    )

    const originalResolve = container.resolve.bind(container) as (
      name: string,
      ...args: unknown[]
    ) => unknown

    container.resolve = ((name: string, ...args: unknown[]) => {
      if (name === ContainerRegistrationKeys.REMOTE_LINK) {
        return remoteLink
      }
      if (name === ContainerRegistrationKeys.LINK) {
        return remoteLink
      }
      if (name === Modules.STORE) {
        return storeModule
      }
      if (name === Modules.SALES_CHANNEL) {
        return salesChannelModule
      }
      if (name === Modules.PRODUCT) {
        return productModule
      }
      if (name === Modules.STOCK_LOCATION) {
        return stockLocationModule
      }
      if (name === Modules.INVENTORY) {
        return inventoryModule
      }
      if (name === Modules.API_KEY) {
        return apiKeyModule
      }
      if (name === Modules.USER) {
        return userModule
      }
      if (name === Modules.RBAC && rbacModule) {
        return rbacModule
      }
      if (name === Modules.WORKFLOW_ENGINE) {
        return workflowEngineModule
      }
      if (name === Modules.AUTH) {
        return authModule
      }
      if (name === Modules.FILE) {
        return fileModule
      }
      if (name === Modules.CART) {
        return cartModule
      }
      if (name === Modules.REGION) {
        return regionModule
      }
      if (name === Modules.FULFILLMENT) {
        return fulfillmentModule
      }
      if (name === Modules.PRICING) {
        return pricingModule
      }
      if (name === Modules.ORDER) {
        return orderModule
      }

      return originalResolve(name, ...args)
    }) as MedusaContainer["resolve"]
  }

  private async loadCloudflareProjectEntryPoints(
    container: MedusaContainer,
    configModule: ConfigModule
  ): Promise<void> {
    const [{ WorkflowLoader }, { JobLoader }, { SubscriberLoader }] =
      await Promise.all([
      import("@medusajs/framework/workflows"),
      import("@medusajs/framework/jobs"),
      import("@medusajs/framework/subscribers"),
    ])
    const plugins = await getResolvedPlugins(this.cwd, configModule, true)
    const workflowSourcePaths = plugins.map((plugin) =>
      path.join(plugin.resolve, "workflows")
    )

    await new WorkflowLoader(workflowSourcePaths, container).load()
    const medusaSubscriberSourcePaths =
      await this.getCloudflareMedusaSubscriberSourcePaths()
    await new SubscriberLoader(
      medusaSubscriberSourcePaths.concat(
        plugins.map((plugin) => path.join(plugin.resolve, "subscribers"))
      ),
      undefined,
      container
    ).load()

    const workerMode = configModule.projectConfig.workerMode
    if (workerMode !== "worker" && workerMode !== "shared") {
      return
    }

    await this.installCloudflareProjectJobScheduler(container)

    const jobSourcePaths = plugins.map((plugin) =>
      path.join(plugin.resolve, "jobs")
    )
    await new JobLoader(jobSourcePaths, container).load()
  }

  private async getCloudflareMedusaSubscriberSourcePaths(): Promise<string[]> {
    const medusaPackageJsonPath = require.resolve("@medusajs/medusa/package.json")
    const medusaPackageRoot = path.dirname(medusaPackageJsonPath)
    const subscriberPaths = [
      path.join(medusaPackageRoot, "dist", "subscribers"),
      path.join(medusaPackageRoot, "src", "subscribers"),
    ]

    for (const subscriberPath of subscriberPaths) {
      try {
        await fs.access(subscriberPath)
        return [subscriberPath]
      } catch {
        // Try the next package layout.
      }
    }

    return []
  }

  private registerCloudflareTestWorkflowSchedulerAdapter(
    container: MedusaContainer
  ): void {
    container.register({
      workflowSchedulerAdapter: asValue(
        createCloudflareTestWorkflowSchedulerAdapter()
      ),
    })
  }

  private async installCloudflareProjectJobScheduler(
    container: MedusaContainer
  ): Promise<void> {
    const { WorkflowScheduler } = await import(
      "@medusajs/framework/orchestration"
    )
    const workflowEngine = container.resolve<IWorkflowEngineService>(
      Modules.WORKFLOW_ENGINE
    )
    const schedulerAdapter = createCloudflareTestWorkflowSchedulerAdapter()
    const scheduledJobs = new Map<string, TestScheduledJob>()

    const schedulerStorage: TestDistributedSchedulerStorage = {
      schedule: async (jobDefinition, schedulerOptions) => {
        const jobId =
          typeof jobDefinition === "string"
            ? jobDefinition
            : jobDefinition.jobId

        await schedulerStorage.remove(jobId)

        const scheduleNext = () => {
          const delay = getCloudflareTestScheduleDelay(
            schedulerAdapter,
            schedulerOptions
          )
          const timer = schedulerAdapter.setTimeout(async () => {
            const job = scheduledJobs.get(jobId)
            if (!job) {
              return
            }

            if (
              job.schedulerOptions.numberOfExecutions !== undefined &&
              job.schedulerOptions.numberOfExecutions <= job.numberOfExecutions
            ) {
              await schedulerStorage.remove(jobId)
              return
            }

            await workflowEngine.run(jobId, {
              logOnError: true,
              throwOnError: false,
            })

            const executions = job.numberOfExecutions + 1
            if (
              job.schedulerOptions.numberOfExecutions !== undefined &&
              job.schedulerOptions.numberOfExecutions <= executions
            ) {
              await schedulerStorage.remove(jobId)
              return
            }

            scheduledJobs.set(jobId, {
              ...job,
              numberOfExecutions: executions,
              timer: scheduleNext(),
            })
          }, delay)

          schedulerAdapter.unref(timer)
          return timer
        }

        scheduledJobs.set(jobId, {
          schedulerOptions,
          numberOfExecutions: 0,
          timer: scheduleNext(),
        })
      },
      remove: async (jobId) => {
        const job = scheduledJobs.get(jobId)
        if (!job) {
          return
        }

        schedulerAdapter.clearTimeout(job.timer)
        scheduledJobs.delete(jobId)
      },
      removeAll: async () => {
        for (const jobId of Array.from(scheduledJobs.keys())) {
          await schedulerStorage.remove(jobId)
        }
      },
    }

    WorkflowScheduler.setStorage(schedulerStorage)
  }

  private async syncCloudflareOrderUpdateCustomerFromNode(
    customerModule: CustomerModuleLike,
    port: number,
    config: HttpRequestConfigLike
  ): Promise<void> {
    if (config.method?.toLowerCase() !== "post" || !config.url) {
      return
    }

    const orderId = getAdminOrderIdFromRequestUrl(config.url)
    if (!orderId) {
      return
    }

    const body = parseJsonRecord(config.data)
    const email = getStringValue(body, "email")
    if (!email) {
      return
    }

    const order = this.cloudflareBridgedOrdersById.get(orderId)
    if (!order) {
      return
    }

    const existingOrderEmail = getStringValue(order, "email")
    const existingCustomerId = getStringValue(order, "customer_id")
    if (existingOrderEmail || existingCustomerId) {
      return
    }

    const existingCustomers = extractRecordRows(
      await customerModule.listCustomers({ email })
    )
    const customerRows =
      existingCustomers.length > 0
        ? existingCustomers
        : extractRecordRows(await customerModule.createCustomers({ email }))
    const customer = customerRows[0]
    if (!customer) {
      return
    }

    const customerId = getStringValue(customer, "id")
    if (!customerId) {
      return
    }

    if (existingCustomers.length > 0) {
      await this.syncCloudflareHttpProofState(port, "customers", {
        customers: existingCustomers,
      })
    }

    this.cloudflareBridgedOrdersById.set(orderId, {
      ...order,
      email,
      customer_id: customerId,
    })
  }

  private traceCloudflareHttpError(error: unknown): void {
    if (process.env.MEDUSA_TEST_RUNNER_TRACE !== "1") {
      return
    }

    const errorRecord = isRecord(error) ? error : undefined
    const response = getRecordValue(errorRecord, "response")
    const responseConfig = getRecordValue(response, "config")
    const errorConfig = getRecordValue(errorRecord, "config")
    const config = responseConfig ?? errorConfig
    const status = getNumberValue(response, "status")
    const method = getStringValue(config, "method") ?? ""
    const url = getStringValue(config, "url") ?? ""

    this.trace(
      `cloudflare-http-test-state-bridge:error:${status ?? "unknown"}:${method}:${url}:${formatTraceValue(response?.data)}`
    )
  }

  private async syncCloudflareDeletedUserAuthIdentity(
    authModule: AuthModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (response.config?.method?.toLowerCase() !== "delete") {
      return
    }

    const userId = getAdminUserIdFromRequestUrl(response.config.url)
    if (!userId) {
      return
    }

    this.cloudflareDeletedUserIds.add(userId)

    const authIdentityId = this.cloudflareAuthIdentityIdByUserId.get(userId)
    if (!authIdentityId) {
      return
    }

    const authIdentity = await authModule.retrieveAuthIdentity(authIdentityId)
    if (!isRecord(authIdentity)) {
      return
    }

    const appMetadata = getRecordValue(authIdentity, "app_metadata") ?? {}
    const { user_id: _userId, user: _user, ...nextAppMetadata } = appMetadata

    await authModule.updateAuthIdentities({
      id: authIdentityId,
      app_metadata: nextAppMetadata,
    })
    this.cloudflareAuthIdentityIdByUserId.delete(userId)
  }

  private async syncCloudflareRbacEntities(
    rbacModule: RbacModuleLike,
    port: number,
    response: HttpResponseLike
  ): Promise<void> {
    const data = isRecord(response.data) ? response.data : undefined

    if (isHttpResponseEndpoint(response, "post", "/admin/rbac/roles")) {
      const role = getRecordValue(data, "role")
      if (!role) {
        return
      }

      const synced = await syncCloudflareRbacRoleFromWorker(rbacModule, role)
      if (synced) {
        await this.syncCloudflareHttpProofState(port, "rbac-roles", {
          roles: [role],
        })
      }
      return
    }

    if (isHttpResponseEndpoint(response, "post", "/admin/rbac/policies")) {
      const policy = getRecordValue(data, "policy")
      if (!policy) {
        return
      }

      const synced = await syncCloudflareRbacPolicyFromWorker(
        rbacModule,
        policy
      )
      if (synced) {
        await this.syncCloudflareHttpProofState(port, "rbac-policies", {
          policies: [policy],
        })
      }
    }
  }

  private async syncCloudflareCreatedCart(
    customerModule: CustomerModuleLike,
    cartModule: CartModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      !isHttpResponseEndpoint(response, "post", "/store/carts")
    ) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const cart = getRecordValue(data, "cart")
    const cartId = getStringValue(cart, "id")
    if (!cart || !cartId) {
      return
    }

    try {
      await cartModule.retrieveCart(cartId)
      return
    } catch {
      // Missing Node-side cart is expected for Worker-created cart state.
    }

    await this.syncCloudflareCartCustomer(customerModule, cart)
    await cartModule.createCarts(createNodeCartInputFromCloudflareCart(cart))
  }

  private async syncCloudflareUpdatedCart(
    customerModule: CustomerModuleLike,
    cartModule: CartModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/store\/carts\/([^/]+)$/
    )
    const cartId = match?.[1]
    if (!cartId) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const cart = getRecordValue(data, "cart")
    if (!cart) {
      return
    }

    await this.syncCloudflareCartCustomer(customerModule, cart)
    await cartModule.updateCarts(
      cartId,
      stripUndefinedRecordValues({
        email: getStringValue(cart, "email"),
        currency_code: getStringValue(cart, "currency_code"),
        region_id: getStringValue(cart, "region_id"),
        customer_id: getStringValue(cart, "customer_id"),
        sales_channel_id: getStringValue(cart, "sales_channel_id"),
        locale: getStringValue(cart, "locale"),
        shipping_address: createNodeCartAddressInput(
          getRecordValue(cart, "shipping_address")
        ),
        billing_address: createNodeCartAddressInput(
          getRecordValue(cart, "billing_address")
        ),
        metadata: getRecordValue(cart, "metadata"),
      })
    )
  }

  private async syncCloudflareCartCustomer(
    customerModule: CustomerModuleLike,
    cart: Record<string, unknown>
  ): Promise<void> {
    const customer = getRecordValue(cart, "customer")
    const customerId =
      getStringValue(cart, "customer_id") ?? getStringValue(customer, "id")
    if (!customerId) {
      return
    }

    try {
      const existing = await customerModule.retrieveCustomer(customerId)
      if (isRecord(existing)) {
        cart.customer = createCloudflareCartCustomerProofRow(existing)
      }
      return
    } catch {
      // Worker-created guest customers are mirrored into Node on demand.
    }

    const created = await customerModule.createCustomers(
      stripUndefinedRecordValues({
        id: customerId,
        email:
          getStringValue(customer, "email") ?? getStringValue(cart, "email"),
        first_name: getStringValue(customer, "first_name"),
        last_name: getStringValue(customer, "last_name"),
        has_account: getBooleanValue(customer, "has_account") ?? false,
        metadata: getRecordValue(customer, "metadata"),
      })
    )
    const createdRows = extractRecordRows(created)
    const createdCustomer = createdRows[0]
    if (createdCustomer) {
      cart.customer = createCloudflareCartCustomerProofRow(createdCustomer)
    }
  }

  private async syncCloudflareWorkflowStepFailure(
    workflowEngineModule: IWorkflowEngineService,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/workflows-executions\/([^/]+)\/steps\/failure$/
    )
    const workflowId = match?.[1] ? decodeURIComponent(match[1]) : undefined
    const body = parseJsonRecord(response.config?.data)
    const transactionId = getStringValue(body, "transaction_id")
    const stepId = getStringValue(body, "step_id")

    if (!workflowId || !transactionId || !stepId) {
      return
    }

    this.trace(
      `cloudflare-http-test-state-bridge:workflow-step-failure:${workflowId}:${transactionId}:${stepId}`
    )

    await workflowEngineModule.setStepFailure({
      idempotencyKey: {
        action: "invoke",
        workflowId,
        transactionId,
        stepId,
      },
      stepResponse: undefined,
      options: {
        throwOnError: false,
        logOnError: true,
      },
    })
  }

  private async syncCloudflareTranslationSettings(
    translationModule: ITranslationModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      !isHttpResponseEndpoint(
        response,
        "post",
        "/admin/translations/settings/batch"
      )
    ) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const created = getRecordArrayValue(data, "created").flatMap(
      createNodeTranslationSettingsCreateInput
    )
    const updated = getRecordArrayValue(data, "updated").flatMap(
      createNodeTranslationSettingsUpdateInput
    )
    const deleted = getRecordArrayValue(
      getRecordValue(data, "deleted"),
      "ids"
    ).flatMap((id): string[] => {
      return typeof id === "string" ? [id] : []
    })

    if (created.length > 0) {
      await translationModule.createTranslationSettings(created)
    }

    if (updated.length > 0) {
      await translationModule.updateTranslationSettings(updated)
    }

    if (deleted.length > 0) {
      await translationModule.deleteTranslationSettings(deleted)
    }
  }

  private async syncCloudflareTranslations(
    translationModule: ITranslationModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/translations/batch")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const created = getRecordArrayValue(data, "created").flatMap(
      createNodeTranslationCreateInput
    )
    const updated = getRecordArrayValue(data, "updated").flatMap(
      createNodeTranslationUpdateInput
    )
    const deleted = getRecordArrayValue(
      getRecordValue(data, "deleted"),
      "ids"
    ).flatMap((id): string[] => {
      return typeof id === "string" ? [id] : []
    })

    if (created.length > 0) {
      await translationModule.createTranslations(created)
    }

    if (updated.length > 0) {
      await translationModule.updateTranslations(updated)
    }

    if (deleted.length > 0) {
      await translationModule.deleteTranslations(deleted)
    }
  }

  private async syncCloudflareCreatedRegion(
    regionModule: RegionModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/regions")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const region = getRecordValue(data, "region")
    if (!region || !getStringValue(region, "id")) {
      return
    }

    try {
      await regionModule.createRegions(createNodeRegionInput(region))
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("already exists")) {
        return
      }

      throw error
    }
  }

  private async syncCloudflareDeletedRegion(
    regionModule: RegionModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/regions\/([^/]+)$/
    )

    if (!match || match.length < 2) {
      return
    }

    const regionId = decodeURIComponent(match[1])
    await regionModule.softDeleteRegions([regionId])
    this.trace(
      `cloudflare-http-test-state-bridge:region-deleted:${regionId}`
    )
  }

  private async syncCloudflareTaxResponse(
    taxModule: TaxModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const data = isRecord(response.data) ? response.data : undefined

    if (isHttpResponseEndpoint(response, "post", "/admin/tax-regions")) {
      const taxRegion = getRecordValue(data, "tax_region")
      if (taxRegion) {
        await taxModule.createTaxRegions(createNodeTaxRegionInput(taxRegion))
      }
      return
    }

    const taxRegionDeleteMatch = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/tax-regions\/([^/]+)$/
    )
    const taxRegionDeleteId = taxRegionDeleteMatch?.[1]
    if (taxRegionDeleteId) {
      const decodedId = decodeURIComponent(taxRegionDeleteId)
      if (taxModule.softDeleteTaxRegions) {
        await taxModule.softDeleteTaxRegions(decodedId)
      } else {
        await taxModule.deleteTaxRegions(decodedId)
      }
      return
    }

    if (isHttpResponseEndpoint(response, "post", "/admin/tax-rates")) {
      const taxRate = getRecordValue(data, "tax_rate")
      if (taxRate) {
        await taxModule.createTaxRates(createNodeTaxRateInput(taxRate))
      }
      return
    }

    const taxRateRuleDeleteMatch = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/tax-rates\/([^/]+)\/rules\/([^/]+)$/
    )
    const taxRateRuleDeleteId = taxRateRuleDeleteMatch?.[2]
    if (taxRateRuleDeleteId) {
      const decodedId = decodeURIComponent(taxRateRuleDeleteId)
      if (taxModule.softDeleteTaxRateRules) {
        await taxModule.softDeleteTaxRateRules(decodedId)
      } else {
        await taxModule.deleteTaxRateRules(decodedId)
      }
      return
    }

    const taxRateRuleCreateMatch = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/tax-rates\/([^/]+)\/rules$/
    )
    const taxRateRuleCreateId = taxRateRuleCreateMatch?.[1]
    if (taxRateRuleCreateId) {
      const taxRate = getRecordValue(data, "tax_rate")
      const rule = findNewTaxRateRuleFromResponse(
        taxRate,
        decodeURIComponent(taxRateRuleCreateId),
        response.config?.data
      )
      if (rule) {
        await taxModule.createTaxRateRules(rule)
      }
      return
    }

    const taxRateUpdateMatch = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/tax-rates\/([^/]+)$/
    )
    const taxRateUpdateId = taxRateUpdateMatch?.[1]
    if (taxRateUpdateId) {
      const taxRate = getRecordValue(data, "tax_rate")
      if (taxRate) {
        await taxModule.updateTaxRates(
          decodeURIComponent(taxRateUpdateId),
          createNodeTaxRateUpdateInput(taxRate)
        )
      }
      return
    }

    const taxRateDeleteMatch = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/tax-rates\/([^/]+)$/
    )
    const taxRateDeleteId = taxRateDeleteMatch?.[1]
    if (taxRateDeleteId) {
      const decodedId = decodeURIComponent(taxRateDeleteId)
      if (taxModule.softDeleteTaxRates) {
        await taxModule.softDeleteTaxRates(decodedId)
      } else {
        await taxModule.deleteTaxRates(decodedId)
      }
    }
  }

  private async syncCloudflareCreatedSalesChannel(
    salesChannelModule: SalesChannelModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/sales-channels")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const salesChannel = getRecordValue(data, "sales_channel")
    if (!salesChannel || !getStringValue(salesChannel, "id")) {
      return
    }

    await salesChannelModule.createSalesChannels(salesChannel)
  }

  private async syncCloudflareCreatedStockLocation(
    stockLocationModule: StockLocationModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/stock-locations")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const stockLocation = getRecordValue(data, "stock_location")
    if (!stockLocation || !getStringValue(stockLocation, "id")) {
      return
    }

    await stockLocationModule.createStockLocations(stockLocation)
  }

  private async syncCloudflareDeletedStockLocation(
    stockLocationModule: StockLocationModuleLike,
    fulfillmentModule: FulfillmentModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/stock-locations\/([^/]+)$/
    )
    const stockLocationId = match?.[1]
    if (!stockLocationId) {
      return
    }

    this.trace(
      `cloudflare-http-test-state-bridge:stock-location-delete:${stockLocationId}`
    )
    await stockLocationModule.deleteStockLocations(stockLocationId)

    const fulfillmentSetIds =
      this.cloudflareFulfillmentSetIdsByStockLocationId.get(stockLocationId) ??
      []
    this.trace(
      `cloudflare-http-test-state-bridge:stock-location-delete-fulfillment-sets:${fulfillmentSetIds.length}`
    )
    if (fulfillmentSetIds.length > 0) {
      await fulfillmentModule.deleteFulfillmentSets(fulfillmentSetIds)
      this.cloudflareFulfillmentSetIdsByStockLocationId.delete(stockLocationId)
    }
  }

  private async syncCloudflareCreatedShippingProfile(
    fulfillmentModule: FulfillmentModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/shipping-profiles")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const shippingProfile = getRecordValue(data, "shipping_profile")
    if (!shippingProfile || !getStringValue(shippingProfile, "id")) {
      return
    }

    await fulfillmentModule.createShippingProfiles(
      createNodeShippingProfileInput(shippingProfile)
    )
  }

  private async syncCloudflareCreatedLocationFulfillmentSets(
    fulfillmentModule: FulfillmentModuleLike,
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/stock-locations\/([^/]+)\/fulfillment-sets$/
    )
    const stockLocationId = match?.[1]
    if (!stockLocationId) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const stockLocation = getRecordValue(data, "stock_location")
    const fulfillmentSets = getRecordArrayValue(
      stockLocation,
      "fulfillment_sets"
    )
    if (fulfillmentSets.length === 0) {
      return
    }

    this.cloudflareFulfillmentSetIdsByStockLocationId.set(
      stockLocationId,
      fulfillmentSets.flatMap((fulfillmentSet): string[] => {
        const fulfillmentSetId = getStringValue(fulfillmentSet, "id")
        return fulfillmentSetId ? [fulfillmentSetId] : []
      })
    )
    this.trace(
      `cloudflare-http-test-state-bridge:location-fulfillment-sets:${stockLocationId}:${fulfillmentSets.length}`
    )

    await fulfillmentModule.createFulfillmentSets(
      fulfillmentSets.map(createNodeFulfillmentSetInput)
    )
    await remoteLink.create(
      fulfillmentSets.flatMap((fulfillmentSet): Array<Record<string, unknown>> => {
        const fulfillmentSetId = getStringValue(fulfillmentSet, "id")
        if (!fulfillmentSetId) {
          return []
        }

        return [
          {
            [Modules.STOCK_LOCATION]: {
              stock_location_id: stockLocationId,
            },
            [Modules.FULFILLMENT]: {
              fulfillment_set_id: fulfillmentSetId,
            },
          },
        ]
      })
    )
  }

  private async syncCloudflareCreatedServiceZones(
    fulfillmentModule: FulfillmentModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/fulfillment-sets\/([^/]+)\/service-zones$/
    )
    const fulfillmentSetId = match?.[1]
    if (!fulfillmentSetId) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const fulfillmentSet = getRecordValue(data, "fulfillment_set")
    const serviceZones = getRecordArrayValue(fulfillmentSet, "service_zones")
    if (serviceZones.length === 0) {
      return
    }

    await fulfillmentModule.createServiceZones(
      serviceZones.map((serviceZone) =>
        createNodeServiceZoneInput(serviceZone, fulfillmentSetId)
      )
    )
  }

  private async syncCloudflareCreatedShippingOption(
    fulfillmentModule: FulfillmentModuleLike,
    pricingModule: PricingModuleLike,
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/shipping-options")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const shippingOption = getRecordValue(data, "shipping_option")
    if (!shippingOption || !getStringValue(shippingOption, "id")) {
      return
    }

    const shippingOptionId = getStringValue(shippingOption, "id")
    if (!shippingOptionId) {
      return
    }

    const requestBody = parseJsonRecord(response.config?.data)
    await fulfillmentModule.createShippingOptions(
      createNodeShippingOptionInput(shippingOption, requestBody)
    )

    const priceSetInput = createNodeShippingOptionPriceSetInput(requestBody)
    if (priceSetInput.prices.length === 0) {
      return
    }

    const priceSets = extractRecordRows(
      await pricingModule.createPriceSets(priceSetInput)
    )
    const priceSetId = getStringValue(priceSets[0], "id")
    if (!priceSetId) {
      return
    }

    await remoteLink.create({
      [Modules.FULFILLMENT]: {
        shipping_option_id: shippingOptionId,
      },
      [Modules.PRICING]: {
        price_set_id: priceSetId,
      },
    })
  }

  private async syncCloudflareCreatedPricePreference(
    pricingModule: PricingModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/price-preferences")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const pricePreference = getRecordValue(data, "price_preference")
    const requestBody = parseJsonRecord(response.config?.data)

    await pricingModule.createPricePreferences(
      stripUndefinedRecordValues({
        ...(requestBody ?? {}),
        id: getStringValue(pricePreference, "id"),
        attribute:
          getStringValue(pricePreference, "attribute") ??
          getStringValue(requestBody, "attribute"),
        value:
          getStringValue(pricePreference, "value") ??
          getStringValue(requestBody, "value"),
        is_tax_inclusive:
          getBooleanValue(pricePreference, "is_tax_inclusive") ??
          getBooleanValue(requestBody, "is_tax_inclusive"),
      })
    )
  }

  private async syncCloudflareFulfillmentForAction(
    fulfillmentModule: FulfillmentModuleLike,
    port: number,
    config: HttpRequestConfigLike
  ): Promise<void> {
    const match = matchHttpRequestPath(
      config,
      "post",
      /^\/admin\/fulfillments\/([^/]+)\/(?:cancel|shipment)$/
    )
    const fulfillmentId = match?.[1]
    if (!fulfillmentId) {
      return
    }

    try {
      const fulfillment = await fulfillmentModule.retrieveFulfillment(
        fulfillmentId
      )
      await this.syncCloudflareHttpProofState(port, "fulfillments", {
        fulfillments: [fulfillment],
      })
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:fulfillment-action-sync-skip:${fulfillmentId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareFulfillmentResponse(
    fulfillmentModule: FulfillmentModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const data = isRecord(response.data) ? response.data : undefined
    const fulfillment = getRecordValue(data, "fulfillment")
    const fulfillmentId = fulfillment
      ? getStringValue(fulfillment, "id")
      : undefined
    if (!fulfillment || !fulfillmentId) {
      return
    }

    if (isHttpResponseEndpoint(response, "post", "/admin/fulfillments")) {
      const requestBody = parseJsonRecord(response.config?.data) ?? {}
      await fulfillmentModule.createFulfillment({
        ...requestBody,
        id: fulfillmentId,
      })
      return
    }

    if (
      matchHttpResponsePath(
        response,
        "post",
        /^\/admin\/fulfillments\/[^/]+\/cancel$/
      )
    ) {
      await fulfillmentModule.cancelFulfillment(fulfillmentId)
      return
    }

    if (
      matchHttpResponsePath(
        response,
        "post",
        /^\/admin\/fulfillments\/[^/]+\/shipment$/
      )
    ) {
      const shippedAt = getStringValue(fulfillment, "shipped_at")
      const labels = getRecordArrayValue(fulfillment, "labels")
      await fulfillmentModule.updateFulfillment(fulfillmentId, {
        shipped_at: shippedAt ? new Date(shippedAt) : new Date(),
        marked_shipped_by: getStringValue(fulfillment, "marked_shipped_by"),
        labels,
      })
    }
  }

  private async syncCloudflareCreatedPriceList(
    pricingModule: PricingModuleLike,
    response: HttpResponseLike,
    priceSetIdByVariantId: Map<string, string>
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/price-lists")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const priceList = getRecordValue(data, "price_list")
    if (!priceList || !getStringValue(priceList, "id")) {
      return
    }

    const input = createNodePriceListInput(priceList, priceSetIdByVariantId)
    if (!input) {
      return
    }

    await pricingModule.createPriceLists([input])
  }

  private async syncCloudflareDeletedPriceList(
    pricingModule: PricingModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/price-lists\/([^/]+)$/
    )
    const priceListId = match?.[1]
    if (!priceListId) {
      return
    }

    try {
      await pricingModule.deletePriceLists([priceListId])
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:price-list-delete:skip:${priceListId}:${error instanceof Error ? error.message : "unknown error"}`
      )
    }
  }

  private async syncCloudflareCreatedInventoryItem(
    inventoryModule: InventoryModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/inventory-items")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const inventoryItem = getRecordValue(data, "inventory_item")
    const inventoryItemId = getStringValue(inventoryItem, "id")
    if (!inventoryItemId) {
      return
    }

    let inventoryItemExists = false
    try {
      await inventoryModule.createInventoryItems(
        createNodeInventoryItemInputFromCloudflareResponse(
          inventoryItemId,
          response.data
        )
      )
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-item-response:created:${inventoryItemId}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("already exists") || message.includes("duplicate")) {
        this.trace(
          `cloudflare-http-test-state-bridge:inventory-item-response:exists:${inventoryItemId}`
        )
        inventoryItemExists = true
      } else {
        throw error
      }
    }

    const locationLevels = createNodeInventoryLevelInputsFromCloudflareResponse(
      inventoryItemId,
      response
    )
    if (locationLevels.length === 0) {
      return
    }

    try {
      await inventoryModule.createInventoryLevels(locationLevels)
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-item-response:levels:${inventoryItemId}:${locationLevels.length}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (
        message.includes("already exists") ||
        (inventoryItemExists && message.includes("duplicate"))
      ) {
        return
      }

      throw error
    }
  }

  private async syncCloudflareCreatedVariantInventoryItemLink(
    remoteLink: RemoteLinkLike,
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/products\/([^/]+)\/variants\/([^/]+)\/inventory-items\/?$/
    )
    const variantId = match?.[2]
    if (!variantId) {
      return
    }

    const requestBody = parseJsonRecord(response.config?.data)
    const inventoryItemId = getStringValue(requestBody, "inventory_item_id")
    if (!inventoryItemId) {
      return
    }

    const requiredQuantity = getNumberValue(requestBody, "required_quantity") ?? 1
    const linkRows = extractNestedRecordRows(
      await remoteLink.create({
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
        data: { required_quantity: requiredQuantity },
      })
    )
    const indexLinks = createVariantInventoryItemIndexLinks(
      linkRows,
      variantId,
      inventoryItemId
    )

    this.trace(
      `cloudflare-http-test-state-bridge:variant-inventory-link-response:${variantId}:${inventoryItemId}:${indexLinks.length}`
    )

    if (indexLinks.length > 0) {
      await eventBusModule.emit({
        name: "LinkProductVariantInventoryItem.attached",
        data: indexLinks,
      })
    }
  }

  private async syncCloudflareCreatedInventoryLevel(
    inventoryModule: InventoryModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/inventory-items\/([^/]+)\/location-levels\/?$/
    )
    const inventoryItemId = match?.[1]
    if (!inventoryItemId) {
      return
    }

    const requestBody = parseJsonRecord(response.config?.data)
    const locationId = getStringValue(requestBody, "location_id")
    if (!locationId) {
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-level-response:skip-location:${inventoryItemId}`
      )
      return
    }

    this.trace(
      `cloudflare-http-test-state-bridge:inventory-level-response:${inventoryItemId}:${locationId}`
    )
    const inventoryLevelInput = {
      inventory_item_id: inventoryItemId,
      location_id: locationId,
      stocked_quantity: getNumberValue(requestBody, "stocked_quantity") ?? 0,
      reserved_quantity: getNumberValue(requestBody, "reserved_quantity") ?? 0,
      incoming_quantity: getNumberValue(requestBody, "incoming_quantity") ?? 0,
      metadata: getRecordValue(requestBody, "metadata") ?? null,
    }

    try {
      await inventoryModule.retrieveInventoryLevelByItemAndLocation(
        inventoryItemId,
        locationId
      )
      this.trace(
        `cloudflare-http-test-state-bridge:inventory-level-response:exists:${inventoryItemId}:${locationId}`
      )
      return
    } catch {
      // Missing inventory level is expected before the bridge mirrors Worker state.
    }

    try {
      await inventoryModule.createInventoryLevels(inventoryLevelInput)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("already exists")) {
        this.trace(
          `cloudflare-http-test-state-bridge:inventory-level-response:exists-after-create:${inventoryItemId}:${locationId}`
        )
        return
      }

      if (!message.includes("relationship inventory_item_id")) {
        throw error
      }

      await inventoryModule.createInventoryItems(
        createNodeInventoryItemInputFromCloudflareResponse(
          inventoryItemId,
          response.data
        )
      )
      await inventoryModule.createInventoryLevels(inventoryLevelInput)
    }

    this.trace(
      `cloudflare-http-test-state-bridge:inventory-level-response:created:${inventoryItemId}:${locationId}`
    )
  }

  private async syncCloudflareCreatedReservation(
    inventoryModule: InventoryModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/reservations")) {
      return
    }

    const input = createNodeReservationItemInputFromCloudflareResponse(response)
    const reservationId = getStringValue(input, "id")
    if (!reservationId) {
      return
    }

    try {
      await inventoryModule.createReservationItems(input)
      this.trace(
        `cloudflare-http-test-state-bridge:reservation-response:created:${reservationId}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.includes("already exists") || message.includes("duplicate")) {
        this.trace(
          `cloudflare-http-test-state-bridge:reservation-response:exists:${reservationId}`
        )
        return
      }

      throw error
    }
  }

  private async syncCloudflareLocationFulfillmentProviders(
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/stock-locations\/([^/]+)\/fulfillment-providers$/
    )
    const stockLocationId = match?.[1]
    if (!stockLocationId) {
      return
    }

    const body = parseJsonRecord(response.config?.data)
    const providerIds = getStringArrayValue(body, "add")
    if (providerIds.length === 0) {
      return
    }

    await remoteLink.create(
      providerIds.map((providerId) => ({
        [Modules.STOCK_LOCATION]: {
          stock_location_id: stockLocationId,
        },
        [Modules.FULFILLMENT]: {
          fulfillment_provider_id: providerId,
        },
      }))
    )
  }

  private async syncCloudflareLocationSalesChannels(
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/stock-locations\/([^/]+)\/sales-channels$/
    )
    const stockLocationId = match?.[1]
    if (!stockLocationId) {
      return
    }

    const body = parseJsonRecord(response.config?.data)
    const salesChannelIds = getStringArrayValue(body, "add")
    if (salesChannelIds.length === 0) {
      return
    }

    await remoteLink.create(
      salesChannelIds.map((salesChannelId) => ({
        [Modules.SALES_CHANNEL]: {
          sales_channel_id: salesChannelId,
        },
        [Modules.STOCK_LOCATION]: {
          stock_location_id: stockLocationId,
        },
      }))
    )
  }

  private async syncCloudflareRegisteredAuthIdentity(
    authModule: AuthModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.includes("/auth/") ||
      !response.config.url.includes("/emailpass/register")
    ) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const token = getStringValue(data, "token")
    const payload = token ? decodeJwtPayload(token) : undefined
    const authIdentityId = getStringValue(payload, "auth_identity_id")
    const userMetadata = getRecordValue(payload, "user_metadata") ?? {}
    const email = getStringValue(userMetadata, "email")

    if (!authIdentityId || !email) {
      return
    }

    try {
      await authModule.retrieveAuthIdentity(authIdentityId)
      return
    } catch {
      // Missing Node-side identity is expected for Worker-created auth state.
    }

    await authModule.createAuthIdentities({
      id: authIdentityId,
      app_metadata: {},
      provider_identities: [
        {
          provider: "emailpass",
          entity_id: email,
          provider_metadata: {},
          user_metadata: {
            email,
          },
        },
      ],
    })
  }

  private async syncCloudflareCreatedStoreCustomer(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/store/customers")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const customer = getRecordValue(data, "customer")
    const customerId = getStringValue(customer, "id")
    const email = getStringValue(customer, "email")

    this.trace(
      `cloudflare-http-test-state-bridge:store-customer-response:${customerId ?? ""}:${email ?? ""}`
    )

    if (!customerId || !email) {
      return
    }

    try {
      await customerModule.retrieveCustomer(customerId)
      return
    } catch {
      // Missing Node-side customer is expected for Worker-created Store state.
    }

    await customerModule.createCustomers(
      stripUndefinedRecordValues({
        id: customerId,
        email,
        first_name: getStringValue(customer, "first_name"),
        last_name: getStringValue(customer, "last_name"),
        phone: getStringValue(customer, "phone"),
        metadata: getRecordValue(customer, "metadata") ?? {},
      })
    )
    this.trace(
      `cloudflare-http-test-state-bridge:store-customer-created:${customerId}`
    )
  }

  private async syncCloudflareCreatedAdminCustomer(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/customers")) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const customer = getRecordValue(data, "customer")
    const customerId = getStringValue(customer, "id")
    const email = getStringValue(customer, "email")

    this.trace(
      `cloudflare-http-test-state-bridge:admin-customer-response:${customerId ?? ""}:${email ?? ""}`
    )

    if (!customerId || !email) {
      return
    }

    try {
      await customerModule.retrieveCustomer(customerId)
      return
    } catch {
      // Missing Node-side customer is expected for Worker-created Admin state.
    }

    await customerModule.createCustomers(
      stripUndefinedRecordValues({
        id: customerId,
        email,
        first_name: getStringValue(customer, "first_name"),
        last_name: getStringValue(customer, "last_name"),
        phone: getStringValue(customer, "phone"),
        metadata: getRecordValue(customer, "metadata") ?? {},
      })
    )
    this.trace(
      `cloudflare-http-test-state-bridge:admin-customer-created:${customerId}`
    )
  }

  private async retrieveCloudflareOrderProofRow(
    retrieveOrder: OrderModuleLike["retrieveOrder"],
    order: Record<string, unknown>,
    sharedContext?: unknown
  ): Promise<Record<string, unknown>> {
    const orderId = getStringValue(order, "id")
    if (!orderId) {
      return order
    }

    try {
      const retrieved = await retrieveOrder(
        orderId,
        getCloudflareOrderProofRetrieveConfig(),
        sharedContext
      )
      if (!isRecord(retrieved)) {
        return order
      }

      return {
        ...retrieved,
        payment_collections: getRecordArrayValue(
          retrieved,
          "payment_collections"
        ),
      }
    } catch {
      return order
    }
  }

  private async syncCloudflareDeletedStoreCustomerAddress(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/store\/customers\/me\/addresses\/([^/]+)$/
    )

    if (!match || match.length < 2) {
      return
    }

    const addressId = decodeURIComponent(match[1])
    try {
      await customerModule.deleteCustomerAddresses(addressId)
      this.trace(
        `cloudflare-http-test-state-bridge:store-customer-address-deleted:${addressId}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:store-customer-address-delete-skip:${addressId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareDeletedAdminCustomerAddress(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/customers\/[^/]+\/addresses\/([^/]+)$/
    )

    if (!match || match.length < 2) {
      return
    }

    const addressId = decodeURIComponent(match[1])
    try {
      await customerModule.deleteCustomerAddresses(addressId)
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-address-deleted:${addressId}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-address-delete-skip:${addressId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareDeletedAdminCustomer(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/customers\/([^/]+)$/
    )

    if (!match || match.length < 2) {
      return
    }

    const customerId = decodeURIComponent(match[1])
    try {
      await customerModule.softDeleteCustomers([customerId])
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-deleted:${customerId}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-delete-skip:${customerId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareDeletedAdminCustomerGroup(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "delete",
      /^\/admin\/customer-groups\/([^/]+)$/
    )

    if (!match || match.length < 2) {
      return
    }

    const customerGroupId = decodeURIComponent(match[1])
    try {
      await customerModule.softDeleteCustomerGroups([customerGroupId])
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-deleted:${customerGroupId}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-delete-skip:${customerGroupId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareAdminCustomerGroupCustomerAdd(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/customer-groups\/([^/]+)\/customers$/
    )

    if (!match || match.length < 2) {
      return
    }

    const customerGroupId = decodeURIComponent(match[1])
    const requestBody = parseJsonRecord(response.config?.data)
    if (!requestBody) {
      return
    }

    const customerIds = getStringArrayValue(requestBody, "add")
    if (customerIds.length === 0) {
      return
    }

    try {
      await customerModule.addCustomerToGroup(
        customerIds.map((customerId) => ({
          customer_id: customerId,
          customer_group_id: customerGroupId,
        }))
      )
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-customers-added:${customerGroupId}:${customerIds.length}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-customers-add-skip:${customerGroupId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareAdminCustomerGroupCustomerRemove(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/customer-groups\/([^/]+)\/customers$/
    )

    if (!match || match.length < 2) {
      return
    }

    const customerGroupId = decodeURIComponent(match[1])
    const requestBody = parseJsonRecord(response.config?.data)
    if (!requestBody) {
      return
    }

    const customerIds = getStringArrayValue(requestBody, "remove")
    if (customerIds.length === 0) {
      return
    }

    try {
      await customerModule.removeCustomerFromGroup(
        customerIds.map((customerId) => ({
          customer_id: customerId,
          customer_group_id: customerGroupId,
        }))
      )
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-customers-removed:${customerGroupId}:${customerIds.length}`
      )
    } catch (error) {
      this.trace(
        `cloudflare-http-test-state-bridge:admin-customer-group-customers-remove-skip:${customerGroupId}:${formatTraceValue(error)}`
      )
    }
  }

  private async syncCloudflareCreatedAdminCustomerAddress(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/customers\/([^/]+)\/addresses$/
    )

    if (!match || match.length < 2) {
      return
    }

    const customerId = decodeURIComponent(match[1])
    const requestBody = parseJsonRecord(response.config?.data)
    if (!requestBody) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const customer = getRecordValue(data, "customer")
    const responseAddress = getRecordArrayValue(customer, "addresses").find(
      (address) => isCloudflareAdminCustomerAddressMatch(address, requestBody)
    )
    const addressSource = responseAddress ?? requestBody
    const addressId = getStringValue(addressSource, "id")

    if (addressId) {
      const existingAddresses = extractRecordRows(
        await customerModule.listCustomerAddresses({ id: addressId })
      )
      if (existingAddresses.length > 0) {
        return
      }
    }

    if (getBooleanValue(requestBody, "is_default_shipping") === true) {
      await this.unsetCloudflareNodeCustomerAddressDefault(
        customerModule,
        customerId,
        "is_default_shipping"
      )
    }

    if (getBooleanValue(requestBody, "is_default_billing") === true) {
      await this.unsetCloudflareNodeCustomerAddressDefault(
        customerModule,
        customerId,
        "is_default_billing"
      )
    }

    await customerModule.createCustomerAddresses(
      stripUndefinedRecordValues({
        id: addressId,
        customer_id: customerId,
        address_name:
          getStringValue(addressSource, "address_name") ??
          getStringValue(requestBody, "address_name"),
        is_default_shipping:
          getBooleanValue(addressSource, "is_default_shipping") ??
          getBooleanValue(requestBody, "is_default_shipping"),
        is_default_billing:
          getBooleanValue(addressSource, "is_default_billing") ??
          getBooleanValue(requestBody, "is_default_billing"),
        company:
          getStringValue(addressSource, "company") ??
          getStringValue(requestBody, "company"),
        first_name:
          getStringValue(addressSource, "first_name") ??
          getStringValue(requestBody, "first_name"),
        last_name:
          getStringValue(addressSource, "last_name") ??
          getStringValue(requestBody, "last_name"),
        address_1:
          getStringValue(addressSource, "address_1") ??
          getStringValue(requestBody, "address_1"),
        address_2:
          getStringValue(addressSource, "address_2") ??
          getStringValue(requestBody, "address_2"),
        city:
          getStringValue(addressSource, "city") ??
          getStringValue(requestBody, "city"),
        country_code:
          getStringValue(addressSource, "country_code") ??
          getStringValue(requestBody, "country_code"),
        province:
          getStringValue(addressSource, "province") ??
          getStringValue(requestBody, "province"),
        postal_code:
          getStringValue(addressSource, "postal_code") ??
          getStringValue(requestBody, "postal_code"),
        phone:
          getStringValue(addressSource, "phone") ??
          getStringValue(requestBody, "phone"),
        metadata:
          getRecordValue(addressSource, "metadata") ??
          getRecordValue(requestBody, "metadata") ??
          {},
      })
    )
    this.trace(
      `cloudflare-http-test-state-bridge:admin-customer-address-created:${customerId}:${addressId ?? ""}`
    )
  }

  private async syncCloudflareUpdatedAdminCustomerAddress(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    const match = matchHttpResponsePath(
      response,
      "post",
      /^\/admin\/customers\/([^/]+)\/addresses\/([^/]+)$/
    )

    if (!match || match.length < 3) {
      return
    }

    const customerId = decodeURIComponent(match[1])
    const addressId = decodeURIComponent(match[2])
    const requestBody = parseJsonRecord(response.config?.data)
    if (!requestBody) {
      return
    }

    if (getBooleanValue(requestBody, "is_default_shipping") === true) {
      await this.unsetCloudflareNodeCustomerAddressDefault(
        customerModule,
        customerId,
        "is_default_shipping"
      )
    }

    if (getBooleanValue(requestBody, "is_default_billing") === true) {
      await this.unsetCloudflareNodeCustomerAddressDefault(
        customerModule,
        customerId,
        "is_default_billing"
      )
    }

    await customerModule.updateCustomerAddresses(
      { id: addressId, customer_id: customerId },
      stripUndefinedRecordValues({
        address_name: getStringValue(requestBody, "address_name"),
        is_default_shipping: getBooleanValue(
          requestBody,
          "is_default_shipping"
        ),
        is_default_billing: getBooleanValue(requestBody, "is_default_billing"),
        company: getStringValue(requestBody, "company"),
        first_name: getStringValue(requestBody, "first_name"),
        last_name: getStringValue(requestBody, "last_name"),
        address_1: getStringValue(requestBody, "address_1"),
        address_2: getStringValue(requestBody, "address_2"),
        city: getStringValue(requestBody, "city"),
        country_code: getStringValue(requestBody, "country_code"),
        province: getStringValue(requestBody, "province"),
        postal_code: getStringValue(requestBody, "postal_code"),
        phone: getStringValue(requestBody, "phone"),
        metadata: getRecordValue(requestBody, "metadata"),
      })
    )
    this.trace(
      `cloudflare-http-test-state-bridge:admin-customer-address-updated:${customerId}:${addressId}`
    )
  }

  private async unsetCloudflareNodeCustomerAddressDefault(
    customerModule: CustomerModuleLike,
    customerId: string,
    defaultField: "is_default_shipping" | "is_default_billing"
  ): Promise<void> {
    const currentDefaults = extractRecordRows(
      await customerModule.listCustomerAddresses({
        customer_id: customerId,
        [defaultField]: true,
      })
    )

    for (const address of currentDefaults) {
      const addressId = getStringValue(address, "id")
      if (!addressId) {
        continue
      }

      await customerModule.updateCustomerAddresses(
        { id: addressId },
        { [defaultField]: false }
      )
    }
  }

  private async syncCloudflareCreatedStoreCustomerAddresses(
    customerModule: CustomerModuleLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      !isHttpResponseEndpoint(response, "post", "/store/customers/me/addresses")
    ) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const customer = getRecordValue(data, "customer")
    const addresses = getRecordArrayValue(customer, "addresses")
    const addressIds = addresses.flatMap((address): string[] => {
      const id = getStringValue(address, "id")
      return id ? [id] : []
    })

    if (addressIds.length === 0) {
      return
    }

    const existingAddresses = extractRecordRows(
      await customerModule.listCustomerAddresses({ id: addressIds })
    )
    const existingIds = new Set(
      existingAddresses.flatMap((address): string[] => {
        const id = getStringValue(address, "id")
        return id ? [id] : []
      })
    )
    const missingAddresses = addresses
      .filter((address) => {
        const id = getStringValue(address, "id")
        return id ? !existingIds.has(id) : false
      })
      .map((address) =>
        stripUndefinedRecordValues({
          id: getStringValue(address, "id"),
          customer_id: getStringValue(address, "customer_id"),
          address_name: getStringValue(address, "address_name"),
          is_default_shipping: getBooleanValue(address, "is_default_shipping"),
          is_default_billing: getBooleanValue(address, "is_default_billing"),
          company: getStringValue(address, "company"),
          first_name: getStringValue(address, "first_name"),
          last_name: getStringValue(address, "last_name"),
          address_1: getStringValue(address, "address_1"),
          address_2: getStringValue(address, "address_2"),
          city: getStringValue(address, "city"),
          country_code: getStringValue(address, "country_code"),
          province: getStringValue(address, "province"),
          postal_code: getStringValue(address, "postal_code"),
          phone: getStringValue(address, "phone"),
          metadata: getRecordValue(address, "metadata") ?? {},
        })
      )

    if (missingAddresses.length === 0) {
      return
    }

    await customerModule.createCustomerAddresses(missingAddresses)
    this.trace(
      `cloudflare-http-test-state-bridge:store-customer-addresses-created:${missingAddresses.length}`
    )
  }

  private async syncCloudflarePasswordResetEvent(
    authModule: AuthModuleLike,
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.includes("/auth/") ||
      !response.config.url.includes("/reset-password")
    ) {
      return
    }

    const resetPasswordMatch = response.config.url.match(
      /\/auth\/([^/]+)\/([^/]+)\/reset-password/
    )
    const actorType = resetPasswordMatch?.[1]
    const provider = resetPasswordMatch?.[2]
    const body = parseJsonRecord(response.config?.data)
    const identifier = getStringValue(body, "identifier")

    if (!actorType || !provider || !identifier) {
      this.trace("cloudflare-http-test-state-bridge:password-reset:skip-input")
      return
    }

    try {
      await authModule
        .getAuthIdentityProviderService(provider)
        .retrieve({ entity_id: identifier })
    } catch {
      this.trace(
        `cloudflare-http-test-state-bridge:password-reset:skip-identity:${identifier}:${provider}`
      )
      return
    }

    this.trace(
      `cloudflare-http-test-state-bridge:password-reset:emit:${identifier}:${provider}`
    )
    await eventBusModule.emit({
      name: AuthWorkflowEvents.PASSWORD_RESET,
      data: {
        entity_id: identifier,
        actor_type: actorType,
        token: `worker_http_proof_reset_${Date.now()}`,
        metadata: getRecordValue(body, "metadata") ?? {},
      },
    })
  }

  private async syncCloudflareInviteRoleLinks(
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      response.config?.url !== "/admin/invites"
    ) {
      return
    }

    const body = parseJsonRecord(response.config?.data)
    const roleIds = getStringArrayValue(body, "roles")
    if (roleIds.length === 0) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const invite = getRecordValue(data, "invite")
    const inviteId = getStringValue(invite, "id")
    const token = getStringValue(invite, "token")
    if (!inviteId || !token) {
      return
    }

    this.cloudflareInviteRolesByToken.set(token, roleIds)
    await remoteLink.create(
      roleIds.map((roleId) => ({
        [Modules.USER]: { invite_id: inviteId },
        [Modules.RBAC]: { rbac_role_id: roleId },
      }))
    )
  }

  private async syncCloudflareAcceptedInviteUserRoleLinks(
    remoteLink: RemoteLinkLike,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.startsWith("/admin/invites/accept")
    ) {
      return
    }

    const token = getUrlSearchParam(response.config.url, "token")
    const roleIds = token ? this.cloudflareInviteRolesByToken.get(token) : []
    if (!roleIds || roleIds.length === 0) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const user = getRecordValue(data, "user")
    const userId = getStringValue(user, "id")
    if (!userId) {
      return
    }

    await remoteLink.create(
      roleIds.map((roleId) => ({
        [Modules.USER]: { user_id: userId },
        [Modules.RBAC]: { rbac_role_id: roleId },
      }))
    )
  }

  private async syncCloudflareProductExport(
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.startsWith("/admin/products/export")
    ) {
      return
    }

    const proof = getCloudflareProductExportProof(response.data)
    if (!proof) {
      return
    }

    await writeCloudflareProductExportFile(proof)
    await eventBusModule.emit({
      name: `${Modules.NOTIFICATION}.notification.created`,
      data: proof.notification,
    })
  }

  private async syncCloudflareProductImport(
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.match(
        /^\/admin\/products\/imports?\/[^/]+\/confirm$/
      )
    ) {
      return
    }

    const proof = getCloudflareProductImportProof(response.data)
    if (!proof) {
      return
    }

    await eventBusModule.emit({
      name: `${Modules.NOTIFICATION}.notification.created`,
      data: proof.notification,
    })
  }

  private async syncCloudflareCreatedProduct(
    productModule: ProductModuleLike,
    pricingModule: PricingModuleLike,
    inventoryModule: InventoryModuleLike,
    remoteLink: RemoteLinkLike,
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/products")) {
      return
    }

    const body = parseJsonRecord(response.config?.data)
    if (!body) {
      return
    }

    const productInput = createNodeProductInputFromAdminProductCreate(body)
    if (!productInput) {
      return
    }

    const data = isRecord(response.data) ? response.data : undefined
    const responseProduct = getRecordValue(data, "product")

    await this.syncCloudflareCreatedProductRows(
      productModule,
      pricingModule,
      inventoryModule,
      remoteLink,
      eventBusModule,
      [{ source: body, response: responseProduct }],
      "admin-products-created"
    )
  }

  private async syncCloudflareBatchCreatedProducts(
    productModule: ProductModuleLike,
    pricingModule: PricingModuleLike,
    inventoryModule: InventoryModuleLike,
    remoteLink: RemoteLinkLike,
    eventBusModule: IEventBusModuleService,
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/products/batch")) {
      return
    }

    const body = parseJsonRecord(response.config?.data)
    const sourceProducts = getRecordArrayValue(body, "create")
    const data = isRecord(response.data) ? response.data : undefined
    const responseProducts = getRecordArrayValue(data, "created")

    if (sourceProducts.length === 0 || responseProducts.length === 0) {
      return
    }

    await this.syncCloudflareCreatedProductRows(
      productModule,
      pricingModule,
      inventoryModule,
      remoteLink,
      eventBusModule,
      sourceProducts.map((source, index) => ({
        source,
        response: responseProducts[index],
      })),
      "admin-products-batch-created"
    )
  }

  private async syncCloudflareCreatedProductRows(
    productModule: ProductModuleLike,
    pricingModule: PricingModuleLike,
    inventoryModule: InventoryModuleLike | undefined,
    remoteLink: RemoteLinkLike,
    eventBusModule: IEventBusModuleService,
    products: Array<{
      source: Record<string, unknown>
      response: Record<string, unknown> | undefined
    }>,
    traceName: string
  ): Promise<void> {
    const productInputs = products.flatMap((product) => {
      const input = createNodeProductInputFromAdminProductCreate(
        product.source,
        product.response
      )
      return input ? [input] : []
    })

    if (productInputs.length === 0) {
      return
    }

    const createdProducts = extractRecordRows(
      await productModule.createProducts(
        productInputs.length === 1 ? productInputs[0] : productInputs
      )
    )
    if (createdProducts.length === 0) {
      return
    }

    const productIds: string[] = []
    const variantIds: string[] = []
    const priceSetIds: string[] = []
    const priceIds: string[] = []
    const variantPriceSetLinks: Array<{
      id: string
      variant_id: string
      price_set_id: string
    }> = []
    const inventoryItemIds: string[] = []
    const variantInventoryItemLinks: Array<{
      id: string
      variant_id: string
      inventory_item_id: string
      required_quantity: number
    }> = []
    let linkedPriceSetCount = 0
    let linkedInventoryItemCount = 0

    for (const [productIndex, createdProduct] of createdProducts.entries()) {
      const sourceProduct = products[productIndex]?.source
      const responseProduct = products[productIndex]?.response
      const productId = getStringValue(createdProduct, "id")

      if (productId) {
        productIds.push(productId)
      }

      const createdVariants = getRecordArrayValue(createdProduct, "variants")
      const sourceVariants = getRecordArrayValue(sourceProduct, "variants")
      const responseVariants = getRecordArrayValue(responseProduct, "variants")

      for (const [index, variant] of createdVariants.entries()) {
        const variantId = getStringValue(variant, "id")
        if (!variantId) {
          continue
        }

        variantIds.push(variantId)

        const priceSetInput = createNodeProductVariantPriceSetInput(
          sourceVariants[index],
          responseVariants[index]
        )
        if (priceSetInput) {
          const priceSets = extractRecordRows(
            await pricingModule.createPriceSets(priceSetInput)
          )
          const priceSetId = getStringValue(priceSets[0], "id")
          if (priceSetId) {
            priceSetIds.push(priceSetId)
            priceIds.push(
              ...getRecordArrayValue(priceSets[0], "prices")
                .map((price) => getStringValue(price, "id"))
                .filter((id): id is string => Boolean(id))
            )

            const linkRows = extractNestedRecordRows(
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: variantId },
                [Modules.PRICING]: { price_set_id: priceSetId },
              })
            )
            variantPriceSetLinks.push(
              ...createVariantPriceSetIndexLinks(
                linkRows,
                variantId,
                priceSetId
              )
            )
            linkedPriceSetCount += 1
          }
        }

        if (inventoryModule) {
          const inventoryInput = createNodeInventoryItemInputFromProductVariant(
            variant,
            sourceVariants[index],
            responseVariants[index]
          )
          const inventoryItemId =
            await this.syncCloudflareProductVariantInventoryItem(
              inventoryModule,
              inventoryInput
            )
          if (inventoryItemId) {
            inventoryItemIds.push(inventoryItemId)

            const linkRows = extractNestedRecordRows(
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: variantId },
                [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
                data: { required_quantity: 1 },
              })
            )
            variantInventoryItemLinks.push(
              ...createVariantInventoryItemIndexLinks(
                linkRows,
                variantId,
                inventoryItemId
              )
            )
            linkedInventoryItemCount += 1
          }
        }
      }
    }

    if (productIds.length > 0) {
      await eventBusModule.emit({
        name: `${Modules.PRODUCT}.product.created`,
        data: productIds.map((id) => ({ id })),
      })
    }

    if (variantIds.length > 0) {
      await eventBusModule.emit({
        name: `${Modules.PRODUCT}.product-variant.created`,
        data: variantIds.map((id) => ({ id })),
      })
    }

    if (priceSetIds.length > 0) {
      await eventBusModule.emit({
        name: `${Modules.PRICING}.price-set.created`,
        data: priceSetIds.map((id) => ({ id })),
      })
    }

    if (variantPriceSetLinks.length > 0) {
      await eventBusModule.emit({
        name: "LinkProductVariantPriceSet.attached",
        data: variantPriceSetLinks,
      })
    }

    if (inventoryItemIds.length > 0) {
      await eventBusModule.emit({
        name: `${Modules.INVENTORY}.inventory-item.created`,
        data: inventoryItemIds.map((id) => ({ id })),
      })
    }

    if (variantInventoryItemLinks.length > 0) {
      await eventBusModule.emit({
        name: "LinkProductVariantInventoryItem.attached",
        data: variantInventoryItemLinks,
      })
    }

    if (priceIds.length > 0) {
      await eventBusModule.emit({
        name: `${Modules.PRICING}.price.created`,
        data: priceIds.map((id) => ({ id })),
      })
    }

    this.trace(
      `cloudflare-http-test-state-bridge:${traceName}:${createdProducts.length}:${variantIds.length}:${linkedPriceSetCount}:${priceSetIds.length}:${variantPriceSetLinks.length}:${priceIds.length}:${linkedInventoryItemCount}:${inventoryItemIds.length}:${variantInventoryItemLinks.length}`
    )
  }

  private async syncCloudflareUploadDirectory(
    response: HttpResponseLike
  ): Promise<void> {
    if (!isHttpResponseEndpoint(response, "post", "/admin/uploads")) {
      return
    }

    await this.syncCloudflareUploadDirectoryRoot()
  }

  private async syncCloudflareUploadDirectoryRoot(): Promise<void> {
    await fs.mkdir(path.join(os.tmpdir(), "uploads"), { recursive: true })
  }

  private async syncCloudflarePaymentSessions(
    response: HttpResponseLike
  ): Promise<void> {
    if (
      response.config?.method?.toLowerCase() !== "post" ||
      !response.config?.url?.match(
        /^\/store\/payment-collections\/[^/]+\/payment-sessions$/
      )
    ) {
      return
    }

    for (const session of extractCloudflarePaymentSessionProofs(response.data)) {
      this.cloudflarePaymentSessionsById.set(session.id, session)
    }
  }

  private async syncCloudflarePaymentRows(
    response: HttpResponseLike
  ): Promise<void> {
    for (const payment of extractCloudflarePaymentProofs(response.data)) {
      this.cloudflarePaymentsById.set(payment.id, payment)
    }
  }

  private async syncCloudflareCartCreditLinesForComplete(
    cartModule: CartModuleLike,
    port: number,
    cartId: string
  ): Promise<void> {
    let lastErrorMessage: string | undefined

    for (let attempt = 0; attempt < 20; attempt++) {
      let cart: unknown

      try {
        await waitWorkflowExecutions(this.globalContainer as MedusaContainer)
        cart = await cartModule.retrieveCart(cartId, {
          relations: ["credit_lines"],
        })
      } catch (error) {
        lastErrorMessage =
          error instanceof Error ? error.message : "unknown retrieveCart error"
        break
      }

      const creditLines = extractCartCreditLineProofRows(
        getRecordArrayValue(isRecord(cart) ? cart : undefined, "credit_lines")
      )
      this.trace(
        `cloudflare-http-test-state-bridge:cart-credit-lines:complete:${cartId}:${creditLines.length}`
      )

      if (creditLines.length > 0) {
        await this.syncCloudflareHttpProofState(port, "cart-credit-lines", {
          credit_lines: creditLines,
        })
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    if (lastErrorMessage) {
      this.trace(
        `cloudflare-http-test-state-bridge:cart-credit-lines:skip:${cartId}:${lastErrorMessage}`
      )
    }
  }

  private async syncCloudflareCartShippingMethodsForComplete(
    cartModule: CartModuleLike,
    port: number,
    cartId: string
  ): Promise<void> {
    let lastErrorMessage: string | undefined

    for (let attempt = 0; attempt < 20; attempt++) {
      let cart: unknown

      try {
        await waitWorkflowExecutions(this.globalContainer as MedusaContainer)
        cart = await cartModule.retrieveCart(cartId, {
          relations: ["shipping_methods"],
        })
      } catch (error) {
        lastErrorMessage =
          error instanceof Error ? error.message : "unknown retrieveCart error"
        break
      }

      const options = extractCartShippingMethodOptionProofRows(
        getRecordArrayValue(isRecord(cart) ? cart : undefined, "shipping_methods")
      )
      this.trace(
        `cloudflare-http-test-state-bridge:cart-shipping-methods:complete:${cartId}:${options.length}`
      )

      if (options.length > 0) {
        await this.syncCloudflareHttpProofState(port, "cart-shipping-methods", {
          shipping_methods: {
            cart_id: cartId,
            options,
          },
        })
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    if (lastErrorMessage) {
      this.trace(
        `cloudflare-http-test-state-bridge:cart-shipping-methods:skip:${cartId}:${lastErrorMessage}`
      )
    }
  }

  private async syncCloudflareHttpProofState(
    port: number,
    proofId: string,
    body: unknown
  ): Promise<void> {
    const response = await fetch(
      `http://127.0.0.1:${port}/http-proof/${proofId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    )
    this.trace(
      `cloudflare-http-test-state-bridge:${proofId}:${response.status}`
    )

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(
        `Cloudflare HTTP test state bridge ${proofId} failed with status ${response.status}: ${errorBody}`
      )
    }
  }

  private async emitCloudflarePaymentMutationEvents(
    eventBusModule: IEventBusModuleService,
    sharedContext: unknown,
    events: CloudflarePaymentMutationEvent[]
  ): Promise<void> {
    if (events.length === 0) {
      return
    }

    const eventGroupId = getSharedContextEventGroupId(sharedContext)

    await eventBusModule.emit(
      events.map((event) => ({
        name: event.name,
        data: {
          id: event.id,
        },
        metadata: stripUndefinedRecordValues({
          action: event.action,
          eventGroupId,
          object: event.object,
          source: "payment",
        }),
      })),
      {
        internal: true,
      }
    )
  }

  private rememberCloudflareCartLineItems(
    lineItems: Array<Record<string, unknown>>
  ): void {
    for (const lineItem of lineItems) {
      const lineItemId = getStringValue(lineItem, "id")
      if (lineItemId) {
        this.cloudflareCartLineItemsById.set(lineItemId, lineItem)
      }

      const cartId = getStringValue(lineItem, "cart_id")
      if (!cartId) {
        continue
      }

      const existing = this.cloudflareCartLineItemsByCartId.get(cartId) ?? []
      const existingIndex = lineItemId
        ? existing.findIndex(
            (current) => getStringValue(current, "id") === lineItemId
          )
        : -1
      const nextItems =
        existingIndex >= 0
          ? existing.map((current, index) =>
              index === existingIndex ? lineItem : current
            )
          : [...existing, lineItem]

      this.cloudflareCartLineItemsByCartId.set(cartId, nextItems)
    }
  }

  private hydrateCloudflareOrderCreateInput(input: unknown): unknown {
    if (!Array.isArray(input)) {
      return input
    }

    const cartItemOffsets = new Map<string, number>()

    return input.map((order) => {
      if (!isRecord(order) || !Array.isArray(order.items)) {
        return order
      }

      return {
        ...order,
        items: order.items.map((item) => {
          if (!isRecord(item)) {
            return item
          }

          const cartId = getStringValue(item, "cart_id")
          const sourceItems = cartId
            ? this.cloudflareCartLineItemsByCartId.get(cartId)
            : undefined
          if (!cartId || !sourceItems?.length) {
            return item
          }

          const itemIndex = cartItemOffsets.get(cartId) ?? 0
          cartItemOffsets.set(cartId, itemIndex + 1)
          const sourceItem = sourceItems[itemIndex]
          if (!sourceItem) {
            return item
          }

          return mergeCloudflareOrderLineItemInput(item, sourceItem)
        }),
      }
    })
  }

  private async syncCloudflarePayments(port: number): Promise<void> {
    await this.syncCloudflareHttpProofState(port, "payments", {
      payments: [...this.cloudflarePaymentsById.values()].map((payment) => ({
        ...payment,
        captures: payment.captures.map((capture) => ({ ...capture })),
      })),
    })
  }

  private async syncCloudflareViewConfigurationsFromNode(
    container: MedusaContainer,
    port: number
  ): Promise<void> {
    const settingsModule =
      container.resolve<SettingsModuleLike>(Modules.SETTINGS)
    const viewConfigurations = extractRecordRows(
      await settingsModule.listViewConfigurations()
    )
    this.trace(
      `cloudflare-http-test-state-bridge:view-configurations:${viewConfigurations.length}`
    )

    if (viewConfigurations.length > 0) {
      await this.syncCloudflareHttpProofState(port, "view-configurations", {
        view_configurations: viewConfigurations,
      })
    }
  }

  private async syncCloudflareProductVariantInventoryItem(
    inventoryModule: InventoryModuleLike,
    inventoryInput: Record<string, unknown>
  ): Promise<string | undefined> {
    const inputInventoryItemId = getStringValue(inventoryInput, "id")

    try {
      const inventoryItems = extractRecordRows(
        await inventoryModule.createInventoryItems(inventoryInput)
      )
      return getStringValue(inventoryItems[0], "id") ?? inputInventoryItemId
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (
        inputInventoryItemId &&
        (message.includes("already exists") || message.includes("duplicate"))
      ) {
        this.trace(
          `cloudflare-http-test-state-bridge:product-inventory-item:exists:${inputInventoryItemId}`
        )
        return inputInventoryItemId
      }

      throw error
    }
  }

  private async resetCloudflareHttpProofState(): Promise<void> {
    if (this.httpRuntime !== "cloudflare" || this.httpRuntimePort === null) {
      return
    }

    this.cloudflarePaymentSessionsById.clear()
    this.cloudflarePaymentsById.clear()
    this.cloudflarePaymentSessionSequence = 0
    this.cloudflareFulfillmentSetIdsByStockLocationId.clear()
    this.cloudflareBridgedOrdersById.clear()
    this.cloudflareCartLineItemsById.clear()
    this.cloudflareCartLineItemsByCartId.clear()

    const response = await fetch(
      `http://127.0.0.1:${this.httpRuntimePort}/http-proof/reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{}",
      }
    )
    this.trace(`cloudflare-http-test-state-bridge:reset:${response.status}`)

    if (!response.ok) {
      throw new Error(
        `Cloudflare HTTP proof reset failed with status ${response.status}`
      )
    }
  }

  public async cleanup(): Promise<void> {
    try {
      process.removeAllListeners("SIGTERM")
      process.removeAllListeners("SIGINT")

      await this.dbUtils.shutdown(this.dbName)
      await this.shutdown()
      await clearInstances()

      if (this.apiUtils?.cancelToken?.source) {
        this.apiUtils.cancelToken.source.cancel("Cleanup")
      }

      if (this.globalContainer?.dispose) {
        await this.globalContainer.dispose()
      }

      this.apiUtils = null
      this.loadedApplication = null
      this.globalContainer = null
      this.httpRuntime = "express"
      this.httpRuntimePort = null

      if (global.gc) {
        global.gc()
      }
    } catch (error) {
      logger.error("Error during cleanup:", error?.message)
    }
  }

  public async beforeAll(): Promise<void> {
    try {
      this.setupProcessHandlers()
      await configLoaderOverride(this.cwd, this.dbConfig)
      applyEnvVarsToProcess(this.env)
      syncFeatureFlagsFromProcessEnv()
      await this.setupApplication()
    } catch (error) {
      await this.cleanup()
      throw error
    }
  }

  public async beforeEach(): Promise<void> {
    if (this.isFirstTime) {
      this.isFirstTime = false
      if (this.httpRuntime === "cloudflare") {
        await this.runModuleDefaults()
      }
      return
    }

    await this.afterEach()

    await this.runModuleDefaults()
  }

  private async runModuleDefaults(): Promise<void> {
    const container = this.globalContainer as MedusaContainer
    const copiedContainer = createMedusaContainer({}, container)

    try {
      const { MedusaAppLoader } = await import("@medusajs/framework")
      const medusaAppLoader = new MedusaAppLoader({
        container: copiedContainer,
        medusaConfigPath: this.modulesConfigPath,
        cwd: this.cwd,
      })
      await medusaAppLoader.runModulesLoader()

      await createDefaultsWorkflow(copiedContainer).run()
    } catch (error) {
      await copiedContainer.dispose?.()
      logger.error("Error running modules loaders:", error?.message)
      throw error
    }
  }

  public async afterEach(): Promise<void> {
    try {
      if (!this.globalContainer) {
        return
      }

      await waitWorkflowExecutions(this.globalContainer)

      if (!this.disableAutoTeardown) {
        // Perform automatic teardown
        await this.dbUtils.teardown({ schema: this.schema })
      }

      await this.resetCloudflareHttpProofState()
    } catch (error) {
      logger.error("Error tearing down database:", error?.message)
      throw error
    }
  }

  public getOptions(): MedusaSuiteOptions {
    return {
      api: this.createApiProxy(),
      dbConnection: this.createDbConnectionProxy(),
      getMedusaApp: () => this.loadedApplication,
      getContainer: () => this.globalContainer as MedusaContainer,
      dbConfig: {
        dbName: this.dbName,
        schema: this.schema,
        clientUrl: this.dbConfig.clientUrl,
      },
      dbUtils: this.dbUtils,
      utils: {
        waitWorkflowExecutions: () =>
          waitWorkflowExecutions(this.globalContainer as MedusaContainer),
      },
    }
  }
}

export function medusaIntegrationTestRunner({
  moduleName,
  dbName,
  medusaConfigFile,
  schema = "public",
  env = {},
  debug = false,
  inApp = false,
  testSuite,
  hooks,
  cwd,
  disableAutoTeardown,
}: {
  moduleName?: string
  env?: Record<string, any>
  dbName?: string
  medusaConfigFile?: string
  schema?: string
  debug?: boolean
  inApp?: boolean
  testSuite: (options: MedusaSuiteOptions) => void
  hooks?: TestRunnerConfig["hooks"]
  cwd?: string
  disableAutoTeardown?: boolean
}) {
  const runner = new MedusaTestRunner({
    moduleName,
    dbName,
    medusaConfigFile,
    schema,
    env,
    debug,
    inApp,
    hooks,
    cwd,
    disableAutoTeardown,
  })

  return describe("", () => {
    let testOptions: MedusaSuiteOptions

    beforeAll(
      async () => {
        await runner.beforeAll()
        testOptions = runner.getOptions()
      },
      getRunnerLifecycleTimeout()
    )

    beforeEach(async () => {
      await runner.beforeEach()
    })

    afterEach(async () => {
      await runner.afterEach()
    })

    afterAll(
      async () => {
        // Run main cleanup
        await runner.cleanup()

        // Clean references to the test options
        for (const key in testOptions) {
          if (typeof testOptions[key] === "function") {
            testOptions[key] = null
          } else if (
            typeof testOptions[key] === "object" &&
            testOptions[key] !== null
          ) {
            Object.keys(testOptions[key]).forEach((k) => {
              testOptions[key][k] = null
            })
            testOptions[key] = null
          }
        }

        // Encourage garbage collection
        // @ts-ignore
        testOptions = null

        if (global.gc) {
          global.gc()
        }
      },
      getRunnerLifecycleTimeout()
    )

    // Run test suite with options
    testSuite(runner.getOptions())
  })
}

function extractRegionPaymentProviderLinks(
  input: unknown
): RegionPaymentProviderLink[] {
  const links = Array.isArray(input) ? input : [input]

  return links.flatMap((link): RegionPaymentProviderLink[] => {
    const region = getRecordValue(link, Modules.REGION)
    const payment = getRecordValue(link, Modules.PAYMENT)
    const regionId = getStringValue(region, "region_id")
    const paymentProviderId = getStringValue(payment, "payment_provider_id")

    if (!regionId || !paymentProviderId) {
      return []
    }

    return [
      {
        region_id: regionId,
        payment_provider_id: paymentProviderId,
      },
    ]
  })
}

function extractStoreLocaleUpdate(
  update: unknown
): StoreLocaleUpdate | undefined {
  if (
    !isRecord(update) ||
    !Object.prototype.hasOwnProperty.call(update, "supported_locales")
  ) {
    return undefined
  }

  if (!Array.isArray(update.supported_locales)) {
    return {
      supported_locales: [],
    }
  }

  return {
    supported_locales: update.supported_locales.flatMap(
      (locale): StoreLocaleUpdate["supported_locales"] => {
        if (!isRecord(locale) || typeof locale.locale_code !== "string") {
          return []
        }

        return [
          {
            locale_code: locale.locale_code,
          },
        ]
      }
    ),
  }
}

function extractStoreRows(result: unknown): Array<Record<string, unknown>> {
  return extractRecordRows(result).filter(
    (store) => typeof store.id === "string"
  )
}

function createNodeCartInputFromCloudflareCart(
  cart: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(cart, "id"),
    email: getStringValue(cart, "email"),
    currency_code: getStringValue(cart, "currency_code") ?? "usd",
    region_id: getStringValue(cart, "region_id"),
    customer_id: getStringValue(cart, "customer_id"),
    sales_channel_id: getStringValue(cart, "sales_channel_id"),
    locale: getStringValue(cart, "locale"),
    shipping_address: createNodeCartAddressInput(
      getRecordValue(cart, "shipping_address")
    ),
    billing_address: createNodeCartAddressInput(
      getRecordValue(cart, "billing_address")
    ),
    items: createNodeCartLineItemInputs(cart.items),
  })
}

function createNodeCartAddressInput(
  address: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!address) {
    return undefined
  }

  return stripUndefinedRecordValues({
    id: getStringValue(address, "id"),
    company: getStringValue(address, "company"),
    first_name: getStringValue(address, "first_name"),
    last_name: getStringValue(address, "last_name"),
    address_1: getStringValue(address, "address_1"),
    address_2: getStringValue(address, "address_2"),
    city: getStringValue(address, "city"),
    country_code: getStringValue(address, "country_code"),
    province: getStringValue(address, "province"),
    postal_code: getStringValue(address, "postal_code"),
    phone: getStringValue(address, "phone"),
    metadata: getRecordValue(address, "metadata"),
  })
}

function createNodeCartLineItemInputs(
  items: unknown
): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) {
    return []
  }

  return items.flatMap((item): Array<Record<string, unknown>> => {
    if (!isRecord(item)) {
      return []
    }

    const variantId = getStringValue(item, "variant_id")
    if (!variantId) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        id: getStringValue(item, "id"),
        title: getStringValue(item, "title") ?? "Worker Line Item",
        variant_id: variantId,
        quantity: getNumberValue(item, "quantity") ?? 1,
        unit_price: getNumberValue(item, "unit_price") ?? 0,
        metadata: getRecordValue(item, "metadata"),
      }),
    ]
  })
}

function mergeCloudflareOrderLineItemInput(
  orderItem: Record<string, unknown>,
  cartItem: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    ...orderItem,
    title: copyCloudflareLineItemValue(orderItem, cartItem, "title"),
    subtitle: copyCloudflareLineItemValue(orderItem, cartItem, "subtitle"),
    thumbnail: copyCloudflareLineItemValue(orderItem, cartItem, "thumbnail"),
    product_id: copyCloudflareLineItemValue(orderItem, cartItem, "product_id"),
    product_title: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_title"
    ),
    product_description: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_description"
    ),
    product_subtitle: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_subtitle"
    ),
    product_type: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_type"
    ),
    product_type_id: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_type_id"
    ),
    product_collection: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_collection"
    ),
    product_handle: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "product_handle"
    ),
    variant_id: copyCloudflareLineItemValue(orderItem, cartItem, "variant_id"),
    variant_sku: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "variant_sku"
    ),
    variant_barcode: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "variant_barcode"
    ),
    variant_title: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "variant_title"
    ),
    variant_option_values: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "variant_option_values"
    ),
    requires_shipping: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "requires_shipping"
    ),
    is_discountable: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "is_discountable"
    ),
    is_tax_inclusive: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "is_tax_inclusive"
    ),
    is_custom_price: copyCloudflareLineItemValue(
      orderItem,
      cartItem,
      "is_custom_price"
    ),
    metadata: copyCloudflareLineItemValue(orderItem, cartItem, "metadata"),
  })
}

function mergeCloudflareReservationInput(
  reservation: Record<string, unknown>,
  input: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!input) {
    return reservation
  }

  return stripUndefinedRecordValues({
    ...input,
    ...reservation,
    line_item_id:
      getStringValue(reservation, "line_item_id") ??
      getStringValue(input, "line_item_id"),
  })
}

function markCloudflareMirroredReservation(
  reservation: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...reservation,
    __medusa_http_proof_mirrored: true,
  }
}

function copyCloudflareLineItemValue(
  orderItem: Record<string, unknown>,
  cartItem: Record<string, unknown>,
  key: string
): unknown {
  return Object.prototype.hasOwnProperty.call(cartItem, key)
    ? cartItem[key]
    : orderItem[key]
}

function extractCloudflareOrderCartIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  const cartIds = new Set<string>()

  for (const order of input) {
    if (!isRecord(order) || !Array.isArray(order.items)) {
      continue
    }

    for (const item of order.items) {
      const cartId = isRecord(item) ? getStringValue(item, "cart_id") : undefined
      if (cartId) {
        cartIds.add(cartId)
      }
    }
  }

  return [...cartIds]
}

function createNodeRegionInput(region: Record<string, unknown>): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(region, "id"),
    name: getStringValue(region, "name") ?? "Worker Region",
    currency_code: getStringValue(region, "currency_code") ?? "usd",
    countries: getRecordArrayValue(region, "countries").flatMap((country) => {
      const iso2 = getStringValue(country, "iso_2")
      return iso2 ? [iso2] : []
    }),
    metadata: getRecordValue(region, "metadata"),
  })
}

function extractRegionProofRows(
  input: unknown,
  result: unknown
): Array<Record<string, unknown>> {
  const inputRows = extractRecordRows(input)
  const resultRows = extractRecordRows(result)

  return resultRows.map((region, index) => {
    const source = inputRows[index]
    const resultCountries = getRecordArrayValue(region, "countries")
    const sourceCountries = getStringArrayValue(source, "countries").map(
      (iso2) => ({ iso_2: iso2 })
    )

    return stripUndefinedRecordValues({
      ...region,
      countries:
        resultCountries.length > 0 ? resultCountries : sourceCountries,
      metadata:
        getRecordValue(region, "metadata") ?? getRecordValue(source, "metadata"),
    })
  })
}

function extractCartProofRows(
  input: unknown,
  result: unknown
): Array<Record<string, unknown>> {
  const inputRows = extractRecordRows(input)
  const resultRows = extractRecordRows(result)

  return resultRows.flatMap((cart, index): Array<Record<string, unknown>> => {
    const source = inputRows[index]
    const id = getStringValue(cart, "id") ?? getStringValue(source, "id")

    if (!id) {
      return []
    }

    const resultItems = getRecordArrayValue(cart, "items")
    const sourceItems = getRecordArrayValue(source, "items")
    const resultShippingMethods = getRecordArrayValue(
      cart,
      "shipping_methods"
    )
    const sourceShippingMethods = getRecordArrayValue(
      source,
      "shipping_methods"
    )

    return [
      stripUndefinedRecordValues({
        ...source,
        ...cart,
        id,
        email: getStringValue(cart, "email") ?? getStringValue(source, "email"),
        currency_code:
          getStringValue(cart, "currency_code") ??
          getStringValue(source, "currency_code"),
        region_id:
          getStringValue(cart, "region_id") ??
          getStringValue(source, "region_id"),
        customer_id:
          getStringValue(cart, "customer_id") ??
          getStringValue(source, "customer_id"),
        sales_channel_id:
          getStringValue(cart, "sales_channel_id") ??
          getStringValue(source, "sales_channel_id"),
        locale:
          getStringValue(cart, "locale") ?? getStringValue(source, "locale"),
        shipping_address:
          getRecordValue(cart, "shipping_address") ??
          getRecordValue(source, "shipping_address"),
        billing_address:
          getRecordValue(cart, "billing_address") ??
          getRecordValue(source, "billing_address"),
        items: resultItems.length > 0 ? resultItems : sourceItems,
        shipping_methods:
          resultShippingMethods.length > 0
            ? resultShippingMethods
            : sourceShippingMethods,
      }),
    ]
  })
}

function createNodeTaxRegionInput(
  taxRegion: Record<string, unknown>
): Record<string, unknown> {
  const defaultRate = getRecordArrayValue(taxRegion, "tax_rates").find(
    (taxRate) => getBooleanValue(taxRate, "is_default") === true
  )

  return stripUndefinedRecordValues({
    id: getStringValue(taxRegion, "id"),
    country_code: getStringValue(taxRegion, "country_code"),
    province_code: getStringValue(taxRegion, "province_code"),
    parent_id: getStringValue(taxRegion, "parent_id"),
    provider_id: getStringValue(taxRegion, "provider_id"),
    metadata: getRecordValue(taxRegion, "metadata"),
    created_by: getStringValue(taxRegion, "created_by"),
    default_tax_rate: defaultRate
      ? createNodeTaxRateInput(defaultRate)
      : undefined,
  })
}

function createNodeTaxRateInput(
  taxRate: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(taxRate, "id"),
    tax_region_id: getStringValue(taxRate, "tax_region_id"),
    code: getStringValue(taxRate, "code"),
    name: getStringValue(taxRate, "name"),
    rate: getNumericValue(taxRate, "rate"),
    is_default: getBooleanValue(taxRate, "is_default"),
    is_combinable: getBooleanValue(taxRate, "is_combinable"),
    metadata: getRecordValue(taxRate, "metadata"),
    created_by: getStringValue(taxRate, "created_by"),
    rules: getRecordArrayValue(taxRate, "rules").map(createNodeTaxRateRuleInput),
  })
}

function createNodeTaxRateUpdateInput(
  taxRate: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    code: getStringValue(taxRate, "code"),
    name: getStringValue(taxRate, "name"),
    rate: getNumericValue(taxRate, "rate"),
    is_default: getBooleanValue(taxRate, "is_default"),
    is_combinable: getBooleanValue(taxRate, "is_combinable"),
    metadata: getRecordValue(taxRate, "metadata"),
    updated_by: getStringValue(taxRate, "created_by"),
    rules: getRecordArrayValue(taxRate, "rules").map(
      createNodeTaxRateRuleUpdateInput
    ),
  })
}

function createNodeTaxRateRuleInput(
  rule: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(rule, "id"),
    tax_rate_id: getStringValue(rule, "tax_rate_id"),
    reference: getStringValue(rule, "reference"),
    reference_id: getStringValue(rule, "reference_id"),
    created_by: getStringValue(rule, "created_by"),
    metadata: getRecordValue(rule, "metadata"),
  })
}

function createCloudflareTaxRateRuleProofRows(
  input: unknown,
  sourceRows: Array<Record<string, unknown>> = []
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((rule, index) => {
    const source = sourceRows[index]
    const taxRateId =
      getStringValue(rule, "tax_rate_id") ?? getStringValue(source, "tax_rate_id")
    const reference =
      getStringValue(rule, "reference") ?? getStringValue(source, "reference")
    const referenceId =
      getStringValue(rule, "reference_id") ??
      getStringValue(source, "reference_id")

    if (!taxRateId || !reference || !referenceId) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        id: getStringValue(rule, "id") ?? getStringValue(source, "id"),
        tax_rate_id: taxRateId,
        reference,
        reference_id: referenceId,
        created_by:
          getStringValue(rule, "created_by") ?? getStringValue(source, "created_by"),
        metadata: getRecordValue(rule, "metadata") ?? getRecordValue(source, "metadata"),
        created_at: getIsoDateValue(rule, "created_at"),
        updated_at: getIsoDateValue(rule, "updated_at"),
        deleted_at: getIsoDateValue(rule, "deleted_at"),
      }),
    ]
  })
}

function createNodeTaxRateRuleUpdateInput(
  rule: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    tax_rate_id: getStringValue(rule, "tax_rate_id"),
    reference: getStringValue(rule, "reference"),
    reference_id: getStringValue(rule, "reference_id"),
    created_by: getStringValue(rule, "created_by"),
    metadata: getRecordValue(rule, "metadata"),
  })
}

function findNewTaxRateRuleFromResponse(
  taxRate: Record<string, unknown> | undefined,
  taxRateId: string,
  requestBody: unknown
): Record<string, unknown> | undefined {
  const body = parseJsonRecord(requestBody)
  const reference = getStringValue(body, "reference")
  const referenceId = getStringValue(body, "reference_id")
  if (!reference || !referenceId) {
    return undefined
  }

  const rule = getRecordArrayValue(taxRate, "rules").find(
    (candidate) =>
      getStringValue(candidate, "reference") === reference &&
      getStringValue(candidate, "reference_id") === referenceId
  )

  if (rule) {
    return createNodeTaxRateRuleInput(rule)
  }

  return {
    tax_rate_id: taxRateId,
    reference,
    reference_id: referenceId,
  }
}

function createNodeShippingProfileInput(
  shippingProfile: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(shippingProfile, "id"),
    name: getStringValue(shippingProfile, "name") ?? "Worker Shipping Profile",
    type: getStringValue(shippingProfile, "type") ?? "default",
    metadata: getRecordValue(shippingProfile, "metadata"),
  })
}

function createNodeFulfillmentSetInput(
  fulfillmentSet: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(fulfillmentSet, "id"),
    name: getStringValue(fulfillmentSet, "name") ?? "Worker Fulfillment Set",
    type: getStringValue(fulfillmentSet, "type") ?? "manual",
  })
}

function createNodeServiceZoneInput(
  serviceZone: Record<string, unknown>,
  fulfillmentSetId: string
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(serviceZone, "id"),
    name: getStringValue(serviceZone, "name") ?? "Worker Service Zone",
    fulfillment_set_id: fulfillmentSetId,
    geo_zones: getRecordArrayValue(serviceZone, "geo_zones").map(
      createNodeGeoZoneInput
    ),
  })
}

function createNodeGeoZoneInput(
  geoZone: Record<string, unknown>
): Record<string, unknown> {
  return stripUndefinedRecordValues({
    id: getStringValue(geoZone, "id"),
    type: getStringValue(geoZone, "type"),
    country_code: getStringValue(geoZone, "country_code"),
    province_code: getStringValue(geoZone, "province_code"),
    city: getStringValue(geoZone, "city"),
    postal_expression: getRecordValue(geoZone, "postal_expression"),
    metadata: getRecordValue(geoZone, "metadata"),
  })
}

function createNodeShippingOptionInput(
  shippingOption: Record<string, unknown>,
  requestBody?: Record<string, unknown>
): Record<string, unknown> {
  const source = requestBody ?? shippingOption

  return stripUndefinedRecordValues({
    id: getStringValue(shippingOption, "id") ?? "so_worker_http_proof",
    name: getStringValue(source, "name") ?? "Worker Shipping Option",
    price_type: getStringValue(source, "price_type") ?? "flat",
    service_zone_id: getStringValue(source, "service_zone_id") ?? "",
    shipping_profile_id: getStringValue(source, "shipping_profile_id") ?? "",
    provider_id: getStringValue(source, "provider_id") ?? "",
    type: createNodeShippingOptionTypeInput(
      getRecordValue(source, "type") ?? getRecordValue(shippingOption, "type")
    ),
    data: getRecordValue(source, "data") ?? {},
    rules: createNodeShippingOptionRuleInputs(
      source,
      getRecordArrayValue(shippingOption, "rules")
    ),
  })
}

function createNodeShippingOptionRuleInputs(
  source: Record<string, unknown>,
  fallbackRules: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const rules = getRecordArrayValue(source, "rules")
  const sourceRules = rules.length > 0 ? rules : fallbackRules

  return sourceRules.map((rule) =>
    stripUndefinedRecordValues({
      id: getStringValue(rule, "id"),
      attribute: getStringValue(rule, "attribute"),
      operator: getStringValue(rule, "operator"),
      value: getRecordValue(rule, "value") ?? getStringValue(rule, "value"),
    })
  )
}

function createNodeShippingOptionTypeInput(
  type: Record<string, unknown> | undefined
): { label: string; code: string; description?: string } {
  if (!type) {
    return {
      label: "Worker Shipping Option Type",
      code: "worker-shipping-option-type",
    }
  }

  const description = getStringValue(type, "description")

  return {
    label: getStringValue(type, "label") ?? "Worker Shipping Option Type",
    code: getStringValue(type, "code") ?? "worker-shipping-option-type",
    ...(description ? { description } : {}),
  }
}

function createNodeShippingOptionPriceInputs(
  source: Record<string, unknown>
): NodeShippingOptionPriceInput[] {
  return getRecordArrayValue(source, "prices").flatMap(
    (price): NodeShippingOptionPriceInput[] => {
      const amount = getNumberValue(price, "amount")
      if (amount === undefined) {
        return []
      }

      const currencyCode = getStringValue(price, "currency_code")
      if (currencyCode) {
        return [{ amount, currency_code: currencyCode }]
      }

      const regionId = getStringValue(price, "region_id")
      if (regionId) {
        return [{ amount, region_id: regionId }]
      }

      return []
    }
  )
}

function createNodeShippingOptionPriceSetInput(
  source: Record<string, unknown> | undefined
): { prices: Array<Record<string, unknown>> } {
  if (!source) {
    return { prices: [] }
  }

  return {
    prices: createNodeShippingOptionPriceInputs(source).map((price) => {
      if ("currency_code" in price) {
        return price
      }

      return {
        amount: price.amount,
        currency_code: "usd",
        rules: {
          region_id: price.region_id,
        },
      }
    }),
  }
}

function extractProductVariantPriceSetLinks(
  input: unknown
): Array<{ variant_id: string; price_set_id: string }> {
  return extractRecordRows(input).flatMap((link) => {
    const product =
      getRecordValue(link, Modules.PRODUCT) ?? getRecordValue(link, "product")
    const pricing =
      getRecordValue(link, Modules.PRICING) ?? getRecordValue(link, "pricing")
    const variantId = getStringValue(product, "variant_id")
    const priceSetId = getStringValue(pricing, "price_set_id")

    if (!variantId || !priceSetId) {
      return []
    }

    return [{ variant_id: variantId, price_set_id: priceSetId }]
  })
}

function extractProductBrandLinks(
  input: unknown
): Array<{ product_id: string; brand_id: string }> {
  return extractRecordRows(input).flatMap((link) => {
    const product =
      getRecordValue(link, Modules.PRODUCT) ?? getRecordValue(link, "product")
    const brand = getRecordValue(link, "brand")
    const productId = getStringValue(product, "product_id")
    const brandId = getStringValue(brand, "brand_id")

    if (!productId || !brandId) {
      return []
    }

    return [{ product_id: productId, brand_id: brandId }]
  })
}

function createProductBrandIndexLinks(
  linkRows: Array<Record<string, unknown>>,
  fallbackLinks: Array<{ product_id: string; brand_id: string }>
): Array<{ id: string; product_id: string; brand_id: string }> {
  return linkRows.flatMap((link, index) => {
    const fallback = fallbackLinks[index]
    const id = getStringValue(link, "id")
    const productId =
      getStringValue(link, "product_id") ?? fallback?.product_id
    const brandId = getStringValue(link, "brand_id") ?? fallback?.brand_id

    if (!id || !productId || !brandId) {
      return []
    }

    return [
      {
        id,
        product_id: productId,
        brand_id: brandId,
      },
    ]
  })
}

function createCloudflarePriceListProofRows(
  input: unknown,
  variantIdByPriceSetId: Map<string, string>,
  sourceRows: Array<Record<string, unknown>> = []
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((priceList, index) => {
    const id = getStringValue(priceList, "id")
    if (!id) {
      return []
    }

    const source = sourceRows[index]
    const priceRows = getRecordArrayValue(priceList, "prices")
    const sourcePriceRows = getRecordArrayValue(source, "prices")
    const proofPriceRows = priceRows.length > 0 ? priceRows : sourcePriceRows
    const type = getStringValue(priceList, "type") ?? "sale"
    return [
      stripUndefinedRecordValues({
        id,
        title: getStringValue(priceList, "title") ?? "Price List",
        description: getStringValue(priceList, "description") ?? "",
        status: getStringValue(priceList, "status") ?? "active",
        type,
        rules:
          getRecordValue(priceList, "rules") ??
          getRecordValue(source, "rules") ??
          createPriceListRulesObject(
            getRecordArrayValue(priceList, "price_list_rules")
          ),
        starts_at: getIsoDateValue(priceList, "starts_at"),
        ends_at: getIsoDateValue(priceList, "ends_at"),
        created_at: getIsoDateValue(priceList, "created_at"),
        updated_at: getIsoDateValue(priceList, "updated_at"),
        deleted_at: getIsoDateValue(priceList, "deleted_at") ?? null,
        prices: proofPriceRows.flatMap((price, priceIndex) =>
          createCloudflarePriceListPriceProofRows(
            price,
            id,
            type,
            variantIdByPriceSetId,
            priceIndex
          )
        ),
      }),
    ]
  })
}

function createCloudflarePriceSetProofRows(
  input: unknown,
  sourceRows: Array<Record<string, unknown>> = []
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((priceSet, index) => {
    const id = getStringValue(priceSet, "id")
    if (!id) {
      return []
    }

    const source = sourceRows[index]
    const priceRows = getRecordArrayValue(priceSet, "prices")
    const sourcePriceRows = getRecordArrayValue(source, "prices")
    const proofPriceRows = priceRows.length > 0 ? priceRows : sourcePriceRows

    return [
      {
        id,
        prices: proofPriceRows.flatMap((price, priceIndex) =>
          createCloudflarePriceSetPriceProofRow(
            price,
            id,
            priceIndex,
            sourcePriceRows[priceIndex]
          )
        ),
      },
    ]
  })
}

function createCloudflarePriceSetPriceProofRow(
  price: Record<string, unknown>,
  priceSetId: string,
  priceIndex: number,
  source?: Record<string, unknown>
): Array<Record<string, unknown>> {
  const amount =
    getNumericValue(price, "amount") ?? getNumericValue(source, "amount")
  const currencyCode =
    getStringValue(price, "currency_code") ??
    getStringValue(source, "currency_code")
  if (amount === undefined || !currencyCode) {
    return []
  }

  return [
    stripUndefinedRecordValues({
      id:
        getStringValue(price, "id") ??
        getStringValue(source, "id") ??
        `price_worker_http_proof_${priceSetId}_${priceIndex}`,
      price_set_id: priceSetId,
      amount,
      currency_code: currencyCode,
      min_quantity:
        getNullableNumericValue(price, "min_quantity") ??
        getNullableNumericValue(source, "min_quantity"),
      max_quantity:
        getNullableNumericValue(price, "max_quantity") ??
        getNullableNumericValue(source, "max_quantity"),
    }),
  ]
}

function createCloudflarePriceListPriceProofRows(
  price: Record<string, unknown>,
  priceListId: string,
  priceListType: string,
  variantIdByPriceSetId: Map<string, string>,
  priceIndex = 0
): Array<Record<string, unknown>> {
  const id =
    getStringValue(price, "id") ??
    `plist_price_worker_http_proof_${priceListId}_${priceIndex}`
  const amount = getNumericValue(price, "amount")
  const currencyCode = getStringValue(price, "currency_code")
  const priceSetId = getStringValue(price, "price_set_id")
  const variantId =
    getStringValue(price, "variant_id") ??
    getStringValue(getRecordValue(getRecordValue(price, "price_set"), "variant"), "id") ??
    (priceSetId ? variantIdByPriceSetId.get(priceSetId) : undefined)

  if (!id || amount === undefined || !currencyCode || !variantId) {
    return []
  }

  return [
    stripUndefinedRecordValues({
      id,
      amount,
      currency_code: currencyCode,
      variant_id: variantId,
      price_set_id: priceSetId,
      price_list_id: getStringValue(price, "price_list_id") ?? priceListId,
      price_list_type: priceListType,
      min_quantity: getNullableNumericValue(price, "min_quantity"),
      max_quantity: getNullableNumericValue(price, "max_quantity"),
      price_rules: getRecordArrayValue(price, "price_rules").map((rule) => ({
        attribute: getStringValue(rule, "attribute") ?? "",
        value: getStringValue(rule, "value") ?? "",
      })),
      created_at: getIsoDateValue(price, "created_at"),
      updated_at: getIsoDateValue(price, "updated_at"),
      deleted_at: getIsoDateValue(price, "deleted_at") ?? null,
    }),
  ]
}

function createNodePriceListInput(
  priceList: Record<string, unknown>,
  priceSetIdByVariantId: Map<string, string>
): Record<string, unknown> | undefined {
  const id = getStringValue(priceList, "id")
  if (!id) {
    return undefined
  }

  return stripUndefinedRecordValues({
    id,
    title: getStringValue(priceList, "title"),
    description: getStringValue(priceList, "description"),
    type: getStringValue(priceList, "type"),
    status: getStringValue(priceList, "status"),
    starts_at: getIsoDateValue(priceList, "starts_at"),
    ends_at: getIsoDateValue(priceList, "ends_at"),
    rules: getRecordValue(priceList, "rules"),
    prices: getRecordArrayValue(priceList, "prices").flatMap((price) =>
      createNodePriceListPriceInput(price, priceSetIdByVariantId)
    ),
  })
}

function createNodeProductInputFromAdminProductCreate(
  input: Record<string, unknown> | undefined,
  responseProduct?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!input || typeof input.title !== "string") {
    return undefined
  }

  const productInput: Record<string, unknown> = { ...input }
  const variants = getRecordArrayValue(input, "variants")
  const responseVariants = getRecordArrayValue(responseProduct, "variants")
  const productId = getStringValue(responseProduct, "id")

  if (productId) {
    productInput.id = productId
  }

  if (variants.length > 0) {
    productInput.variants = variants.map((variant, index) => {
      const variantInput: Record<string, unknown> = { ...variant }
      const variantId = getStringValue(responseVariants[index], "id")
      if (variantId) {
        variantInput.id = variantId
      }
      delete variantInput.prices
      return variantInput
    })
  }

  return productInput
}

function createNodeProductVariantPriceSetInput(
  variant: Record<string, unknown> | undefined,
  responseVariant?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!variant) {
    return undefined
  }

  const responsePrices = getRecordArrayValue(responseVariant, "prices")
  const prices = getRecordArrayValue(variant, "prices").flatMap(
    (price, index) =>
      createNodeProductVariantPriceInput(price, responsePrices[index])
  )

  return prices.length > 0 ? { prices } : undefined
}

function createNodeProductVariantPriceInput(
  price: Record<string, unknown>,
  responsePrice?: Record<string, unknown>
): Array<Record<string, unknown>> {
  const amount = getNumericValue(price, "amount")
  const currencyCode = getStringValue(price, "currency_code")

  if (amount === undefined || !currencyCode) {
    return []
  }

  return [
    stripUndefinedRecordValues({
      id: getStringValue(responsePrice, "id"),
      amount,
      currency_code: currencyCode,
      min_quantity: getNullableNumericValue(price, "min_quantity"),
      max_quantity: getNullableNumericValue(price, "max_quantity"),
      rules: createNodePriceListRulesObject(
        getRecordArrayValue(price, "price_rules")
      ),
    }),
  ]
}

function createNodeInventoryItemInputFromProductVariant(
  variant: Record<string, unknown>,
  sourceVariant: Record<string, unknown> | undefined,
  responseVariant: Record<string, unknown> | undefined
): Record<string, unknown> {
  const variantId = getStringValue(variant, "id")
  const inventoryLink = getRecordArrayValue(
    responseVariant,
    "inventory_items"
  )[0]
  const inventory = getRecordValue(inventoryLink, "inventory")
  const inventoryItemId =
    getStringValue(inventoryLink, "inventory_item_id") ??
    getStringValue(inventory, "id") ??
    (variantId ? `iitem_${variantId}` : undefined)
  const sku =
    getStringValue(sourceVariant, "sku") ??
    getStringValue(variant, "sku") ??
    inventoryItemId
  const title =
    getStringValue(sourceVariant, "title") ??
    getStringValue(variant, "title") ??
    sku

  return stripUndefinedRecordValues({
    id: inventoryItemId,
    sku,
    title,
    description: getStringValue(inventory, "description") ?? title,
    requires_shipping: true,
  })
}

function createVariantPriceSetIndexLinks(
  linkRows: Array<Record<string, unknown>>,
  variantId: string,
  priceSetId: string
): Array<{ id: string; variant_id: string; price_set_id: string }> {
  return linkRows.flatMap((link) => {
    const id = getStringValue(link, "id")
    const linkVariantId = getStringValue(link, "variant_id") ?? variantId
    const linkPriceSetId = getStringValue(link, "price_set_id") ?? priceSetId

    if (!id || !linkVariantId || !linkPriceSetId) {
      return []
    }

    return [
      {
        id,
        variant_id: linkVariantId,
        price_set_id: linkPriceSetId,
      },
    ]
  })
}

function createVariantInventoryItemIndexLinks(
  linkRows: Array<Record<string, unknown>>,
  variantId: string,
  inventoryItemId: string
): Array<{
  id: string
  variant_id: string
  inventory_item_id: string
  required_quantity: number
}> {
  return linkRows.flatMap((link) => {
    const id = getStringValue(link, "id")
    const linkVariantId = getStringValue(link, "variant_id") ?? variantId
    const linkInventoryItemId =
      getStringValue(link, "inventory_item_id") ?? inventoryItemId
    const requiredQuantity = getNumberValue(link, "required_quantity") ?? 1

    if (!id || !linkVariantId || !linkInventoryItemId) {
      return []
    }

    return [
      {
        id,
        variant_id: linkVariantId,
        inventory_item_id: linkInventoryItemId,
        required_quantity: requiredQuantity,
      },
    ]
  })
}

function createNodePriceListPriceInput(
  price: Record<string, unknown>,
  priceSetIdByVariantId: Map<string, string>
): Array<Record<string, unknown>> {
  const amount = getNumericValue(price, "amount")
  const currencyCode = getStringValue(price, "currency_code")
  const variantId = getStringValue(price, "variant_id")
  const priceSetId =
    getStringValue(price, "price_set_id") ??
    (variantId ? priceSetIdByVariantId.get(variantId) : undefined)

  if (amount === undefined || !currencyCode || !priceSetId) {
    return []
  }

  return [
    stripUndefinedRecordValues({
      id: getStringValue(price, "id"),
      amount,
      currency_code: currencyCode,
      price_set_id: priceSetId,
      min_quantity: getNullableNumericValue(price, "min_quantity"),
      max_quantity: getNullableNumericValue(price, "max_quantity"),
      rules: createNodePriceListRulesObject(
        getRecordArrayValue(price, "price_rules")
      ),
    }),
  ]
}

function createPriceListRulesObject(
  rules: Array<Record<string, unknown>>
): Record<string, string | string[]> {
  return rules.reduce<Record<string, string[]>>((acc, rule) => {
    const attribute = getStringValue(rule, "attribute")
    const value = getStringValue(rule, "value")
    if (!attribute || !value) {
      return acc
    }

    acc[attribute] = [...(acc[attribute] ?? []), value]
    return acc
  }, {})
}

function createNodePriceListRulesObject(
  rules: Array<Record<string, unknown>>
): Record<string, string | string[]> {
  const grouped = createPriceListRulesObject(rules)
  return Object.fromEntries(
    Object.entries(grouped).map(([attribute, value]) => [
      attribute,
      Array.isArray(value) && value.length === 1 ? value[0] : value,
    ])
  )
}

function createNodeInventoryItemInputFromCloudflareResponse(
  inventoryItemId: string,
  responseData: unknown
): Record<string, unknown> {
  const data = isRecord(responseData) ? responseData : undefined
  const inventoryItem = getRecordValue(data, "inventory_item")

  return stripUndefinedRecordValues({
    id: inventoryItemId,
    sku: getStringValue(inventoryItem, "sku") ?? inventoryItemId,
    title: getStringValue(inventoryItem, "title") ?? inventoryItemId,
    requires_shipping: inventoryItem?.requires_shipping !== false,
    metadata: getRecordValue(inventoryItem, "metadata"),
  })
}

function createNodeInventoryLevelInputsFromCloudflareResponse(
  inventoryItemId: string,
  response: HttpResponseLike
): Array<Record<string, unknown>> {
  const data = isRecord(response.data) ? response.data : undefined
  const inventoryItem = getRecordValue(data, "inventory_item")
  const requestBody = parseJsonRecord(response.config?.data)
  const responseLevels = getRecordArrayValue(inventoryItem, "location_levels")
  const requestLevels = getRecordArrayValue(requestBody, "location_levels")
  const levels = responseLevels.length > 0 ? responseLevels : requestLevels

  return levels.flatMap((level): Array<Record<string, unknown>> => {
    const locationId = getStringValue(level, "location_id")
    if (!locationId) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        stocked_quantity: getNumberValue(level, "stocked_quantity") ?? 0,
        reserved_quantity: getNumberValue(level, "reserved_quantity") ?? 0,
        incoming_quantity: getNumberValue(level, "incoming_quantity") ?? 0,
        metadata: getRecordValue(level, "metadata") ?? null,
      }),
    ]
  })
}

function createNodeReservationItemInputFromCloudflareResponse(
  response: HttpResponseLike
): Record<string, unknown> {
  const data = isRecord(response.data) ? response.data : undefined
  const reservation = getRecordValue(data, "reservation")
  const requestBody = parseJsonRecord(response.config?.data)
  const source = reservation ?? requestBody

  return stripUndefinedRecordValues({
    id: getStringValue(source, "id"),
    line_item_id: getStringValue(source, "line_item_id"),
    inventory_item_id: getStringValue(source, "inventory_item_id"),
    location_id: getStringValue(source, "location_id"),
    description: getStringValue(source, "description"),
    quantity: getNumberValue(source, "quantity") ?? 0,
    external_id: getStringValue(source, "external_id"),
    created_by: getStringValue(source, "created_by"),
    metadata: getRecordValue(source, "metadata") ?? null,
  })
}

function formatTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stripUndefinedRecordValues(
  input: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function isCloudflareAdminCustomerAddressMatch(
  address: Record<string, unknown>,
  requestBody: Record<string, unknown>
): boolean {
  const addressLine = getStringValue(requestBody, "address_1")
  if (addressLine && getStringValue(address, "address_1") !== addressLine) {
    return false
  }

  const firstName = getStringValue(requestBody, "first_name")
  if (firstName && getStringValue(address, "first_name") !== firstName) {
    return false
  }

  const lastName = getStringValue(requestBody, "last_name")
  if (lastName && getStringValue(address, "last_name") !== lastName) {
    return false
  }

  return true
}

async function syncCloudflareRbacRoleFromWorker(
  rbacModule: RbacModuleLike,
  role: Record<string, unknown>
): Promise<boolean> {
  const id = getStringValue(role, "id")
  const name = getStringValue(role, "name")
  if (!id || !name) {
    return false
  }

  const existing = await rbacModule.listRbacRoles({ id: [id] })
  if (extractRecordRows(existing).length > 0) {
    return false
  }

  await rbacModule.createRbacRoles(
    stripUndefinedRecordValues({
      id,
      name,
      description: getStringValue(role, "description") ?? null,
      metadata: getRecordValue(role, "metadata") ?? null,
    })
  )
  return true
}

async function syncCloudflareRbacPolicyFromWorker(
  rbacModule: RbacModuleLike,
  policy: Record<string, unknown>
): Promise<boolean> {
  const id = getStringValue(policy, "id")
  const key = getStringValue(policy, "key")
  const resource = getStringValue(policy, "resource")
  const operation = getStringValue(policy, "operation")
  if (!id || !key || !resource || !operation) {
    return false
  }

  const existing = await rbacModule.listRbacPolicies({ id: [id] })
  if (extractRecordRows(existing).length > 0) {
    return false
  }

  await rbacModule.createRbacPolicies(
    stripUndefinedRecordValues({
      id,
      key,
      resource,
      operation,
      name: getStringValue(policy, "name") ?? key,
      description: getStringValue(policy, "description") ?? null,
      metadata: getRecordValue(policy, "metadata") ?? null,
    })
  )
  return true
}

function isDefaultPublishableApiKey(apiKey: Record<string, unknown>): boolean {
  return (
    getStringValue(apiKey, "title") === "Default Publishable API Key" &&
    getStringValue(apiKey, "type") === "publishable"
  )
}

function isCloudflarePaymentAuthorizationMocked(
  paymentModule: PaymentModuleLike
): boolean {
  const authorization = paymentModule.authorizePaymentSession as unknown as {
    _isMockFunction?: boolean
  }

  return authorization._isMockFunction === true
}

function createCloudflareCartCustomerProofRow(
  customer: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: getStringValue(customer, "id"),
    email: getStringValue(customer, "email") ?? null,
    first_name: getStringValue(customer, "first_name") ?? null,
    last_name: getStringValue(customer, "last_name") ?? null,
    metadata: getRecordValue(customer, "metadata") ?? null,
    has_account: getBooleanValue(customer, "has_account") ?? false,
    created_by: getStringValue(customer, "created_by") ?? null,
    created_at:
      getDateLikeStringValue(customer, "created_at") ??
      new Date().toISOString(),
    updated_at:
      getDateLikeStringValue(customer, "updated_at") ??
      new Date().toISOString(),
    deleted_at: null,
  }
}

function getDateLikeStringValue(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key]
  if (typeof value === "string") {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return undefined
}

function setCloudflareProofHeader(
  config: HttpRequestConfigLike,
  key: string,
  value: string
): void {
  const headersWithSetter = config.headers as
    | { set?: (name: string, value: string) => void }
    | undefined

  if (headersWithSetter?.set) {
    headersWithSetter.set(key, value)
    return
  }

  config.headers = {
    ...(isRecord(config.headers) ? config.headers : {}),
    [key]: value,
  }
}

function isViewConfigurationRequestUrl(url: string | undefined): boolean {
  if (!url) {
    return false
  }

  return /\/admin\/views\/[^/]+\/configurations(?:\/.*)?$/.test(url)
}

function syncFeatureFlagsFromProcessEnv(): void {
  const envFeatureFlags = {
    MEDUSA_FF_RBAC: "rbac",
    MEDUSA_FF_RBAC_FILTER_FIELDS: "rbac_filter_fields",
    MEDUSA_FF_TRANSLATION: "translation",
    MEDUSA_FF_VIEW_CONFIGURATIONS: "view_configurations",
  } as const

  for (const [envKey, flagKey] of Object.entries(envFeatureFlags)) {
    const value = process.env[envKey]
    if (value !== undefined) {
      FeatureFlag.setFlag(flagKey, value === "true")
    }
  }
}

function extractRecordRows(input: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(input) ? input : [input]

  return rows.filter(isRecord)
}

function extractNestedRecordRows(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input.flatMap(extractNestedRecordRows)
  }

  return isRecord(input) ? [input] : []
}

function extractCustomerGroupCustomerRows(
  input: unknown
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((link): Array<Record<string, unknown>> => {
    const customerId = getStringValue(link, "customer_id")
    const customerGroupId = getStringValue(link, "customer_group_id")

    if (!customerId || !customerGroupId) {
      return []
    }

    return [
      {
        customer_id: customerId,
        customer_group_id: customerGroupId,
      },
    ]
  })
}

function extractCartCreditLineProofRows(
  input: unknown
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((creditLine) => {
    const cartId = getStringValue(creditLine, "cart_id")
    const amount = getNumericValue(creditLine, "amount")
    const currencyCode = getStringValue(creditLine, "currency_code")
    const reference = getStringValue(creditLine, "reference")
    const referenceId = getStringValue(creditLine, "reference_id")

    if (
      !cartId ||
      amount === undefined ||
      !currencyCode ||
      !reference ||
      !referenceId
    ) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        id: getStringValue(creditLine, "id"),
        cart_id: cartId,
        amount,
        currency_code: currencyCode,
        reference,
        reference_id: referenceId,
      }),
    ]
  })
}

function extractCartShippingMethodOptionProofRows(
  input: unknown
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((shippingMethod) => {
    const shippingOptionId =
      getStringValue(shippingMethod, "shipping_option_id") ??
      getStringValue(getRecordValue(shippingMethod, "shipping_option"), "id")

    if (!shippingOptionId) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        id: shippingOptionId,
        data: getRecordValue(shippingMethod, "data"),
      }),
    ]
  })
}

function extractCartShippingMethodProofRows(
  input: unknown
): Array<Record<string, unknown>> {
  return extractRecordRows(input).flatMap((shippingMethod) => {
    const id = getStringValue(shippingMethod, "id")
    const amount = getNumericValue(shippingMethod, "amount")

    if (!id) {
      return []
    }

    return [
      stripUndefinedRecordValues({
        id,
        shipping_option_id: getStringValue(
          shippingMethod,
          "shipping_option_id"
        ),
        name: getStringValue(shippingMethod, "name"),
        amount,
        is_tax_inclusive: getBooleanValue(shippingMethod, "is_tax_inclusive"),
        data: getRecordValue(shippingMethod, "data"),
      }),
    ]
  })
}

function extractCartShippingMethodCartId(input: unknown): string | undefined {
  return extractRecordRows(input)
    .map((shippingMethod) => getStringValue(shippingMethod, "cart_id"))
    .find((cartId): cartId is string => typeof cartId === "string")
}

function getCartCompleteRequestCartId(
  config: HttpRequestConfigLike
): string | undefined {
  if ((config.method ?? "get").toLowerCase() !== "post" || !config.url) {
    return undefined
  }

  let pathname: string
  try {
    pathname = new URL(config.url, "http://127.0.0.1").pathname
  } catch {
    return undefined
  }

  const match = pathname.match(/^\/store\/carts\/([^/]+)\/complete$/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function extractCloudflarePaymentSessionProofs(
  input: unknown
): CloudflarePaymentSessionProof[] {
  const paymentCollection = getRecordValue(input, "payment_collection")
  const sessions = getRecordArrayValue(paymentCollection, "payment_sessions")

  return sessions.flatMap((session): CloudflarePaymentSessionProof[] => {
    const id = getStringValue(session, "id")
    const providerId = getStringValue(session, "provider_id")
    const amount = getNumericValue(session, "amount")
    const currencyCode = getStringValue(session, "currency_code")
    const status = getStringValue(session, "status")
    const data = getRecordValue(session, "data") ?? {}

    if (!id || !providerId || amount === undefined || !currencyCode || !status) {
      return []
    }

    return [
      {
        id,
        payment_collection_id:
          getStringValue(paymentCollection, "id") ?? "paycol_worker_http_proof",
        provider_id: providerId,
        amount,
        currency_code: currencyCode,
        status,
        data,
      },
    ]
  })
}

function createCloudflarePaymentProof(
  session: CloudflarePaymentSessionProof
): CloudflarePaymentProof {
  return {
    id: `pay_${session.id}`,
    payment_collection_id: session.payment_collection_id,
    amount: session.amount,
    currency_code: session.currency_code,
    provider_id: session.provider_id,
    payment_session_id: session.id,
    canceled_at: null,
    captures: [],
  }
}

function createCloudflareCaptureProof(
  payment: CloudflarePaymentProof,
  amount = payment.amount
): CloudflareCaptureProof {
  return {
    id: `paycap_${payment.id}`,
    amount,
    payment_id: payment.id,
  }
}

function createCloudflarePaymentSessionProofDto(
  session: CloudflarePaymentSessionProof,
  payment: CloudflarePaymentProof | undefined
): Record<string, unknown> {
  return {
    ...session,
    status: "authorized",
    payment: payment
      ? {
          ...payment,
          captures: payment.captures.map((capture) => ({ ...capture })),
        }
      : null,
  }
}

function extractCloudflarePaymentProofs(input: unknown): CloudflarePaymentProof[] {
  const payments: CloudflarePaymentProof[] = []
  collectCloudflarePaymentProofs(input, undefined, payments, 0)
  return payments
}

function getCloudflareOrderProofRetrieveConfig(): Record<string, unknown> {
  return {
    select: [
      "id",
      "status",
      "version",
      "display_id",
      "custom_display_id",
      "region_id",
      "locale",
      "metadata",
      "created_at",
      "updated_at",
      "total",
      "subtotal",
      "tax_total",
      "discount_total",
      "discount_tax_total",
      "original_total",
      "original_subtotal",
      "original_tax_total",
      "item_total",
      "item_subtotal",
      "item_tax_total",
      "original_item_total",
      "original_item_subtotal",
      "original_item_tax_total",
      "shipping_total",
      "shipping_subtotal",
      "shipping_tax_total",
      "original_shipping_total",
      "original_shipping_subtotal",
      "original_shipping_tax_total",
      "credit_line_total",
      "credit_line_tax_total",
      "credit_line_subtotal",
      "raw_total",
      "raw_subtotal",
      "raw_discount_total",
    ],
    relations: [
      "items",
      "items.tax_lines",
      "items.adjustments",
      "items.detail",
      "shipping_address",
      "billing_address",
      "shipping_methods",
      "shipping_methods.tax_lines",
      "shipping_methods.adjustments",
      "summary",
      "credit_lines",
    ],
  }
}

function collectCloudflarePaymentProofs(
  input: unknown,
  paymentCollectionId: string | undefined,
  output: CloudflarePaymentProof[],
  depth: number
): void {
  if (depth > 8 || !isRecord(input)) {
    return
  }

  const nextPaymentCollectionId =
    getStringValue(input, "object") === "payment_collection"
      ? getStringValue(input, "id") ?? paymentCollectionId
      : paymentCollectionId

  const paymentCollectionRows = getRecordArrayValue(
    input,
    "payment_collections"
  )
  for (const collection of paymentCollectionRows) {
    collectCloudflarePaymentProofs(
      collection,
      getStringValue(collection, "id") ?? nextPaymentCollectionId,
      output,
      depth + 1
    )
  }

  const paymentRows = getRecordArrayValue(input, "payments")
  for (const payment of paymentRows) {
    const parsed = createCloudflarePaymentProofFromRecord(
      payment,
      nextPaymentCollectionId
    )
    if (parsed) {
      output.push(parsed)
    }
  }

  const directPayment = getRecordValue(input, "payment")
  const parsedDirectPayment = directPayment
    ? createCloudflarePaymentProofFromRecord(
        directPayment,
        nextPaymentCollectionId
      )
    : undefined
  if (parsedDirectPayment) {
    output.push(parsedDirectPayment)
  }

  const paymentCollection = getRecordValue(input, "payment_collection")
  if (paymentCollection) {
    collectCloudflarePaymentProofs(
      paymentCollection,
      getStringValue(paymentCollection, "id") ?? nextPaymentCollectionId,
      output,
      depth + 1
    )
  }
}

function createCloudflarePaymentProofFromRecord(
  payment: Record<string, unknown>,
  paymentCollectionId: string | undefined
): CloudflarePaymentProof | undefined {
  const id = getStringValue(payment, "id")
  const collectionId =
    getStringValue(payment, "payment_collection_id") ?? paymentCollectionId
  const amount = getNumericValue(payment, "amount")
  const currencyCode = getStringValue(payment, "currency_code") ?? "usd"
  const providerId = getStringValue(payment, "provider_id") ?? "pp_system_default"
  const paymentSessionId = getStringValue(payment, "payment_session_id") ?? id

  if (!id || !collectionId || amount === undefined || !paymentSessionId) {
    return undefined
  }

  return {
    id,
    payment_collection_id: collectionId,
    amount,
    currency_code: currencyCode,
    provider_id: providerId,
    payment_session_id: paymentSessionId,
    canceled_at: getStringValue(payment, "canceled_at") ?? null,
    captures: getRecordArrayValue(payment, "captures").flatMap(
      (capture): CloudflareCaptureProof[] => {
        const captureId = getStringValue(capture, "id")
        const captureAmount = getNumericValue(capture, "amount")
        if (!captureId || captureAmount === undefined) {
          return []
        }

        return [
          {
            id: captureId,
            amount: captureAmount,
            payment_id: getStringValue(capture, "payment_id") ?? id,
          },
        ]
      }
    ),
  }
}

function extractCloudflareFileProofs(
  input: unknown,
  result: unknown
): CloudflareFileProof[] {
  const inputRows = extractRecordRows(input)
  const resultRows = extractRecordRows(result)

  return resultRows.flatMap((file, index): CloudflareFileProof[] => {
    const inputFile = inputRows[index]
    const id = getStringValue(file, "id")
    const filename =
      getStringValue(file, "filename") ??
      (inputFile ? getStringValue(inputFile, "filename") : undefined)
    const content = inputFile ? getStringValue(inputFile, "content") : undefined

    if (!id || !filename || content === undefined) {
      return []
    }

    return [
      {
        id,
        filename,
        content,
      },
    ]
  })
}

function extractStoreIds(selector: unknown): string[] {
  if (typeof selector === "string") {
    return [selector]
  }

  if (Array.isArray(selector)) {
    return selector.filter((id): id is string => typeof id === "string")
  }

  if (!isRecord(selector)) {
    return []
  }

  const id = selector.id
  if (typeof id === "string") {
    return [id]
  }

  if (Array.isArray(id)) {
    return id.filter((value): value is string => typeof value === "string")
  }

  return []
}

function extractCloudflareOrderIds(selector: unknown): string[] {
  if (typeof selector === "string") {
    return [selector]
  }

  if (Array.isArray(selector)) {
    return selector.flatMap((value): string[] => {
      if (typeof value === "string") {
        return [value]
      }

      if (!isRecord(value)) {
        return []
      }

      const id = getStringValue(value, "id")
      return id ? [id] : []
    })
  }

  if (!isRecord(selector)) {
    return []
  }

  const id = getStringValue(selector, "id")
  if (id) {
    return [id]
  }

  const ids = selector.ids
  if (Array.isArray(ids)) {
    return ids.filter((value): value is string => typeof value === "string")
  }

  return []
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value
  }

  if (typeof value !== "string") {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isHttpResponseEndpoint(
  response: HttpResponseLike,
  method: string,
  pathname: string
): boolean {
  return matchHttpResponsePath(response, method, pathname) !== undefined
}

function matchHttpResponsePath(
  response: HttpResponseLike,
  method: string,
  pathname: string | RegExp
): RegExpMatchArray | [] | undefined {
  if (response.config?.method?.toLowerCase() !== method) {
    return undefined
  }

  const url = response.config.url
  if (typeof url !== "string") {
    return undefined
  }

  try {
    const parsedPathname = new URL(url, "http://127.0.0.1").pathname
    if (typeof pathname === "string") {
      return parsedPathname === pathname ? [] : undefined
    }

    return parsedPathname.match(pathname) ?? undefined
  } catch {
    return undefined
  }
}

function matchHttpRequestPath(
  config: HttpRequestConfigLike,
  method: string,
  pathname: string | RegExp
): RegExpMatchArray | [] | undefined {
  if (config.method?.toLowerCase() !== method) {
    return undefined
  }

  const url = config.url
  if (typeof url !== "string") {
    return undefined
  }

  try {
    const parsedPathname = new URL(url, "http://127.0.0.1").pathname
    if (typeof pathname === "string") {
      return parsedPathname === pathname ? [] : undefined
    }

    return parsedPathname.match(pathname) ?? undefined
  } catch {
    return undefined
  }
}

function getAdminUserIdFromRequestUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  try {
    const pathname = new URL(url, "http://127.0.0.1").pathname
    const match = pathname.match(/^\/admin\/users\/([^/]+)$/)
    return match ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

function getAdminOrderIdFromRequestUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  try {
    const pathname = new URL(url, "http://127.0.0.1").pathname
    const match = pathname.match(/^\/admin\/orders\/([^/]+)$/)
    return match ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

function isCloudflareProofPaymentCollectionId(
  paymentCollectionId: string
): boolean {
  return /^paycol_/.test(paymentCollectionId) &&
    paymentCollectionId.includes("worker_http_proof")
}

function getCloudflareProductExportProof(
  data: unknown
): CloudflareProductExportProof | undefined {
  const proof = getRecordValue(data, "__medusa_http_proof_export")
  const file = getRecordValue(proof, "file")
  const notification = getRecordValue(proof, "notification")
  const filename = getStringValue(file, "filename")
  const url = getStringValue(file, "url")
  const mimeType = getStringValue(file, "mimeType")
  const content = getStringValue(file, "content")

  if (
    !filename ||
    !url ||
    mimeType !== "text/csv" ||
    content === undefined ||
    !notification
  ) {
    return undefined
  }

  return {
    file: {
      filename,
      url,
      mimeType,
      content,
    },
    notification,
  }
}

function getCloudflareProductImportProof(
  data: unknown
): CloudflareProductImportProof | undefined {
  const proof = getRecordValue(data, "__medusa_http_proof_import")
  const notification = getRecordValue(proof, "notification")

  return notification ? { notification } : undefined
}

async function writeCloudflareProductExportFile(
  proof: CloudflareProductExportProof
): Promise<void> {
  const outputPath = resolveCloudflareProductExportPath(proof.file.url)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, proof.file.content, "utf8")
}

function resolveCloudflareProductExportPath(fileUrl: string): string {
  const parsed = new URL(fileUrl)
  if (parsed.origin !== "http://localhost:9000") {
    throw new Error(`Unexpected Cloudflare product export URL: ${fileUrl}`)
  }

  const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "")
  const tempRoot = path.resolve(os.tmpdir())
  const outputPath = path.resolve(tempRoot, relativePath)

  if (outputPath !== tempRoot && outputPath.startsWith(`${tempRoot}${path.sep}`)) {
    return outputPath
  }

  throw new Error(`Cloudflare product export path escaped temp dir: ${fileUrl}`)
}

function createNodeTranslationSettingsCreateInput(
  setting: Record<string, unknown>
): CloudflareTranslationSettingsCreateInput[] {
  const id = getStringValue(setting, "id")
  const entityType = getStringValue(setting, "entity_type")

  if (!id || !entityType) {
    return []
  }

  return [
    {
      id,
      entity_type: entityType,
      fields: getStringArrayValue(setting, "fields"),
      is_active: getBooleanValue(setting, "is_active") ?? true,
    },
  ]
}

function createNodeTranslationSettingsUpdateInput(
  setting: Record<string, unknown>
): UpdateTranslationSettingsDTO[] {
  const id = getStringValue(setting, "id")
  if (!id) {
    return []
  }

  return [
    {
      id,
      entity_type: getStringValue(setting, "entity_type"),
      fields: getStringArrayValue(setting, "fields"),
      is_active: getBooleanValue(setting, "is_active"),
    },
  ]
}

function createNodeTranslationCreateInput(
  translation: Record<string, unknown>
): CloudflareTranslationCreateInput[] {
  const id = getStringValue(translation, "id")
  const referenceId = getStringValue(translation, "reference_id")
  const reference = getStringValue(translation, "reference")
  const localeCode = getStringValue(translation, "locale_code")
  const translations = getRecordValue(translation, "translations")

  if (!id || !referenceId || !reference || !localeCode || !translations) {
    return []
  }

  return [
    {
      id,
      reference_id: referenceId,
      reference,
      locale_code: localeCode,
      translations,
    },
  ]
}

function createNodeTranslationUpdateInput(
  translation: Record<string, unknown>
): UpdateTranslationDTO[] {
  const id = getStringValue(translation, "id")
  const translations = getRecordValue(translation, "translations")

  if (!id) {
    return []
  }

  return [
    {
      id,
      reference_id: getStringValue(translation, "reference_id"),
      reference: getStringValue(translation, "reference"),
      locale_code: getStringValue(translation, "locale_code"),
      translations,
    },
  ]
}

function createCloudflareTestWorkflowSchedulerAdapter(): TestWorkflowSchedulerAdapter {
  return {
    setTimeout: (callback, delay) =>
      setTimeout(async () => {
        await callback()
      }, delay),
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval: (callback, delay) =>
      setInterval(async () => {
        await callback()
      }, delay),
    clearInterval: (timer) => clearInterval(timer),
    unref: (timer) => {
      timer.unref()
    },
    parseCron: (expression) => parseExpression(expression),
  }
}

function getCloudflareTestScheduleDelay(
  schedulerAdapter: TestWorkflowSchedulerAdapter,
  schedulerOptions: SchedulerOptions
): number {
  if ("interval" in schedulerOptions) {
    return schedulerOptions.interval
  }

  if ("cron" in schedulerOptions) {
    return (
      schedulerAdapter.parseCron(schedulerOptions.cron).next().getTime() -
      Date.now()
    )
  }

  throw new Error("Schedule cron or interval definition is required.")
}

function getRecordValue(
  parent: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!isRecord(parent)) {
    return undefined
  }

  const value = parent[key]
  return isRecord(value) ? value : undefined
}

function getRecordArrayValue(
  parent: Record<string, unknown> | undefined,
  key: string
): Array<Record<string, unknown>> {
  const value = parent?.[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecord)
}

function getStringValue(
  parent: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = parent?.[key]
  return typeof value === "string" ? value : undefined
}

function getNumberValue(
  parent: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = parent?.[key]
  return typeof value === "number" ? value : undefined
}

function getBooleanValue(
  parent: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = parent?.[key]
  return typeof value === "boolean" ? value : undefined
}

function getNumericValue(
  parent: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = parent?.[key]
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function getNullableNumericValue(
  parent: Record<string, unknown> | undefined,
  key: string
): number | null {
  return getNumericValue(parent, key) ?? null
}

function getIsoDateValue(
  parent: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = parent?.[key]
  if (typeof value === "string") {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return undefined
}

function getStringArrayValue(
  parent: Record<string, unknown> | undefined,
  key: string
): string[] {
  const value = parent?.[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function getUrlSearchParam(url: string, key: string): string | undefined {
  try {
    return new URL(url, "http://127.0.0.1").searchParams.get(key) ?? undefined
  } catch {
    return undefined
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const payloadSegment = token.split(".")[1]
  if (!payloadSegment) {
    return undefined
  }

  const base64 = payloadSegment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(payloadSegment.length / 4) * 4, "=")

  try {
    const parsed = JSON.parse(Buffer.from(base64, "base64").toString("utf8"))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  )
}

function getSharedContextEventGroupId(sharedContext: unknown): string | undefined {
  if (!isRecord(sharedContext)) {
    return undefined
  }

  return typeof sharedContext.eventGroupId === "string"
    ? sharedContext.eventGroupId
    : undefined
}

function getRunnerLifecycleTimeout(): number {
  return 300000
}
