import { createDurableObjectSqliteManager } from "@medusajs/drizzle-cloudflare"
import { compileDmlSchema, renderD1MigrationSql } from "@medusajs/drizzle"
import type { CloudflareQueueProducer } from "@medusajs/event-bus-cloudflare"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/workflows-sdk/composer"
import {
  TransactionStepTimeoutError,
  TransactionTimeoutError,
} from "@medusajs/orchestration/transaction/errors"
import { WorkflowScheduler } from "@medusajs/orchestration/workflow/scheduler"
import { WorkflowManager } from "@medusajs/orchestration/workflow/workflow-manager"
import type { Context } from "@medusajs/types"
import {
  createLazyMedusaFetchHttpHandler,
  type LazyMedusaFetchHttpHandler,
  type MedusaFetchHttpRuntimeOptions,
} from "@medusajs/medusa/static/fetch-http-handler"
import type {
  AuthContext,
  MedusaRequest,
  MedusaResponse,
  RouteDescriptor,
  StaticHttpResourceSetInput,
} from "@medusajs/framework/http/fetch"
import {
  createBearerAuthContextPrepareRequest,
  createHs256JwtBearerAuthContextVerifier,
} from "@medusajs/framework/http/fetch"
import {
  ApiKeyType,
  ApplicationMethodAllocation,
  ApplicationMethodTargetType,
  ApplicationMethodType,
  Modules,
  PromotionStatus,
  PromotionType,
  ShippingOptionPriceType,
} from "@medusajs/framework/utils"
import {
  commerceModuleModels,
  createCommerceModulesRuntimeWithManager,
  type CommerceModulesRuntime,
} from "./commerce-modules"
import type { CartModuleRuntime } from "./cart-module"
import {
  getWorkerMemoryAnalyticsSnapshot,
  resetWorkerMemoryAnalytics,
} from "./analytics-memory-provider"
import { DurableObjectWorkflowDelayedActionStore } from "@medusajs/workflow-engine-cloudflare/delayed-action-store"
import { DurableObjectWorkflowExecutionStore } from "@medusajs/workflow-engine-cloudflare/execution-store"
import { cloudflareWorkflowSchedulerAdapter } from "@medusajs/workflow-engine-cloudflare/scheduler-adapter"
import { DurableObjectWorkflowScheduleStore } from "@medusajs/workflow-engine-cloudflare/schedule-store"
import {
  createMedusaCloudflareHttpModuleRuntimeSource,
  type MedusaCloudflareHttpModuleRuntimeSource,
} from "./cloudflare-http-module-runtime-source"
import {
  createDurableObjectFetchAuthSessionRuntime,
  type DurableObjectFetchAuthSessionRuntime,
} from "./cloudflare-http-session-store"
import { MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET } from "./cloudflare-http-request-scope"

const prepareHttpProductionProofBearerAuth =
  createBearerAuthContextPrepareRequest(
    createHs256JwtBearerAuthContextVerifier({
      secret: MEDUSA_CLOUDFLARE_WORKER_PROOF_JWT_SECRET,
    })
  )

interface CartProofEnv {
  MEDUSA_LOCKING?: DurableObjectNamespace
  MEDUSA_EVENTS?: CloudflareQueueProducer
}

const commerceSchemaSql = renderD1MigrationSql(
  compileDmlSchema(commerceModuleModels)
)

export class CartProofDO {
  private readonly manager: ReturnType<typeof createDurableObjectSqliteManager>
  private readonly workflowExecutionStore: DurableObjectWorkflowExecutionStore
  private readonly workflowScheduleStore: DurableObjectWorkflowScheduleStore
  private readonly workflowDelayedActionStore: DurableObjectWorkflowDelayedActionStore
  private readonly httpSessionRuntime: DurableObjectFetchAuthSessionRuntime
  private readonly lockingNamespace: DurableObjectNamespace
  private readonly eventQueue: CloudflareQueueProducer
  private runtime?: Promise<CommerceModulesRuntime>
  private httpRuntimeSource?: MedusaCloudflareHttpModuleRuntimeSource
  private httpHandler?: Promise<LazyMedusaFetchHttpHandler>

  constructor(ctx: DurableObjectState, env: CartProofEnv) {
    this.manager = createDurableObjectSqliteManager(ctx.storage)
    this.workflowExecutionStore = new DurableObjectWorkflowExecutionStore(
      ctx.storage
    )
    this.workflowScheduleStore = new DurableObjectWorkflowScheduleStore(
      ctx.storage
    )
    this.workflowDelayedActionStore =
      new DurableObjectWorkflowDelayedActionStore(ctx.storage)
    this.httpSessionRuntime = createDurableObjectFetchAuthSessionRuntime(
      ctx.storage,
      {
        shouldCommitSession: ({ pathname }) =>
          pathname === "/auth/session" ||
          pathname === "/http-production-session-proof",
      }
    )
    ctx.storage.sql.exec(commerceSchemaSql)
    if (!env.MEDUSA_LOCKING) {
      throw new Error("MEDUSA_LOCKING Durable Object binding is required")
    }
    if (!env.MEDUSA_EVENTS) {
      throw new Error("MEDUSA_EVENTS Queue binding is required")
    }

    this.lockingNamespace = env.MEDUSA_LOCKING
    this.eventQueue = env.MEDUSA_EVENTS
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.split("/").slice(3).join("/")

    if (path === "capabilities") {
      return Response.json({ transactionMode: this.manager.transactionMode })
    }

    if (path === "scenario" && request.method === "POST") {
      const aggregateId = new URL(request.url).pathname.split("/")[2]
      return Response.json(
        await runCartScenario(await this.getRuntime(), aggregateId),
        {
          status: 201,
        }
      )
    }

    if (path === "transaction-rollback-proof" && request.method === "POST") {
      return Response.json(
        await runRollbackProof((await this.getRuntime()).cart, this.manager)
      )
    }

    if (
      path === "http-production-options-proof" &&
      request.method === "POST"
    ) {
      return Response.json(await runHttpProductionOptionsProof(
        await this.getRuntime(),
        await this.getHttpRuntimeSource().getHttpRuntimeOptions(),
        this.httpSessionRuntime
      ))
    }

    if (path.startsWith("http/")) {
      return await this.handleProductionHttpRequest(
        request,
        path.slice("http".length)
      )
    }

    if (path === "schedule-store-proof" && request.method === "POST") {
      await this.getRuntime()
      return Response.json(
        await runWorkflowScheduleStoreProof(this.workflowScheduleStore)
      )
    }

    if (path === "schedule-alarm-proof" && request.method === "POST") {
      return Response.json(
        await runWorkflowScheduleAlarmRecoveryProof(
          await this.getRuntime(),
          this.workflowScheduleStore
        )
      )
    }

    if (path === "execution-cleaner-proof" && request.method === "POST") {
      return Response.json(
        await runWorkflowExecutionCleanerProof(await this.getRuntime())
      )
    }

    if (path === "delayed-action-alarm-proof" && request.method === "POST") {
      return Response.json(
        await runWorkflowDelayedActionAlarmRecoveryProof(
          await this.getRuntime(),
          this.workflowDelayedActionStore
        )
      )
    }

    if (path === "step-timeout-alarm-proof" && request.method === "POST") {
      return Response.json(
        await runWorkflowStepTimeoutAlarmRecoveryProof(
          await this.getRuntime(),
          this.workflowDelayedActionStore
        )
      )
    }

    if (
      path === "transaction-timeout-alarm-proof" &&
      request.method === "POST"
    ) {
      return Response.json(
        await runWorkflowTransactionTimeoutAlarmRecoveryProof(
          await this.getRuntime(),
          this.workflowDelayedActionStore
        )
      )
    }

    return new Response("Not found", { status: 404 })
  }

  async alarm(): Promise<void> {
    const workflowEngine = (await this.getRuntime()).workflowEngine.service
    await workflowEngine.recoverDueSchedules()
    await workflowEngine.recoverDueDelayedActions()
  }

  private getRuntime(): Promise<CommerceModulesRuntime> {
    this.runtime ??= createCommerceModulesRuntimeWithManager(
      this.manager,
      this.getCommerceModuleOptions()
    )

    return this.runtime
  }

  private getHttpRuntimeSource(): MedusaCloudflareHttpModuleRuntimeSource {
    this.httpRuntimeSource ??= createMedusaCloudflareHttpModuleRuntimeSource({
      manager: this.manager,
      moduleOptions: this.getCommerceModuleOptions(),
      createSession: this.httpSessionRuntime.hooks.createSession,
      commitSession: this.httpSessionRuntime.hooks.commitSession,
      prepareRequest: prepareHttpProductionProofBearerAuth,
      createRuntime: async ({ manager }) => {
        if (manager !== this.manager) {
          throw new Error(
            "Cloudflare HTTP runtime source used an unexpected manager"
          )
        }

        return await this.getRuntime()
      },
    })

    return this.httpRuntimeSource
  }

  private async getHttpHandler(): Promise<LazyMedusaFetchHttpHandler> {
    this.httpHandler ??= this.getHttpRuntimeSource()
      .getHttpRuntimeOptions()
      .then((options) => createLazyMedusaFetchHttpHandler(options))

    return await this.httpHandler
  }

