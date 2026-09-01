import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http/fetch"

const staticHttpProofStateRegistrationKey = "staticHttpProofState"

export const AUTHENTICATE = false
export const CORS = false

type ProofGetResponse = {
  id: string
  middlewareApplied: boolean
  source: string | null
}

type ProofPostResponse = ProofGetResponse & {
  body: unknown
}

type WebhookEventProof = {
  message: unknown
  options: unknown
}

type WebhookEventsResponse = {
  events: WebhookEventProof[]
}

type StaticHttpProofStateService = {
  recordRegionPaymentProviderLink(input: unknown): void
  recordRegions(input: unknown): void
  recordSalesChannels(input: unknown): void
  recordCollections(input: unknown): void
  recordProductTags(input: unknown): void
  recordProductTypes(input: unknown): void
  recordProducts(input: unknown): void
  recordPromotions(input: unknown): void
  recordStockLocations(input: unknown): void
  recordInventoryItems(input: unknown): void
  recordInventoryLevels(input: unknown): void
  recordReservations(input: unknown): void
  recordCarts(input: unknown): void
  recordCartLineItems(input: unknown): void
  recordCartCompletion(input: unknown): void
  recordCartShippingMethods(input: unknown): void
  recordCartLineItemAdjustments(input: unknown): void
  recordCartShippingMethodAdjustments(input: unknown): void
  recordCartCreditLines(input: unknown): void
  recordApiKeys(input: unknown): void
  recordAuthIdentities(input: unknown): void
  recordUsers(input: unknown): void
  recordInvites(input: unknown): void
  recordCustomers(input: unknown): void
  recordCustomerAddresses(input: unknown): void
  recordCustomerGroups(input: unknown): void
  recordCustomerGroupCustomers(input: unknown): void
  deleteCustomerAddresses(input: unknown): void
  recordRbacRoles(input: unknown): void
  recordRbacPolicies(input: unknown): void
  recordRemoteLinks(input: unknown): void
  deleteRemoteLinks(input: unknown): void
  recordFulfillments(input: unknown): void
  recordFulfillmentSets(input: unknown): void
  recordPriceLists(input: unknown): void
  recordPriceSets(input: unknown): void
  recordOrders(input: unknown): void
  deleteOrders(input: unknown): void
  recordPayments(input: unknown): void
  recordStores(input: unknown): void
  deleteStores(input: unknown): void
  recordTaxRegions(input: unknown): void
  deleteTaxRegions(input: unknown): void
  recordTaxRates(input: unknown): void
  recordTaxRateRules(input: unknown): void
  deleteTaxRates(input: unknown): void
  recordStoreLocales(input: unknown): void
  recordViewConfigurations(input: unknown): void
  recordWorkflowExecutions(input: unknown): void
  recordFiles(input: unknown): void
  getWebhookEvents(): WebhookEventProof[]
  clear(): void
}

export function GET(
  req: MedusaRequest,
  res: MedusaResponse<ProofGetResponse | WebhookEventsResponse>
): void {
  if (req.params.proofId === "webhook-events") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    res.json({
      events: proofState.getWebhookEvents(),
    })
    return
  }

  res.json({
    id: req.params.proofId,
    middlewareApplied: isProofMiddlewareApplied(req),
    source: getStringQueryParam(req, "source"),
  })
}

