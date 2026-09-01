import {
  MEDUSA_HTTP_PARTITION_KEY_HEADER,
  type MedusaHttpPartitionTargetRoute,
} from "./cloudflare-http-partition-routing"

export type ProductionHttpPartitionFamily = "cart"

export type BoundedProductionHttpRoutePolicy = Readonly<{
  id: string
  partitionFamily: ProductionHttpPartitionFamily
  routePatterns: readonly string[]
  matches: (url: URL) => boolean
}>

export type ProductionHttpRouteGroupStatus = Readonly<{
  id: string
  partitionFamily: ProductionHttpPartitionFamily
  routePatterns: readonly string[]
}>

const urlDerivedCartProductionRoutePolicies = [
  {
    id: "store-cart-retrieve",
    partitionFamily: "cart",
    routePatterns: ["/store/carts/:id"],
  },
] as const satisfies readonly ProductionHttpRouteGroupStatus[]

const cartProductionRoutePolicies = [
  {
    id: "auth-session",
    partitionFamily: "cart",
    routePatterns: ["/auth/session"],
    matches: (url) => url.pathname === "/auth/session",
  },
  {
    id: "store-currencies",
    partitionFamily: "cart",
    routePatterns: ["/store/currencies"],
    matches: (url) => url.pathname === "/store/currencies",
  },
  {
    id: "store-product-types",
    partitionFamily: "cart",
    routePatterns: ["/store/product-types"],
    matches: (url) => url.pathname === "/store/product-types",
  },
  {
    id: "store-collections",
    partitionFamily: "cart",
    routePatterns: ["/store/collections", "/store/collections/:id"],
    matches: (url) =>
      url.pathname === "/store/collections" ||
      url.pathname.startsWith("/store/collections/"),
  },
  {
    id: "store-product-tags",
    partitionFamily: "cart",
    routePatterns: ["/store/product-tags", "/store/product-tags/:id"],
    matches: (url) =>
      url.pathname === "/store/product-tags" ||
      url.pathname.startsWith("/store/product-tags/"),
  },
] as const satisfies readonly BoundedProductionHttpRoutePolicy[]

export const boundedProductionHttpRoutePolicies =
  cartProductionRoutePolicies satisfies readonly BoundedProductionHttpRoutePolicy[]

export const boundedProductionHttpRouteOptInHeader =
  MEDUSA_HTTP_PARTITION_KEY_HEADER

export function isProductionHttpPartitionCandidateRoute(url: URL): boolean {
  return (
    isBoundedProductionHttpRoute(url) ||
    isUrlDerivedCartProductionHttpRoute(url)
  )
}

export function isBoundedProductionHttpRoute(url: URL): boolean {
  return boundedProductionHttpRoutePolicies.some((policy) =>
    policy.matches(url)
  )
}

export function resolveUrlDerivedProductionHttpPartitionKey(
  request: Request,
  url: URL
): string | undefined {
  if (request.method.toUpperCase() !== "GET") {
    return undefined
  }

  return resolveStoreCartRetrievePartitionKey(url)
}

export function rewriteCartProductionHttpTarget({
  partitionKey,
  targetPath,
}: MedusaHttpPartitionTargetRoute): string {
  return `/do-cart/${encodeURIComponent(partitionKey)}/http${targetPath}`
}

export function getBoundedProductionHttpRouteGroups(): readonly ProductionHttpRouteGroupStatus[] {
  return boundedProductionHttpRoutePolicies.map((policy) => ({
    id: policy.id,
    partitionFamily: policy.partitionFamily,
    routePatterns: policy.routePatterns,
  }))
}

export function getUrlDerivedProductionHttpRouteGroups(): readonly ProductionHttpRouteGroupStatus[] {
  return urlDerivedCartProductionRoutePolicies
}

function isUrlDerivedCartProductionHttpRoute(url: URL): boolean {
  return resolveStoreCartRetrievePartitionKey(url) !== undefined
}

function resolveStoreCartRetrievePartitionKey(url: URL): string | undefined {
  const parts = url.pathname.split("/")
  if (
    parts.length !== 4 ||
    parts[0] !== "" ||
    parts[1] !== "store" ||
    parts[2] !== "carts" ||
    !parts[3]
  ) {
    return undefined
  }

  try {
    const cartId = decodeURIComponent(parts[3]).trim()
    return cartId || undefined
  } catch {
    return undefined
  }
}