  private async handleProductionHttpRequest(
    request: Request,
    pathname: string
  ): Promise<Response> {
    const targetUrl = new URL(request.url)
    targetUrl.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`

    const handler = await this.getHttpHandler()

    return await handler.handle(new Request(targetUrl, request))
  }

  private getCommerceModuleOptions() {
    return {
      lockingNamespace: this.lockingNamespace,
      eventQueue: this.eventQueue,
      workflowSchedulerAdapter: cloudflareWorkflowSchedulerAdapter,
      workflowExecutionStore: this.workflowExecutionStore,
      workflowScheduleStore: this.workflowScheduleStore,
      workflowDelayedActionStore: this.workflowDelayedActionStore,
    }
  }
}

interface CartScenarioInput {
  id: string
  currency_code: string
}

async function runHttpProductionOptionsProof(
  runtime: CommerceModulesRuntime,
  options: MedusaFetchHttpRuntimeOptions,
  sessionRuntime: DurableObjectFetchAuthSessionRuntime
): Promise<HttpProductionOptionsProof> {
  if (!options.createRequestScope) {
    throw new Error("Production HTTP options did not include request scope")
  }

  const handler = createLazyMedusaFetchHttpHandler({
    ...options,
    resourcesAfterManifest: [
      ...(options.resourcesAfterManifest ?? []),
      httpProductionSessionProofResources,
    ],
  })
  const requestScope = options.createRequestScope(
    new Request("https://worker.local/admin/plugins")
  )
  const cartService = requestScope.resolve(Modules.CART)
  const createSessionResponse = await handler.handle(
    new Request("https://worker.local/http-production-session-proof", {
      method: "POST",
    })
  )
  const sessionCookie = createSessionResponse.headers.get("set-cookie")
  const readSessionResponse = await handler.handle(
    new Request("https://worker.local/http-production-session-proof", {
      method: "GET",
      headers: {
        cookie: sessionCookie ?? "",
      },
    })
  )
  const readSessionBody = await readSessionResponse.json<{
    actor_id?: string
  }>()
  const destroySessionResponse = await handler.handle(
    new Request("https://worker.local/http-production-session-proof", {
      method: "DELETE",
      headers: {
        cookie: sessionCookie ?? "",
      },
    })
  )
  const currenciesResponse = await handler.handle(
    new Request(
      "https://worker.local/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=0"
    )
  )
  const currenciesBody = await currenciesResponse.json<{
    count?: number
    currencies?: Array<{
      code?: string
      name?: string
      symbol?: string
    }>
    limit?: number
    offset?: number
  }>()
  const firstCurrency = currenciesBody.currencies?.[0]
  const productTypesResponse = await handler.handle(
    new Request(
      "https://worker.local/store/product-types?fields=id,value&value=do-sqlite-type&limit=5&offset=0"
    )
  )
  const productTypesBody = await productTypesResponse.json<{
    count?: number
    limit?: number
    offset?: number
    product_types?: Array<{
      id?: string
      value?: string
    }>
  }>()
  const firstProductType = productTypesBody.product_types?.[0]
  const productTagsResponse = await handler.handle(
    new Request(
      "https://worker.local/store/product-tags?fields=id,value&value=do-sqlite-tag&limit=5&offset=0"
    )
  )
  const productTagsBody = await productTagsResponse.json<{
    count?: number
    limit?: number
    offset?: number
    product_tags?: Array<{
      id?: string
      value?: string
    }>
  }>()
  const firstProductTag = productTagsBody.product_tags?.[0]
  const collectionRelationProof =
    await ensureHttpProductionCollectionRelation(runtime)
  const collectionResponse = await handler.handle(
    new Request(
      `https://worker.local/store/collections/${collectionRelationProof.collectionId}?fields=id,title,products.id,products.title`
    )
  )
  const collectionBody = await collectionResponse.json<{
    collection?: {
      id?: string
      products?: Array<{
        id?: string
        title?: string
      }>
    }
  }>()
  const firstCollectionProduct = collectionBody.collection?.products?.[0]

  return {
    transactionMode: runtime.transactionMode,
    adminPluginsHandled: handler.isPathHandled("/admin/plugins"),
    requestScopeCreated: requestScope !== runtime.container,
    cartServiceResolved: cartService === runtime.cart.service,
    sessionCreateStatus: createSessionResponse.status,
    sessionCookieIssued:
      sessionCookie?.startsWith("connect.sid=do_session_") ?? false,
    sessionReadStatus: readSessionResponse.status,
    sessionActorId: readSessionBody.actor_id ?? "",
    sessionDestroyStatus: destroySessionResponse.status,
    sessionDestroyCookieIssued:
      destroySessionResponse.headers
        .get("set-cookie")
        ?.startsWith("connect.sid=; Path=/; HttpOnly; Max-Age=0") ?? false,
    sessionStoreCountAfterDestroy: sessionRuntime.store.count(),
    remoteQueryCurrencyStatus: currenciesResponse.status,
    remoteQueryCurrencyCode: firstCurrency?.code ?? "",
    remoteQueryCurrencyCount: currenciesBody.count ?? -1,
    remoteQueryCurrencyOffset: currenciesBody.offset ?? -1,
    remoteQueryCurrencyLimit: currenciesBody.limit ?? -1,
    queryGraphProductTypeStatus: productTypesResponse.status,
    queryGraphProductTypeValue: firstProductType?.value ?? "",
    queryGraphProductTypeCount: productTypesBody.count ?? -1,
    queryGraphProductTypeOffset: productTypesBody.offset ?? -1,
    queryGraphProductTypeLimit: productTypesBody.limit ?? -1,
    queryGraphProductTagStatus: productTagsResponse.status,
    queryGraphProductTagValue: firstProductTag?.value ?? "",
    queryGraphProductTagCount: productTagsBody.count ?? -1,
    queryGraphProductTagOffset: productTagsBody.offset ?? -1,
    queryGraphProductTagLimit: productTagsBody.limit ?? -1,
    queryGraphCollectionStatus: collectionResponse.status,
    queryGraphCollectionId: collectionBody.collection?.id ?? "",
    queryGraphCollectionProductId: firstCollectionProduct?.id ?? "",
    queryGraphCollectionProductTitle: firstCollectionProduct?.title ?? "",
  }
}

const httpProductionSessionProofAuthContext: AuthContext = {
  actor_id: "user_http_production_session",
  actor_type: "user",
  auth_identity_id: "auth_http_production_session",
  app_metadata: {},
  user_metadata: {},
}

const httpProductionSessionProofResources: StaticHttpResourceSetInput = {
  routes: [
    {
      isRoute: true,
      matcher: "/http-production-session-proof",
      method: "POST",
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
      handler: (req: MedusaRequest, res: MedusaResponse) => {
        req.session.auth_context = httpProductionSessionProofAuthContext
        res.status(201).json({ ok: true })
      },
    },
    {
      isRoute: true,
      matcher: "/http-production-session-proof",
      method: "GET",
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
      handler: (req: MedusaRequest, res: MedusaResponse) => {
        res.status(200).json({
          actor_id: getSessionActorId(req.session),
        })
      },
    },
    {
      isRoute: true,
      matcher: "/http-production-session-proof",
      method: "DELETE",
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
      handler: (req: MedusaRequest, res: MedusaResponse) => {
        req.session.destroy()
        res.status(200).json({ success: true })
      },
    },
  ] satisfies RouteDescriptor[],
}

function getSessionActorId(session: unknown): string | undefined {
  if (!isRecord(session)) {
    return undefined
  }

  const authContext = session.auth_context
  if (!isRecord(authContext) || typeof authContext.actor_id !== "string") {
    return undefined
  }

  return authContext.actor_id
}