export function POST(
  req: MedusaRequest<unknown>,
  res: MedusaResponse<ProofPostResponse>
): void {
  if (req.params.proofId === "region-payment-provider-link") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordRegionPaymentProviderLink(req.body)
  } else if (req.params.proofId === "regions") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordRegions(req.body)
  } else if (req.params.proofId === "sales-channels") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordSalesChannels(req.body)
  } else if (req.params.proofId === "collections") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCollections(req.body)
  } else if (req.params.proofId === "product-tags") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordProductTags(req.body)
  } else if (req.params.proofId === "product-types") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordProductTypes(req.body)
  } else if (req.params.proofId === "products") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordProducts(req.body)
  } else if (req.params.proofId === "promotions") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordPromotions(req.body)
  } else if (req.params.proofId === "stock-locations") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordStockLocations(req.body)
  } else if (req.params.proofId === "inventory-items") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordInventoryItems(req.body)
  } else if (req.params.proofId === "inventory-levels") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordInventoryLevels(req.body)
  } else if (req.params.proofId === "reservations") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordReservations(req.body)
  } else if (req.params.proofId === "carts") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCarts(req.body)
  } else if (req.params.proofId === "cart-line-items") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartLineItems(req.body)
  } else if (req.params.proofId === "cart-completion") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartCompletion(req.body)
  } else if (req.params.proofId === "cart-credit-lines") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartCreditLines(req.body)
  } else if (req.params.proofId === "cart-shipping-methods") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartShippingMethods(req.body)
  } else if (req.params.proofId === "cart-line-item-adjustments") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartLineItemAdjustments(req.body)
  } else if (req.params.proofId === "cart-shipping-method-adjustments") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCartShippingMethodAdjustments(req.body)
  } else if (req.params.proofId === "api-keys") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordApiKeys(req.body)
  } else if (req.params.proofId === "auth-identities") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordAuthIdentities(req.body)
  } else if (req.params.proofId === "users") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordUsers(req.body)
  } else if (req.params.proofId === "invites") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordInvites(req.body)
  } else if (req.params.proofId === "customers") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCustomers(req.body)
  } else if (req.params.proofId === "customer-addresses") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCustomerAddresses(req.body)
  } else if (req.params.proofId === "customer-groups") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCustomerGroups(req.body)
  } else if (req.params.proofId === "customer-group-customers") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordCustomerGroupCustomers(req.body)
  } else if (req.params.proofId === "delete-customer-addresses") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteCustomerAddresses(req.body)
  } else if (req.params.proofId === "rbac-roles") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordRbacRoles(req.body)
  } else if (req.params.proofId === "rbac-policies") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordRbacPolicies(req.body)
  } else if (req.params.proofId === "remote-links") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordRemoteLinks(req.body)
  } else if (req.params.proofId === "delete-remote-links") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteRemoteLinks(req.body)
  } else if (req.params.proofId === "fulfillments") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordFulfillments(req.body)
  } else if (req.params.proofId === "fulfillment-sets") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordFulfillmentSets(req.body)
  } else if (req.params.proofId === "price-lists") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordPriceLists(req.body)
  } else if (req.params.proofId === "price-sets") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordPriceSets(req.body)
  } else if (req.params.proofId === "orders") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordOrders(req.body)
  } else if (req.params.proofId === "orders-delete") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteOrders(req.body)
  } else if (req.params.proofId === "payments") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordPayments(req.body)
  } else if (req.params.proofId === "stores") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordStores(req.body)
  } else if (req.params.proofId === "delete-stores") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteStores(req.body)
  } else if (req.params.proofId === "tax-regions") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordTaxRegions(req.body)
  } else if (req.params.proofId === "delete-tax-regions") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteTaxRegions(req.body)
  } else if (req.params.proofId === "tax-rates") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordTaxRates(req.body)
  } else if (req.params.proofId === "tax-rate-rules") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordTaxRateRules(req.body)
  } else if (req.params.proofId === "delete-tax-rates") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.deleteTaxRates(req.body)
  } else if (req.params.proofId === "store-locales") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordStoreLocales(req.body)
  } else if (req.params.proofId === "view-configurations") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordViewConfigurations(req.body)
  } else if (req.params.proofId === "workflow-executions") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordWorkflowExecutions(req.body)
  } else if (req.params.proofId === "files") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.recordFiles(req.body)
  } else if (req.params.proofId === "reset") {
    const proofState = req.scope.resolve<StaticHttpProofStateService>(
      staticHttpProofStateRegistrationKey
    )
    proofState.clear()
  }

  res.status(201).json({
    id: req.params.proofId,
    middlewareApplied: isProofMiddlewareApplied(req),
    source: getStringQueryParam(req, "source"),
    body: req.body,
  })
}

function isProofMiddlewareApplied(req: MedusaRequest): boolean {
  return req.context?.staticHttpProof === true
}

function getStringQueryParam(
  req: MedusaRequest,
  key: string
): string | null {
  const value = req.query[key]
  return typeof value === "string" ? value : null
}