async function runCartScenario(
  runtime: CommerceModulesRuntime,
  cartId?: string
): Promise<CartProof> {
  resetWorkerMemoryAnalytics()
  await ensureCartProofCurrency(runtime)
  const workerWorkflowProof = createWorkerWorkflowProof()
  const apiKey = await runtime.apiKey.service.createApiKeys({
    title: "DO SQLite Publishable API Key",
    type: ApiKeyType.PUBLISHABLE,
    created_by: "worker",
  })
  const apiKeys = await runtime.apiKey.service.listApiKeys({
    id: [apiKey.id],
  })
  const user = await runtime.user.service.createUsers({
    email: "worker-user@example.com",
    first_name: "Worker",
    last_name: "User",
  })
  const users = await runtime.user.service.listUsers({
    id: [user.id],
  })
  await runtime.analytics.service.track({
    event: "worker-cart-proof",
    actor_id: user.id,
    properties: {
      source: "durable-object",
    },
  })
  await runtime.analytics.service.identify({
    actor_id: user.id,
    properties: {
      email: user.email,
    },
  })
  const analyticsSnapshot = getWorkerMemoryAnalyticsSnapshot()
  const firstIdentifiedAnalyticsEvent = analyticsSnapshot.identified[0]
  const workflowTransactionId = `worker-workflow-${user.id}`
  const workflowResult = await runtime.workflowEngine.service.run(
    workerWorkflowProof.getName(),
    {
      input: { value: user.id },
      transactionId: workflowTransactionId,
    }
  )
  const workflowExecutions =
    await runtime.workflowEngine.service.listWorkflowExecutions({
      workflow_id: "worker-workflow-proof",
    })
  const persistedWorkflowExecution =
    await runtime.workflowEngine.executionStore.getPersistedExecution(
      "worker-workflow-proof",
      workflowTransactionId
    )
  const cacheKey = await runtime.caching.service.computeKey({
    scope: "worker-cart-proof",
    user_id: user.id,
  })
  const cacheTags = ["worker-cart-proof", `User:${user.id}`]
  await runtime.caching.service.set({
    key: cacheKey,
    data: {
      value: "worker-cache-value",
      user_id: user.id,
    },
    tags: cacheTags,
  })
  const cachedByKey: unknown = await runtime.caching.service.get({
    key: cacheKey,
  })
  const cachedByTags: unknown = await runtime.caching.service.get({
    tags: ["worker-cart-proof"],
  })
  await runtime.caching.service.clear({
    tags: cacheTags,
  })
  const cachedAfterClear: unknown = await runtime.caching.service.get({
    key: cacheKey,
  })
  const authIdentity = await runtime.auth.service.createAuthIdentities({
    provider_identities: [
      {
        entity_id: "worker-auth@example.com",
        provider: "manual",
      },
    ],
    app_metadata: {
      user_id: user.id,
    },
  })
  const authIdentities = await runtime.auth.service.listAuthIdentities(
    {
      id: [authIdentity.id],
    },
    {
      relations: ["provider_identities"],
    }
  )
  const rbacPolicy = await runtime.rbac.service.createRbacPolicies({
    key: "worker:read",
    resource: "worker",
    operation: "read",
    name: "Worker Read",
    description: "Worker RBAC proof policy",
  })
  const rbacRole = await runtime.rbac.service.createRbacRoles({
    name: "Worker Role",
    description: "Worker RBAC proof role",
  })
  await runtime.rbac.service.createRbacRolePolicies({
    role_id: rbacRole.id,
    policy_id: rbacPolicy.id,
  })
  const rbacRoles = await runtime.rbac.service.listRbacRoles(
    {
      id: rbacRole.id,
    },
    {
      relations: ["policies"],
    }
  )
  const rbacRolePolicies = await runtime.rbac.service.listPoliciesForRole(
    rbacRole.id
  )
  const settingsView =
    await runtime.settings.service.createViewConfigurations({
      entity: "worker_orders",
      name: "Worker Orders View",
      user_id: user.id,
      configuration: {
        visible_columns: ["id", "status"],
        column_order: ["id", "status"],
        filters: {
          status: ["pending"],
        },
        sorting: {
          id: "created_at",
          desc: true,
        },
      },
    })
  const updatedSettingsView =
    await runtime.settings.service.updateViewConfigurations(settingsView.id, {
      configuration: {
        visible_columns: ["id", "total"],
        column_order: ["id", "total"],
        filters: {},
        sorting: null,
      },
    })
  await runtime.settings.service.setUserPreference(
    user.id,
    "active_view.worker_orders",
    {
      viewConfigurationId: updatedSettingsView.id,
    }
  )
  const activeSettingsView =
    await runtime.settings.service.getActiveViewConfiguration(
      "worker_orders",
      user.id
    )
  const file = await runtime.file.service.createFiles({
    filename: "worker-file.txt",
    mimeType: "text/plain",
    content: "worker-file-content",
  })
  const retrievedFile = await runtime.file.service.retrieveFile(file.id)
  const [listedFiles, listedFileCount] =
    await runtime.file.service.listAndCountFiles({
      id: file.id,
    })
  const uploadUrl = await runtime.file.service.getUploadFileUrls({
    filename: "worker-upload.txt",
    mimeType: "text/plain",
  })
  const notification = await runtime.notification.service.createNotifications({
    to: "worker@example.com",
    from: "noreply@example.com",
    channel: "email",
    template: "worker-template",
    data: {
      source: "worker",
    },
    idempotency_key: "worker-notification-key",
  })
  const retrievedNotification =
    await runtime.notification.service.retrieveNotification(notification.id)
  const invite = await runtime.user.service.createInvites({
    email: "worker-invite@example.com",
  })
  const validatedInvite = await runtime.user.service.validateInviteToken(
    invite.token
  )
  const store = await runtime.store.service.createStores({
    name: "DO SQLite Store",
    supported_currencies: [
      { currency_code: "eur", is_default: true },
      { currency_code: "usd" },
    ],
    supported_locales: [{ locale_code: "en-US" }],
  })
  const stores = await runtime.store.service.listStores()
  const [salesChannel] = await runtime.salesChannel.service.createSalesChannels([
    {
      name: "DO SQLite Sales Channel",
      description: "Composed commerce module set proof",
    },
  ])
  const salesChannels =
    await runtime.salesChannel.service.listSalesChannels({
      id: [salesChannel.id],
    })
  const stockLocation =
    await runtime.stockLocation.service.createStockLocations({
      name: "DO SQLite Stock Location",
      address: {
        address_1: "1 Inventory Lane",
        city: "Workerd",
        country_code: "US",
      },
    })
  const stockLocations =
    await runtime.stockLocation.service.listStockLocations(
      { id: [stockLocation.id] },
      { relations: ["address"] }
    )
  const inventoryItem =
    await runtime.inventory.service.createInventoryItems({
      sku: "do-sqlite-inventory-item",
      title: "DO SQLite Inventory Item",
    })
  const inventoryLevel =
    await runtime.inventory.service.createInventoryLevels({
      inventory_item_id: inventoryItem.id,
      location_id: stockLocation.id,
      stocked_quantity: 5,
    })
  const inventoryItems =
    await runtime.inventory.service.listInventoryItems(
      { id: [inventoryItem.id] },
      { select: ["id", "sku"] }
    )
  const inventoryLevels =
    await runtime.inventory.service.listInventoryLevels({
      inventory_item_id: inventoryItem.id,
    })
  const [region] = await runtime.region.service.createRegions([
    {
      name: "DO SQLite Region",
      currency_code: "eur",
      countries: ["us"],
    },
  ])
  const regions = await runtime.region.service.listRegions(
    { id: [region.id] },
    { relations: ["countries"] }
  )
  const customer = await runtime.customer.service.createCustomers({
    email: "worker-customer@example.com",
    first_name: "Worker",
    last_name: "Customer",
    addresses: [
      {
        address_1: "1 Durable Object Way",
        city: "Workerd",
        country_code: "us",
        is_default_shipping: true,
      },
    ],
  })
  const customerGroup = await runtime.customer.service.createCustomerGroups({
    name: "DO SQLite Customers",
  })
  await runtime.customer.service.addCustomerToGroup({
    customer_id: customer.id,
    customer_group_id: customerGroup.id,
  })
  const customersByGroup = await runtime.customer.service.listCustomers(
    { groups: customerGroup.id },
    { relations: ["addresses", "groups"] }
  )
  const product = await runtime.product.service.createProducts({
    title: "DO SQLite Product",
    handle: "do-sqlite-product",
  })
  const productType = await runtime.product.service.createProductTypes({
    value: "do-sqlite-type",
  })
  const productTag = await runtime.product.service.createProductTags({
    value: "do-sqlite-tag",
  })
  const products = await runtime.product.service.listProducts({
    id: [product.id],
  })
  const productTypes = await runtime.product.service.listProductTypes({
    id: [productType.id],
  })
  const productTags = await runtime.product.service.listProductTags({
    id: [productTag.id],
  })
  const productCacheKey = await runtime.caching.service.computeKey(product)
  await runtime.caching.service.set({
    key: productCacheKey,
    data: product,
  })
  await runtime.eventBus.service.emit({
    name: "product.updated",
    data: { id: product.id },
  })
  await waitForEventBus()
  const productCacheAfterEvent: unknown = await runtime.caching.service.get({
    key: productCacheKey,
  })
  let lockingStock = 3
  const lockingSales = await Promise.all(
    Array.from({ length: 8 }, () =>
      runtime.locking.service.execute("worker-stock-lock", async () => {
        const hasStock = lockingStock > 0
        await waitForEventBus()
        if (hasStock) {
          lockingStock--
          return true
        }

        return false
      })
    )
  )
  const translationLocales = await runtime.translation.service.listLocales({
    code: "en-US",
  })
  let productTranslatableFields =
    (await runtime.translation.service.getTranslatableFields("product"))
      .product ?? []
  if (!productTranslatableFields.includes("title")) {
    const [existingProductTranslationSettings] =
      await runtime.translation.service.listTranslationSettings({
        entity_type: "product",
      })

    if (existingProductTranslationSettings) {
      await runtime.translation.service.updateTranslationSettings({
        id: existingProductTranslationSettings.id,
        entity_type: "product",
        fields: ["title", "description"],
        is_active: true,
      })
    } else {
      await runtime.translation.service.createTranslationSettings({
        entity_type: "product",
        fields: ["title", "description"],
        is_active: true,
      })
    }

    productTranslatableFields =
      (await runtime.translation.service.getTranslatableFields("product"))
        .product ?? []
  }
  const translation = await runtime.translation.service.createTranslations({
    reference_id: product.id,
    reference: "product",
    locale_code: "en-US",
    translations: {
      title: "Worker Translated Product",
      ignored_field: "Filtered out",
    },
  })
  const translationSearch =
    await runtime.translation.service.listTranslations({
      reference_id: product.id,
      q: "translated product",
    })
  const [translationList, translationCount] =
    await runtime.translation.service.listAndCountTranslations({
      reference_id: product.id,
      q: "translated product",
    })
  const translationStats = await runtime.translation.service.getStatistics({
    locales: ["en-US"],
    entities: {
      product: { count: 1 },
    },
  })
  const firstTranslation = translationSearch[0]
  const firstTranslationTranslations = isRecord(
    firstTranslation?.translations
  )
    ? firstTranslation.translations
    : {}
  const priceSet = await runtime.pricing.service.createPriceSets({
    prices: [
      {
        amount: 123,
        currency_code: "usd",
      },
    ],
  })
  const calculatedPrices = await runtime.pricing.service.calculatePrices(
    { id: [priceSet.id] },
    { context: { currency_code: "usd" } }
  )
  const calculatedPrice = calculatedPrices[0]
  if (!calculatedPrice || calculatedPrice.calculated_amount !== 123) {
    throw new Error("Pricing proof did not calculate the expected USD price")
  }
  const taxRegion = await runtime.tax.service.createTaxRegions({
    country_code: "GB",
    default_tax_rate: {
      name: "DO SQLite Tax Rate",
      rate: 20,
      code: "DO-TAX",
    },
  })
  const taxRegions = await runtime.tax.service.listTaxRegions({
    id: [taxRegion.id],
  })
  const taxRates = await runtime.tax.service.listTaxRates({
    tax_region_id: taxRegion.id,
  })
  const fulfillmentProviderWriter = fulfillmentProviderWritable(
    runtime.fulfillment.service
  )
  const fulfillmentProvider =
    await fulfillmentProviderWriter.createFulfillmentProviders({
      id: "fp_do_sqlite",
      is_enabled: true,
    })
  const shippingProfile =
    await runtime.fulfillment.service.createShippingProfiles({
      name: "DO SQLite Shipping Profile",
      type: "default",
    })
  const fulfillmentSet =
    await runtime.fulfillment.service.createFulfillmentSets({
      name: "DO SQLite Fulfillment Set",
      type: "shipping",
      service_zones: [
        {
          name: "DO SQLite Service Zone",
          geo_zones: [
            {
              type: "country",
              country_code: "US",
            },
          ],
        },
      ],
    })
  const serviceZone = fulfillmentSet.service_zones[0]
  if (!serviceZone) {
    throw new Error("Fulfillment proof did not create a service zone")
  }
  const shippingOption =
    await runtime.fulfillment.service.createShippingOptions({
      name: "DO SQLite Shipping Option",
      price_type: ShippingOptionPriceType.FLAT,
      service_zone_id: serviceZone.id,
      shipping_profile_id: shippingProfile.id,
      provider_id: fulfillmentProvider.id,
      type: {
        label: "DO SQLite Delivery",
        code: "do-sqlite-delivery",
        description: "Worker static Fulfillment proof",
      },
      data: {},
    })
  const fulfillmentSets =
    await runtime.fulfillment.service.listFulfillmentSets(
      { id: [fulfillmentSet.id] },
      { relations: ["service_zones.geo_zones"] }
    )
  const shippingOptions =
    await runtime.fulfillment.service.listShippingOptions(
      { id: [shippingOption.id] },
      { relations: ["type", "shipping_profile", "service_zone"] }
    )
  const paymentProviders = await runtime.payment.service.listPaymentProviders({
    id: ["pp_system_default"],
  })
  if (paymentProviders.length !== 1 || !paymentProviders[0].is_enabled) {
    throw new Error("Payment proof did not seed the system payment provider")
  }
  const paymentCollection =
    await runtime.payment.service.createPaymentCollections({
      amount: 200,
      currency_code: "usd",
    })
  const paymentSession = await runtime.payment.service.createPaymentSession(
    paymentCollection.id,
    {
      provider_id: "pp_system_default",
      amount: 100,
      currency_code: "usd",
      data: {},
      context: {
        customer: { id: customer.id, email: customer.email },
      },
    }
  )
  const authorizedPayment =
    await runtime.payment.service.authorizePaymentSession(
      paymentSession.id,
      {}
    )
  const capturedPayment = await runtime.payment.service.capturePayment({
    payment_id: authorizedPayment.id,
  })
  const paymentCollections =
    await runtime.payment.service.listPaymentCollections({
      id: [paymentCollection.id],
    })
  const [createdOrder] = await runtime.order.service.createOrders([
    {
      currency_code: "usd",
      email: customer.email,
      customer_id: customer.id,
      sales_channel_id: salesChannel.id,
      shipping_address: {
        first_name: "Worker",
        last_name: "Customer",
        address_1: "1 Durable Object Way",
        city: "Workerd",
        country_code: "us",
      },
      billing_address: {
        first_name: "Worker",
        last_name: "Customer",
        address_1: "1 Durable Object Way",
        city: "Workerd",
        country_code: "us",
      },
      items: [
        {
          title: "DO SQLite order item",
          quantity: 1,
          unit_price: 100,
        },
      ],
      shipping_methods: [
        {
          name: "DO SQLite order shipping",
          amount: 10,
        },
      ],
      transactions: [
        {
          amount: 110,
          currency_code: "usd",
          reference: "payment",
          reference_id: capturedPayment.id,
        },
      ],
    },
  ])
  const order = await runtime.order.service.retrieveOrder(createdOrder.id, {
    relations: [
      "billing_address",
      "items",
      "shipping_address",
      "shipping_methods",
      "transactions",
    ],
  })
  const promotion = await runtime.promotion.service.createPromotions({
    code: "DO_SQLITE_PROMOTION",
    type: PromotionType.STANDARD,
    status: PromotionStatus.ACTIVE,
    is_automatic: false,
    application_method: {
      type: ApplicationMethodType.FIXED,
      target_type: ApplicationMethodTargetType.ITEMS,
      allocation: ApplicationMethodAllocation.EACH,
      value: 10,
      currency_code: "eur",
      max_quantity: 1,
    },
  })
  const promotions = await runtime.promotion.service.listPromotions(
    { id: [promotion.id] },
    { relations: ["application_method"] }
  )
  const cartInput: CartScenarioInput = {
    id: cartId?.startsWith("cart_") ? cartId : `cart_${Date.now()}`,
    currency_code: "eur",
  }
  const [cart] = await runtime.cart.service.createCarts([cartInput])
  const items = await runtime.cart.service.addLineItems(cart.id, [
    {
      quantity: 2,
      unit_price: 150,
      title: "DO SQLite item",
    },
  ])
  const shippingMethods = await runtime.cart.service.addShippingMethods(
    cart.id,
    [
      {
        amount: 25,
        name: "DO SQLite shipping",
      },
    ]
  )
  const lineItemAdjustments =
    await runtime.cart.service.setLineItemAdjustments(cart.id, [
      {
        item_id: items[0].id,
        amount: 30,
        code: "DO-LINE-DISCOUNT",
      },
    ])
  const lineItemTaxLines = await runtime.cart.service.setLineItemTaxLines(
    cart.id,
    [
      {
        item_id: items[0].id,
        rate: 10,
        code: "DO-LINE-TAX",
      },
    ]
  )
  const shippingMethodAdjustments =
    await runtime.cart.service.setShippingMethodAdjustments(cart.id, [
      {
        shipping_method_id: shippingMethods[0].id,
        amount: 5,
        code: "DO-SHIPPING-DISCOUNT",
      },
    ])
  const shippingMethodTaxLines =
    await runtime.cart.service.setShippingMethodTaxLines(cart.id, [
      {
        shipping_method_id: shippingMethods[0].id,
        rate: 10,
        code: "DO-SHIPPING-TAX",
      },
    ])
  const cartWithTotals = await runtime.cart.service.retrieveCart(cart.id, {
    select: ["total"],
  })
  const serialized: unknown = JSON.parse(JSON.stringify(cartWithTotals))
  if (!isCartTotalsResult(serialized)) {
    throw new Error(
      "Cart totals response did not serialize to the expected shape"
    )
  }

  return {
    id: cart.id,
    apiKeyId: apiKey.id,
    apiKeyCount: apiKeys.length,
    apiKeyTokenPrefix: apiKey.token.slice(0, 3),
    userId: user.id,
    userCount: users.length,
    analyticsTrackCount: analyticsSnapshot.tracked.length,
    analyticsIdentifyCount: analyticsSnapshot.identified.length,
    analyticsTrackedEvent: analyticsSnapshot.tracked[0]?.event ?? "",
    analyticsIdentifiedActor:
      firstIdentifiedAnalyticsEvent &&
      "actor_id" in firstIdentifiedAnalyticsEvent
        ? firstIdentifiedAnalyticsEvent.actor_id ?? ""
        : "",
    workflowEngineProvider: "inmemory",
    workflowId: workflowResult.acknowledgement.workflowId,
    workflowTransactionFinished: workflowResult.acknowledgement.hasFinished,
    workflowExecutionCount: workflowExecutions.length,
    workflowExecutionPersisted: persistedWorkflowExecution !== undefined,
    workflowExecutionStoreState: persistedWorkflowExecution?.state ?? "",
    cachingKeyLength: cacheKey.length,
    cachingValue: isCacheValue(cachedByKey) ? cachedByKey.value : "",
    cachingTagResultCount: Array.isArray(cachedByTags)
      ? cachedByTags.length
      : 0,
    cachingCleared: cachedAfterClear === null,
    authIdentityId: authIdentity.id,
    authIdentityCount: authIdentities.length,
    authProviderIdentityCount:
      authIdentities[0]?.provider_identities?.length ?? 0,
    authProvider: authIdentities[0]?.provider_identities?.[0]?.provider ?? "",
    rbacRoleId: rbacRole.id,
    rbacPolicyId: rbacPolicy.id,
    rbacRolePolicyCount: rbacRolePolicies.length,
    rbacRoleRelationPolicyCount: rbacRoles[0]?.policies?.length ?? 0,
    rbacPolicyKey: rbacRolePolicies[0]?.key ?? "",
    settingsViewId: updatedSettingsView.id,
    settingsFilterCount: Object.keys(
      updatedSettingsView.configuration.filters ?? {}
    ).length,
    settingsSortingIsNull: updatedSettingsView.configuration.sorting === null,
    settingsActiveViewId: activeSettingsView?.id ?? "",
    fileId: file.id,
    fileUrl: file.url,
    retrievedFileUrl: retrievedFile.url,
    listedFileCount,
    listedFileUrl: listedFiles[0]?.url ?? "",
    uploadFileKey: uploadUrl.key,
    uploadFileUrl: uploadUrl.url,
    notificationId: notification.id,
    notificationProviderId: notification.provider_id ?? "",
    notificationExternalId: notification.external_id ?? "",
    notificationStatus: notification.status,
    retrievedNotificationStatus: retrievedNotification.status,
    inviteId: invite.id,
    inviteEmail: validatedInvite.email,
    inviteTokenPartCount: invite.token.split(".").length,
    storeId: store.id,
    storeCount: stores.length,
    storeCurrencyCount: store.supported_currencies?.length ?? 0,
    storeLocaleCount: store.supported_locales?.length ?? 0,
    regionId: region.id,
    regionCount: regions.length,
    regionCountryCount: regions[0]?.countries?.length ?? 0,
    customerId: customer.id,
    customerGroupId: customerGroup.id,
    customerGroupFilterCount: customersByGroup.length,
    customerAddressCount: customersByGroup[0]?.addresses?.length ?? 0,
    customerGroupCount: customersByGroup[0]?.groups?.length ?? 0,
    productId: product.id,
    productCount: products.length,
    productTypeId: productType.id,
    productTypeCount: productTypes.length,
    productTagId: productTag.id,
    productTagCount: productTags.length,
    eventBusProvider: "cloudflare-queue",
    productCacheInvalidatedByEvent: productCacheAfterEvent === null,
    lockingProvider: "cloudflare-durable-object",
    lockingSuccessfulSales: lockingSales.filter(Boolean).length,
    lockingRemainingStock: lockingStock,
    translationLocaleCount: translationLocales.length,
    translationId: translation.id,
    translationSearchCount: translationSearch.length,
    translationListCount: translationList.length,
    translationCount,
    translationTitle:
      typeof firstTranslationTranslations.title === "string"
        ? firstTranslationTranslations.title
        : "",
    translationIgnoredFieldVisible:
      "ignored_field" in firstTranslationTranslations,
    translationStatisticsExpected: translationStats.product?.expected ?? 0,
    translationStatisticsTranslated:
      translationStats.product?.translated ?? 0,
    translationProductFieldCount: productTranslatableFields.length,
    priceSetId: priceSet.id,
    calculatedPriceAmount: calculatedPrice.calculated_amount,
    taxRegionId: taxRegion.id,
    taxRegionCount: taxRegions.length,
    taxRateCount: taxRates.length,
    fulfillmentProviderId: fulfillmentProvider.id,
    fulfillmentSetId: fulfillmentSet.id,
    fulfillmentSetCount: fulfillmentSets.length,
    fulfillmentServiceZoneCount:
      fulfillmentSets[0]?.service_zones?.length ?? 0,
    fulfillmentGeoZoneCount:
      fulfillmentSets[0]?.service_zones?.[0]?.geo_zones?.length ?? 0,
    shippingProfileId: shippingProfile.id,
    shippingOptionId: shippingOption.id,
    shippingOptionCount: shippingOptions.length,
    paymentProviderCount: paymentProviders.length,
    paymentCollectionId: paymentCollection.id,
    paymentCollectionCount: paymentCollections.length,
    paymentSessionId: paymentSession.id,
    paymentId: capturedPayment.id,
    paymentCaptureCount: capturedPayment.captures?.length ?? 0,
    orderId: order.id,
    orderDisplayId: order.display_id,
    orderItemCount: order.items?.length ?? 0,
    orderShippingMethodCount: order.shipping_methods?.length ?? 0,
    orderTransactionCount: order.transactions?.length ?? 0,
    orderHasBillingAddress: Boolean(order.billing_address),
    orderHasShippingAddress: Boolean(order.shipping_address),
    promotionId: promotion.id,
    promotionCount: promotions.length,
    promotionApplicationMethodValue:
      Number(promotions[0]?.application_method?.value) || 0,
    salesChannelId: salesChannel.id,
    salesChannelCount: salesChannels.length,
    stockLocationId: stockLocation.id,
    stockLocationCount: stockLocations.length,
    stockLocationAddressCount: stockLocations[0]?.address ? 1 : 0,
    inventoryItemId: inventoryItem.id,
    inventoryItemCount: inventoryItems.length,
    inventoryLevelId: inventoryLevel.id,
    inventoryLevelCount: inventoryLevels.length,
    inventoryStockedQuantity: inventoryLevels[0]?.stocked_quantity ?? 0,
    inventoryReservedQuantity: inventoryLevels[0]?.reserved_quantity ?? 0,
    itemCount: items.length,
    shippingMethodCount: shippingMethods.length,
    lineItemAdjustmentCount: lineItemAdjustments.length,
    lineItemTaxLineCount: lineItemTaxLines.length,
    shippingMethodAdjustmentCount: shippingMethodAdjustments.length,
    shippingMethodTaxLineCount: shippingMethodTaxLines.length,
    total: serialized.total,
    rawTotal: serialized.raw_total.value,
    transactionMode: runtime.cart.transactionMode,
  }
}

async function ensureCartProofCurrency(
  runtime: CommerceModulesRuntime
): Promise<void> {
  const existing = await runtime.currency.service.listCurrencies({
    code: ["usd"],
  })
  if (existing.length > 0) {
    return
  }

  await runtime.currency.service.createCurrencies({
    code: "usd",
    symbol: "$",
    symbol_native: "$",
    name: "US Dollar",
  })
}

async function ensureHttpProductionCollectionRelation(
  runtime: CommerceModulesRuntime
): Promise<{
  collectionId: string
}> {
  const handle = "http-production-relation-collection"
  const existing = await runtime.product.service.listProductCollections(
    { handle },
    { relations: ["products"] }
  )
  const existingProduct = existing[0]?.products?.[0]

  if (existing[0] && existingProduct) {
    return {
      collectionId: existing[0].id,
    }
  }

  const product = await runtime.product.service.createProducts({
    title: "HTTP Production Relation Product",
    handle: `http-production-relation-product-${Date.now()}`,
  })
  const collection =
    existing[0] ??
    (await runtime.product.service.createProductCollections({
      title: "HTTP Production Relation Collection",
      handle,
    }))

  await runtime.product.service.updateProductCollections(collection.id, {
    product_ids: [product.id],
  })

  return {
    collectionId: collection.id,
  }
}

function createWorkerWorkflowProof() {
  const workerWorkflowProofStep = createStep(
    "worker-workflow-proof-step",
    async (input: { value: string }) => {
      return new StepResponse({
        value: input.value,
        marker: "workflow-engine-inmemory",
      })
    }
  )

  return createWorkflow(
    {
      name: "worker-workflow-proof",
      retentionTime: 60,
    },
    (input: { value: string }) => {
      const output = workerWorkflowProofStep(input)

      return new WorkflowResponse(output)
    }
  )
}

function createWorkerScheduledWorkflowProof(jobId: string) {
  const workerScheduledWorkflowProofStep = createStep(
    "worker-scheduled-workflow-proof-step",
    async (input?: { value?: string }) => {
      return new StepResponse({
        value: input?.value ?? "scheduled",
        marker: "scheduled-workflow-store",
      })
    }
  )

  return createWorkflow(
    {
      name: jobId,
      retentionTime: 60,
    },
    (input: { value: string }) => {
      const output = workerScheduledWorkflowProofStep(input)

      return new WorkflowResponse(output)
    }
  )
}

function createWorkerDelayedActionRetryProof(workflowId: string) {
  let attemptCount = 0
  const workerDelayedActionRetryStep = createStep(
    {
      name: `${workflowId}-retry-step`,
      retryInterval: 0.1,
      maxRetries: 2,
    },
    async (input: { value: string }) => {
      attemptCount++

      if (attemptCount === 1) {
        throw new Error("worker delayed action retry proof")
      }

      return new StepResponse({
        value: input.value,
        marker: "workflow-delayed-action-store",
        attempts: attemptCount,
      })
    }
  )

  const workflow = createWorkflow(
    {
      name: workflowId,
      retentionTime: 60,
    },
    (input: { value: string }) => {
      const output = workerDelayedActionRetryStep(input)

      return new WorkflowResponse(output)
    }
  )

  return {
    workflow,
    getAttemptCount: () => attemptCount,
  }
}

function createWorkerStepTimeoutProof(workflowId: string) {
  let stepInvocationCount = 0
  const workerStepTimeoutStep = createStep(
    {
      name: `${workflowId}-step-timeout-step`,
      async: true,
      timeout: 0.1,
    },
    async (_input: { value: string }) => {
      stepInvocationCount++
      return undefined
    }
  )

  const workflow = createWorkflow(
    {
      name: workflowId,
      idempotent: true,
      retentionTime: 60,
    },
    (input: { value: string }) => {
      const output = workerStepTimeoutStep(input)

      return new WorkflowResponse(output)
    }
  )

  return {
    workflow,
    getStepInvocationCount: () => stepInvocationCount,
  }
}

function createWorkerTransactionTimeoutProof(workflowId: string) {
  let stepInvocationCount = 0
  const workerTransactionTimeoutStep = createStep(
    `${workflowId}-transaction-timeout-step`,
    async (_input: { value: string }) => {
      stepInvocationCount++
      return undefined
    }
  )

  const workflow = createWorkflow(
    {
      name: workflowId,
      timeout: 0.1,
      idempotent: true,
      retentionTime: 60,
    },
    (input: { value: string }) => {
      const output = workerTransactionTimeoutStep(input).config({
        async: true,
      })

      return new WorkflowResponse(output)
    }
  )

  return {
    workflow,
    getStepInvocationCount: () => stepInvocationCount,
  }
}

async function runRollbackProof(
  runtime: CartModuleRuntime,
  manager: ReturnType<typeof createDurableObjectSqliteManager>
): Promise<CartRollbackProof> {
  let cartId: string | undefined
  let visibleInsideTransaction = false

  try {
    await manager.transaction(async (transactionManager) => {
      const context: Context = { transactionManager }
      const [cart] = await runtime.service.createCarts(
        [{ currency_code: "eur" }],
        context
      )
      cartId = cart.id
      await runtime.service.addLineItems(
        cart.id,
        [
          {
            quantity: 1,
            unit_price: 50,
            title: "Rollback item",
          },
        ],
        context
      )
      visibleInsideTransaction =
        (await runtime.service.listCarts({ id: [cart.id] }, {}, context))
          .length === 1
      throw new Error("cart rollback proof")
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "cart rollback proof") {
      throw error
    }
  }

  const persisted = cartId
    ? await runtime.service.listCarts({ id: [cartId] })
    : []

  return {
    transactionMode: manager.transactionMode,
    visibleInsideTransaction,
    rolledBack: persisted.length === 0,
  }
}

async function runWorkflowScheduleStoreProof(
  workflowScheduleStore: DurableObjectWorkflowScheduleStore
): Promise<WorkflowScheduleStoreProof> {
  const jobId = `worker-schedule-proof-${Date.now()}`

  try {
    const scheduledWorkflow = createWorkerScheduledWorkflowProof(jobId)
    const registeredWorkflow = WorkflowManager.getWorkflow(jobId)
    if (!registeredWorkflow) {
      throw new Error(`Scheduled workflow ${jobId} was not registered`)
    }

    const workflowWithSchedule = {
      ...registeredWorkflow,
      options: {
        ...registeredWorkflow.options,
        schedule: {
          interval: 60_000,
          numberOfExecutions: 1,
        },
      },
    }
    const scheduler = new WorkflowScheduler()

    await scheduler.scheduleWorkflow(workflowWithSchedule)

    const persistedBeforeRemove =
      await workflowScheduleStore.getPersistedSchedule(jobId)
    const runtimeBeforeRemove = await workflowScheduleStore.get(jobId)

    await scheduler.clearWorkflow(workflowWithSchedule)
    WorkflowManager.unregister(jobId)

    const persistedAfterRemove =
      await workflowScheduleStore.getPersistedSchedule(jobId)
    const runtimeAfterRemove = await workflowScheduleStore.get(jobId)

    return {
      jobId,
      scheduledWorkflowName: scheduledWorkflow.getName(),
      persistedBeforeRemove: persistedBeforeRemove !== undefined,
      runtimeBeforeRemove: runtimeBeforeRemove !== undefined,
      expressionType: persistedBeforeRemove?.expressionType,
      interval: persistedBeforeRemove?.expressionValue,
      numberOfExecutions: persistedBeforeRemove?.numberOfExecutions,
      configNumberOfExecutions:
        persistedBeforeRemove?.config.numberOfExecutions,
      persistedAfterRemove: persistedAfterRemove !== undefined,
      runtimeAfterRemove: runtimeAfterRemove !== undefined,
    }
  } finally {
    WorkflowManager.unregister(jobId)
  }
}

async function runWorkflowScheduleAlarmRecoveryProof(
  runtime: CommerceModulesRuntime,
  workflowScheduleStore: DurableObjectWorkflowScheduleStore
): Promise<WorkflowScheduleAlarmRecoveryProof> {
  const jobId = `worker-schedule-alarm-proof-${Date.now()}`
  const scheduler = new WorkflowScheduler()

  try {
    const scheduledWorkflow = createWorkerScheduledWorkflowProof(jobId)
    const registeredWorkflow = WorkflowManager.getWorkflow(jobId)
    if (!registeredWorkflow) {
      throw new Error(`Scheduled workflow ${jobId} was not registered`)
    }

    const workflowWithSchedule = {
      ...registeredWorkflow,
      options: {
        ...registeredWorkflow.options,
        schedule: {
          interval: 60_000,
          numberOfExecutions: 1,
        },
      },
    }

    await scheduler.scheduleWorkflow(workflowWithSchedule)

    const persistedBeforeRecovery =
      await workflowScheduleStore.getPersistedSchedule(jobId)
    if (!persistedBeforeRecovery) {
      throw new Error(`Scheduled workflow ${jobId} was not persisted`)
    }

    const alarmBeforeRecovery = await workflowScheduleStore.getScheduledAlarm()

    workflowScheduleStore.clearRuntimeSchedules()
    const runtimeAfterClear = await workflowScheduleStore.get(jobId)

    const recovery =
      await runtime.workflowEngine.service.recoverDueSchedules(
        persistedBeforeRecovery.nextExecutionAt
      )
    const executionsAfterRecovery =
      await runtime.workflowEngine.service.listWorkflowExecutions({
        workflow_id: jobId,
      })
    const persistedAfterRecovery =
      await workflowScheduleStore.getPersistedSchedule(jobId)

    await workflowScheduleStore.delete(jobId)
    WorkflowManager.unregister(jobId)

    const alarmAfterCleanup = await workflowScheduleStore.getScheduledAlarm()
    const persistedAfterCleanup =
      await workflowScheduleStore.getPersistedSchedule(jobId)

    return {
      jobId,
      scheduledWorkflowName: scheduledWorkflow.getName(),
      alarmScheduledBeforeRecovery: alarmBeforeRecovery !== null,
      alarmMatchesNextExecution:
        alarmBeforeRecovery === persistedBeforeRecovery.nextExecutionAt,
      runtimeScheduleMissingBeforeRecovery: runtimeAfterClear === undefined,
      dueCount: recovery.dueCount,
      recoveredJobCount: recovery.recoveredJobIds.length,
      recoveredJobId: recovery.recoveredJobIds[0],
      skippedRuntimeJobCount: recovery.skippedRuntimeJobIds.length,
      workflowExecutionCount: executionsAfterRecovery.length,
      persistedExecutionCount:
        persistedAfterRecovery?.numberOfExecutions ?? null,
      alarmClearedAfterCleanup: alarmAfterCleanup === null,
      persistedAfterCleanup: persistedAfterCleanup !== undefined,
    }
  } finally {
    await workflowScheduleStore.delete(jobId)
    WorkflowManager.unregister(jobId)
  }
}

async function runWorkflowExecutionCleanerProof(
  runtime: CommerceModulesRuntime
): Promise<WorkflowExecutionCleanerProof> {
  const workflowId = `worker-execution-cleaner-proof-${Date.now()}`
  const expiredDoneTransactionId = `${workflowId}-expired-done`
  const expiredFailedTransactionId = `${workflowId}-expired-failed`
  const notExpiredTransactionId = `${workflowId}-not-expired`
  const runningTransactionId = `${workflowId}-running`
  const expiredUpdatedAt = Date.now() - 2_000
  const notExpiredUpdatedAt = Date.now()

  await runtime.workflowEngine.executionStore.save({
    workflow_id: workflowId,
    transaction_id: expiredDoneTransactionId,
    run_id: "expired-done-run",
    execution: { marker: "expired-done" },
    context: { data: {}, errors: [] },
    state: "done",
    retention_time: 1,
    updated_at: expiredUpdatedAt,
  })
  await runtime.workflowEngine.executionStore.save({
    workflow_id: workflowId,
    transaction_id: expiredFailedTransactionId,
    run_id: "expired-failed-run",
    execution: { marker: "expired-failed" },
    context: { data: {}, errors: [] },
    state: "failed",
    retention_time: 1,
    updated_at: expiredUpdatedAt,
  })
  await runtime.workflowEngine.executionStore.save({
    workflow_id: workflowId,
    transaction_id: notExpiredTransactionId,
    run_id: "not-expired-run",
    execution: { marker: "not-expired" },
    context: { data: {}, errors: [] },
    state: "done",
    retention_time: 60,
    updated_at: notExpiredUpdatedAt,
  })
  await runtime.workflowEngine.executionStore.save({
    workflow_id: workflowId,
    transaction_id: runningTransactionId,
    run_id: "running-run",
    execution: { marker: "running" },
    context: { data: {}, errors: [] },
    state: "invoking",
    retention_time: 1,
    updated_at: expiredUpdatedAt,
  })

  const expirableBefore = (
    await runtime.workflowEngine.executionStore.listExpirableFinished()
  ).filter((execution) => execution.workflow_id === workflowId)

  await runtime.workflowEngine.service.clearExpiredExecutions()

  const expirableAfter = (
    await runtime.workflowEngine.executionStore.listExpirableFinished()
  ).filter((execution) => execution.workflow_id === workflowId)

  const expiredDone =
    await runtime.workflowEngine.executionStore.getPersistedExecution(
      workflowId,
      expiredDoneTransactionId
    )
  const expiredFailed =
    await runtime.workflowEngine.executionStore.getPersistedExecution(
      workflowId,
      expiredFailedTransactionId
    )
  const notExpired =
    await runtime.workflowEngine.executionStore.getPersistedExecution(
      workflowId,
      notExpiredTransactionId
    )
  const running =
    await runtime.workflowEngine.executionStore.getPersistedExecution(
      workflowId,
      runningTransactionId
    )
  const remainingExecutions =
    await runtime.workflowEngine.service.listWorkflowExecutions({
      workflow_id: workflowId,
    })

  return {
    workflowId,
    expirableBeforeCount: expirableBefore.length,
    expirableAfterCount: expirableAfter.length,
    deletedExpiredFinishedCount: [expiredDone, expiredFailed].filter(
      (execution) => execution !== undefined && execution.deletedAt !== null
    ).length,
    expiredDoneDeleted:
      expiredDone !== undefined && expiredDone.deletedAt !== null,
    expiredFailedDeleted:
      expiredFailed !== undefined && expiredFailed.deletedAt !== null,
    notExpiredFinishedPreserved: notExpired?.deletedAt === null,
    expiredRunningPreserved: running?.deletedAt === null,
    remainingExecutionCount: remainingExecutions.length,
    remainingTransactionIds: remainingExecutions
      .map((execution) => execution.transaction_id)
      .sort(),
  }
}

async function runWorkflowDelayedActionAlarmRecoveryProof(
  runtime: CommerceModulesRuntime,
  workflowDelayedActionStore: DurableObjectWorkflowDelayedActionStore
): Promise<WorkflowDelayedActionAlarmRecoveryProof> {
  const workflowId = `worker-delayed-action-proof-${Date.now()}`
  const transactionId = `${workflowId}-transaction`

  try {
    const delayedWorkflow = createWorkerDelayedActionRetryProof(workflowId)

    await runtime.workflowEngine.service.run(workflowId, {
      input: {
        value: "delayed-action",
      },
      transactionId,
      throwOnError: false,
      logOnError: true,
    })

    const pendingActions = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(([, action]) => action.workflowId === workflowId)
    const pendingAction = pendingActions[0]?.[1]
    if (!pendingAction) {
      throw new Error(
        `Delayed action for workflow ${workflowId} was not persisted`
      )
    }

    const persistedBeforeRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const alarmBeforeRecovery =
      await workflowDelayedActionStore.getScheduledAlarm()

    workflowDelayedActionStore.clearRuntimeHandlers()
    await sleep(120)

    const recovery =
      await runtime.workflowEngine.service.recoverDueDelayedActions(
        pendingAction.dueAt
      )
    const executionsAfterRecovery =
      await runtime.workflowEngine.service.listWorkflowExecutions({
        workflow_id: workflowId,
      })
    const persistedAfterRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const pendingAfterRecovery = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(([, action]) => action.workflowId === workflowId)

    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)

    const alarmAfterCleanup =
      await workflowDelayedActionStore.getScheduledAlarm()
    const persistedAfterCleanup =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )

    return {
      workflowId,
      workflowName: delayedWorkflow.workflow.getName(),
      transactionId,
      actionId: pendingAction.id,
      actionKind: pendingAction.kind,
      alarmScheduledBeforeRecovery: alarmBeforeRecovery !== null,
      alarmMatchesDueAt: alarmBeforeRecovery === pendingAction.dueAt,
      persistedBeforeRecovery: persistedBeforeRecovery !== undefined,
      dueCount: recovery.dueCount,
      recoveredActionCount: recovery.recoveredActionIds.length,
      recoveredActionId: recovery.recoveredActionIds[0],
      failedActionCount: recovery.failedActionIds.length,
      recoveredByManualCall: recovery.recoveredActionIds.includes(
        pendingAction.id
      ),
      recoveredByDurableObjectAlarm:
        recovery.dueCount === 0 && delayedWorkflow.getAttemptCount() === 2,
      attemptCount: delayedWorkflow.getAttemptCount(),
      workflowExecutionCount: executionsAfterRecovery.length,
      handledAfterRecovery:
        persistedAfterRecovery?.handledAt !== undefined &&
        persistedAfterRecovery.handledAt !== null,
      pendingAfterRecovery: pendingAfterRecovery.length,
      alarmClearedAfterCleanup: alarmAfterCleanup === null,
      persistedAfterCleanup: persistedAfterCleanup !== undefined,
    }
  } finally {
    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)
  }
}

async function runWorkflowStepTimeoutAlarmRecoveryProof(
  runtime: CommerceModulesRuntime,
  workflowDelayedActionStore: DurableObjectWorkflowDelayedActionStore
): Promise<WorkflowStepTimeoutAlarmRecoveryProof> {
  const workflowId = `worker-step-timeout-proof-${Date.now()}`
  const transactionId = `${workflowId}-transaction`

  try {
    const timeoutWorkflow = createWorkerStepTimeoutProof(workflowId)

    await runtime.workflowEngine.service.run(workflowId, {
      input: {
        value: "step-timeout",
      },
      transactionId,
      throwOnError: false,
      logOnError: true,
    })

    const pendingActions = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(
      ([, action]) =>
        action.workflowId === workflowId && action.kind === "step-timeout"
    )
    const pendingAction = pendingActions[0]?.[1]
    if (!pendingAction) {
      throw new Error(
        `Step-timeout delayed action for workflow ${workflowId} was not persisted`
      )
    }

    const persistedBeforeRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const alarmBeforeRecovery =
      await workflowDelayedActionStore.getScheduledAlarm()

    workflowDelayedActionStore.clearRuntimeHandlers()
    await sleep(120)

    const recovery =
      await runtime.workflowEngine.service.recoverDueDelayedActions(
        pendingAction.dueAt
      )
    const runResult: unknown = await runtime.workflowEngine.service.run(
      workflowId,
      {
        input: {
          value: "step-timeout",
        },
        transactionId,
        throwOnError: false,
        logOnError: true,
      }
    )
    const outcome = readWorkflowRunOutcome(runResult)
    const executionsAfterRecovery =
      await runtime.workflowEngine.service.listWorkflowExecutions({
        workflow_id: workflowId,
      })
    const persistedAfterRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const pendingAfterRecovery = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(([, action]) => action.workflowId === workflowId)

    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)

    const alarmAfterCleanup =
      await workflowDelayedActionStore.getScheduledAlarm()
    const persistedAfterCleanup =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )

    return {
      workflowId,
      workflowName: timeoutWorkflow.workflow.getName(),
      transactionId,
      actionId: pendingAction.id,
      actionKind: "step-timeout",
      stepId: pendingAction.stepId,
      alarmScheduledBeforeRecovery: alarmBeforeRecovery !== null,
      alarmMatchesDueAt: alarmBeforeRecovery === pendingAction.dueAt,
      persistedBeforeRecovery: persistedBeforeRecovery !== undefined,
      dueCount: recovery.dueCount,
      recoveredActionCount: recovery.recoveredActionIds.length,
      recoveredActionId: recovery.recoveredActionIds[0],
      failedActionCount: recovery.failedActionIds.length,
      recoveredByManualCall: recovery.recoveredActionIds.includes(
        pendingAction.id
      ),
      recoveredByDurableObjectAlarm:
        recovery.dueCount === 0 && outcome.transactionState === "reverted",
      stepInvocationCount: timeoutWorkflow.getStepInvocationCount(),
      transactionStateAfterRecovery: outcome.transactionState,
      resultIsUndefined: outcome.resultIsUndefined,
      errorCount: outcome.errorCount,
      errorAction: outcome.errorAction,
      errorIsStepTimeout: outcome.errorIsStepTimeout,
      workflowExecutionCount: executionsAfterRecovery.length,
      handledAfterRecovery:
        persistedAfterRecovery?.handledAt !== undefined &&
        persistedAfterRecovery.handledAt !== null,
      pendingAfterRecovery: pendingAfterRecovery.length,
      alarmClearedAfterCleanup: alarmAfterCleanup === null,
      persistedAfterCleanup: persistedAfterCleanup !== undefined,
    }
  } finally {
    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)
  }
}

async function runWorkflowTransactionTimeoutAlarmRecoveryProof(
  runtime: CommerceModulesRuntime,
  workflowDelayedActionStore: DurableObjectWorkflowDelayedActionStore
): Promise<WorkflowTransactionTimeoutAlarmRecoveryProof> {
  const workflowId = `worker-transaction-timeout-proof-${Date.now()}`
  const transactionId = `${workflowId}-transaction`

  try {
    const timeoutWorkflow = createWorkerTransactionTimeoutProof(workflowId)

    await runtime.workflowEngine.service.run(workflowId, {
      input: {
        value: "transaction-timeout",
      },
      transactionId,
      throwOnError: false,
      logOnError: true,
    })

    const pendingActions = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(
      ([, action]) =>
        action.workflowId === workflowId &&
        action.kind === "transaction-timeout"
    )
    const pendingAction = pendingActions[0]?.[1]
    if (!pendingAction) {
      throw new Error(
        `Transaction-timeout delayed action for workflow ${workflowId} was not persisted`
      )
    }

    const persistedBeforeRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const alarmBeforeRecovery =
      await workflowDelayedActionStore.getScheduledAlarm()

    workflowDelayedActionStore.clearRuntimeHandlers()
    await sleep(120)

    const recovery =
      await runtime.workflowEngine.service.recoverDueDelayedActions(
        pendingAction.dueAt
      )
    const runResult: unknown = await runtime.workflowEngine.service.run(
      workflowId,
      {
        input: {
          value: "transaction-timeout",
        },
        transactionId,
        throwOnError: false,
        logOnError: true,
      }
    )
    const outcome = readWorkflowRunOutcome(runResult)
    const executionsAfterRecovery =
      await runtime.workflowEngine.service.listWorkflowExecutions({
        workflow_id: workflowId,
      })
    const persistedAfterRecovery =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )
    const pendingAfterRecovery = [
      ...(await workflowDelayedActionStore.entries()),
    ].filter(([, action]) => action.workflowId === workflowId)

    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)

    const alarmAfterCleanup =
      await workflowDelayedActionStore.getScheduledAlarm()
    const persistedAfterCleanup =
      await workflowDelayedActionStore.getPersistedDelayedAction(
        pendingAction.id
      )

    return {
      workflowId,
      workflowName: timeoutWorkflow.workflow.getName(),
      transactionId,
      actionId: pendingAction.id,
      actionKind: "transaction-timeout",
      alarmScheduledBeforeRecovery: alarmBeforeRecovery !== null,
      alarmMatchesDueAt: alarmBeforeRecovery === pendingAction.dueAt,
      persistedBeforeRecovery: persistedBeforeRecovery !== undefined,
      dueCount: recovery.dueCount,
      recoveredActionCount: recovery.recoveredActionIds.length,
      recoveredActionId: recovery.recoveredActionIds[0],
      failedActionCount: recovery.failedActionIds.length,
      recoveredByManualCall: recovery.recoveredActionIds.includes(
        pendingAction.id
      ),
      recoveredByDurableObjectAlarm:
        recovery.dueCount === 0 && outcome.transactionState === "reverted",
      stepInvocationCount: timeoutWorkflow.getStepInvocationCount(),
      transactionStateAfterRecovery: outcome.transactionState,
      resultIsUndefined: outcome.resultIsUndefined,
      errorCount: outcome.errorCount,
      errorAction: outcome.errorAction,
      errorIsTransactionTimeout: outcome.errorIsTransactionTimeout,
      workflowExecutionCount: executionsAfterRecovery.length,
      handledAfterRecovery:
        persistedAfterRecovery?.handledAt !== undefined &&
        persistedAfterRecovery.handledAt !== null,
      pendingAfterRecovery: pendingAfterRecovery.length,
      alarmClearedAfterCleanup: alarmAfterCleanup === null,
      persistedAfterCleanup: persistedAfterCleanup !== undefined,
    }
  } finally {
    await workflowDelayedActionStore.clear()
    WorkflowManager.unregister(workflowId)
  }
}

function sleep(delay: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay)
  })
}

interface WorkflowRunOutcome {
  transactionState: string
  resultIsUndefined: boolean
  errorCount: number
  errorAction?: string
  errorIsStepTimeout: boolean
  errorIsTransactionTimeout: boolean
}

function readWorkflowRunOutcome(value: unknown): WorkflowRunOutcome {
  if (!isRecord(value)) {
    return {
      transactionState: "",
      resultIsUndefined: false,
      errorCount: 0,
      errorIsStepTimeout: false,
      errorIsTransactionTimeout: false,
    }
  }

  const errors = Array.isArray(value.errors) ? value.errors : []
  const firstError = errors[0]

  return {
    transactionState: readTransactionState(value.transaction),
    resultIsUndefined: value.result === undefined,
    errorCount: errors.length,
    errorAction: readWorkflowErrorAction(firstError),
    errorIsStepTimeout: readWorkflowErrorIsStepTimeout(firstError),
    errorIsTransactionTimeout:
      readWorkflowErrorIsTransactionTimeout(firstError),
  }
}

function readTransactionState(value: unknown): string {
  if (!hasGetFlow(value)) {
    return ""
  }

  const flow = value.getFlow()
  if (!isRecord(flow) || typeof flow.state !== "string") {
    return ""
  }

  return flow.state
}

function hasGetFlow(value: unknown): value is { getFlow(): unknown } {
  return (
    isRecord(value) &&
    "getFlow" in value &&
    typeof value.getFlow === "function"
  )
}

function readWorkflowErrorAction(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.action !== "string") {
    return undefined
  }

  return value.action
}

function readWorkflowErrorIsStepTimeout(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const error = value.error
  if (
    error instanceof Error &&
    TransactionStepTimeoutError.isTransactionStepTimeoutError(error)
  ) {
    return true
  }

  return isRecord(error) && error.name === "TransactionStepTimeoutError"
}

function readWorkflowErrorIsTransactionTimeout(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const error = value.error
  if (
    error instanceof Error &&
    TransactionTimeoutError.isTransactionTimeoutError(error)
  ) {
    return true
  }

  return isRecord(error) && error.name === "TransactionTimeoutError"
}

interface CartProof {
  id: string
  apiKeyId: string
  apiKeyCount: number
  apiKeyTokenPrefix: string
  userId: string
  userCount: number
  analyticsTrackCount: number
  analyticsIdentifyCount: number
  analyticsTrackedEvent: string
  analyticsIdentifiedActor: string
  workflowEngineProvider: "inmemory"
  workflowId: string
  workflowTransactionFinished: boolean
  workflowExecutionCount: number
  workflowExecutionPersisted: boolean
  workflowExecutionStoreState: string
  cachingKeyLength: number
  cachingValue: string
  cachingTagResultCount: number
  cachingCleared: boolean
  authIdentityId: string
  authIdentityCount: number
  authProviderIdentityCount: number
  authProvider: string
  rbacRoleId: string
  rbacPolicyId: string
  rbacRolePolicyCount: number
  rbacRoleRelationPolicyCount: number
  rbacPolicyKey: string
  settingsViewId: string
  settingsFilterCount: number
  settingsSortingIsNull: boolean
  settingsActiveViewId: string
  fileId: string
  fileUrl: string
  retrievedFileUrl: string
  listedFileCount: number
  listedFileUrl: string
  uploadFileKey: string
  uploadFileUrl: string
  notificationId: string
  notificationProviderId: string
  notificationExternalId: string
  notificationStatus: string
  retrievedNotificationStatus: string
  inviteId: string
  inviteEmail: string
  inviteTokenPartCount: number
  storeId: string
  storeCount: number
  storeCurrencyCount: number
  storeLocaleCount: number
  regionId: string
  regionCount: number
  regionCountryCount: number
  customerId: string
  customerGroupId: string
  customerGroupFilterCount: number
  customerAddressCount: number
  customerGroupCount: number
  productId: string
  productCount: number
  productTypeId: string
  productTypeCount: number
  productTagId: string
  productTagCount: number
  eventBusProvider: "cloudflare-queue"
  productCacheInvalidatedByEvent: boolean
  lockingProvider: "cloudflare-durable-object"
  lockingSuccessfulSales: number
  lockingRemainingStock: number
  translationLocaleCount: number
  translationId: string
  translationSearchCount: number
  translationListCount: number
  translationCount: number
  translationTitle: string
  translationIgnoredFieldVisible: boolean
  translationStatisticsExpected: number
  translationStatisticsTranslated: number
  translationProductFieldCount: number
  priceSetId: string
  calculatedPriceAmount: number
  taxRegionId: string
  taxRegionCount: number
  taxRateCount: number
  fulfillmentProviderId: string
  fulfillmentSetId: string
  fulfillmentSetCount: number
  fulfillmentServiceZoneCount: number
  fulfillmentGeoZoneCount: number
  shippingProfileId: string
  shippingOptionId: string
  shippingOptionCount: number
  paymentProviderCount: number
  paymentCollectionId: string
  paymentCollectionCount: number
  paymentSessionId: string
  paymentId: string
  paymentCaptureCount: number
  orderId: string
  orderDisplayId: number
  orderItemCount: number
  orderShippingMethodCount: number
  orderTransactionCount: number
  orderHasBillingAddress: boolean
  orderHasShippingAddress: boolean
  promotionId: string
  promotionCount: number
  promotionApplicationMethodValue: number
  salesChannelId: string
  salesChannelCount: number
  stockLocationId: string
  stockLocationCount: number
  stockLocationAddressCount: number
  inventoryItemId: string
  inventoryItemCount: number
  inventoryLevelId: string
  inventoryLevelCount: number
  inventoryStockedQuantity: number
  inventoryReservedQuantity: number
  itemCount: number
  shippingMethodCount: number
  lineItemAdjustmentCount: number
  lineItemTaxLineCount: number
  shippingMethodAdjustmentCount: number
  shippingMethodTaxLineCount: number
  total: number
  rawTotal: string
  transactionMode: "atomic" | "statement"
}

interface CartRollbackProof {
  transactionMode: "atomic" | "statement"
  visibleInsideTransaction: boolean
  rolledBack: boolean
}

interface HttpProductionOptionsProof {
  transactionMode: "atomic" | "statement"
  adminPluginsHandled: boolean
  requestScopeCreated: boolean
  cartServiceResolved: boolean
  sessionCreateStatus: number
  sessionCookieIssued: boolean
  sessionReadStatus: number
  sessionActorId: string
  sessionDestroyStatus: number
  sessionDestroyCookieIssued: boolean
  sessionStoreCountAfterDestroy: number
  remoteQueryCurrencyStatus: number
  remoteQueryCurrencyCode: string
  remoteQueryCurrencyCount: number
  remoteQueryCurrencyOffset: number
  remoteQueryCurrencyLimit: number
  queryGraphProductTypeStatus: number
  queryGraphProductTypeValue: string
  queryGraphProductTypeCount: number
  queryGraphProductTypeOffset: number
  queryGraphProductTypeLimit: number
  queryGraphProductTagStatus: number
  queryGraphProductTagValue: string
  queryGraphProductTagCount: number
  queryGraphProductTagOffset: number
  queryGraphProductTagLimit: number
  queryGraphCollectionStatus: number
  queryGraphCollectionId: string
  queryGraphCollectionProductId: string
  queryGraphCollectionProductTitle: string
}

interface WorkflowScheduleStoreProof {
  jobId: string
  scheduledWorkflowName: string
  persistedBeforeRemove: boolean
  runtimeBeforeRemove: boolean
  expressionType?: "interval" | "cron"
  interval?: string | number
  numberOfExecutions?: number
  configNumberOfExecutions?: number
  persistedAfterRemove: boolean
  runtimeAfterRemove: boolean
}

interface WorkflowScheduleAlarmRecoveryProof {
  jobId: string
  scheduledWorkflowName: string
  alarmScheduledBeforeRecovery: boolean
  alarmMatchesNextExecution: boolean
  runtimeScheduleMissingBeforeRecovery: boolean
  dueCount: number
  recoveredJobCount: number
  recoveredJobId?: string
  skippedRuntimeJobCount: number
  workflowExecutionCount: number
  persistedExecutionCount: number | null
  alarmClearedAfterCleanup: boolean
  persistedAfterCleanup: boolean
}

interface WorkflowExecutionCleanerProof {
  workflowId: string
  expirableBeforeCount: number
  expirableAfterCount: number
  deletedExpiredFinishedCount: number
  expiredDoneDeleted: boolean
  expiredFailedDeleted: boolean
  notExpiredFinishedPreserved: boolean
  expiredRunningPreserved: boolean
  remainingExecutionCount: number
  remainingTransactionIds: string[]
}

interface WorkflowDelayedActionAlarmRecoveryProof {
  workflowId: string
  workflowName: string
  transactionId: string
  actionId: string
  actionKind: "retry-step" | "step-timeout" | "transaction-timeout"
  alarmScheduledBeforeRecovery: boolean
  alarmMatchesDueAt: boolean
  persistedBeforeRecovery: boolean
  dueCount: number
  recoveredActionCount: number
  recoveredActionId?: string
  failedActionCount: number
  recoveredByManualCall: boolean
  recoveredByDurableObjectAlarm: boolean
  attemptCount: number
  workflowExecutionCount: number
  handledAfterRecovery: boolean
  pendingAfterRecovery: number
  alarmClearedAfterCleanup: boolean
  persistedAfterCleanup: boolean
}

interface WorkflowStepTimeoutAlarmRecoveryProof {
  workflowId: string
  workflowName: string
  transactionId: string
  actionId: string
  actionKind: "step-timeout"
  stepId?: string
  alarmScheduledBeforeRecovery: boolean
  alarmMatchesDueAt: boolean
  persistedBeforeRecovery: boolean
  dueCount: number
  recoveredActionCount: number
  recoveredActionId?: string
  failedActionCount: number
  recoveredByManualCall: boolean
  recoveredByDurableObjectAlarm: boolean
  stepInvocationCount: number
  transactionStateAfterRecovery: string
  resultIsUndefined: boolean
  errorCount: number
  errorAction?: string
  errorIsStepTimeout: boolean
  workflowExecutionCount: number
  handledAfterRecovery: boolean
  pendingAfterRecovery: number
  alarmClearedAfterCleanup: boolean
  persistedAfterCleanup: boolean
}

interface WorkflowTransactionTimeoutAlarmRecoveryProof {
  workflowId: string
  workflowName: string
  transactionId: string
  actionId: string
  actionKind: "transaction-timeout"
  alarmScheduledBeforeRecovery: boolean
  alarmMatchesDueAt: boolean
  persistedBeforeRecovery: boolean
  dueCount: number
  recoveredActionCount: number
  recoveredActionId?: string
  failedActionCount: number
  recoveredByManualCall: boolean
  recoveredByDurableObjectAlarm: boolean
  stepInvocationCount: number
  transactionStateAfterRecovery: string
  resultIsUndefined: boolean
  errorCount: number
  errorAction?: string
  errorIsTransactionTimeout: boolean
  workflowExecutionCount: number
  handledAfterRecovery: boolean
  pendingAfterRecovery: number
  alarmClearedAfterCleanup: boolean
  persistedAfterCleanup: boolean
}

interface FulfillmentProviderWritable {
  createFulfillmentProviders(data: {
    id: string
    is_enabled?: boolean
  }): Promise<{
    id: string
    is_enabled?: boolean
  }>
}

interface CartTotalsResult {
  total: number
  raw_total: {
    value: string
  }
}

function isCartTotalsResult(value: unknown): value is CartTotalsResult {
  return (
    isRecord(value) &&
    typeof value.total === "number" &&
    isRecord(value.raw_total) &&
    typeof value.raw_total.value === "string"
  )
}

interface CacheValue {
  value: string
  user_id: string
}

function isCacheValue(value: unknown): value is CacheValue {
  return (
    isRecord(value) &&
    typeof value.value === "string" &&
    typeof value.user_id === "string"
  )
}

function waitForEventBus(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0))
}

function fulfillmentProviderWritable(
  value: unknown
): FulfillmentProviderWritable {
  if (
    isRecord(value) &&
    "createFulfillmentProviders" in value &&
    typeof value.createFulfillmentProviders === "function"
  ) {
    return {
      createFulfillmentProviders:
        value.createFulfillmentProviders.bind(value),
    }
  }

  throw new Error("Fulfillment service provider writer is missing")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
