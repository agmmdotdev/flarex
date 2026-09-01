import {
  createPartitionAddress,
  TenantRuntimeContextError,
} from "@medusajs/cloudflare-runtime"
import {
  resolveTenantRuntimeContext,
  type TenantRuntimeEnv,
} from "./platform/tenant-resolution"

export const MEDUSA_HTTP_PARTITION_ROUTE_PREFIX =
  "/medusa-http-runtime/partitions/"
export const MEDUSA_HTTP_PARTITION_KEY_HEADER = "x-medusa-partition-key"

export interface DurableObjectFetchNamespace {
  getByName(name: string): DurableObjectFetchStub
}

export interface DurableObjectFetchStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type TenantPartitionedDurableObjectInput = Readonly<{
  aggregateId: string
  env: TenantRuntimeEnv
  family: string
  namespace: DurableObjectFetchNamespace
  request: Request
}>

export type MedusaHttpPartitionRouteInput = Readonly<{
  env: TenantRuntimeEnv
  missingNamespaceMessage: string
  namespace?: DurableObjectFetchNamespace
  partitionFamily: string
  request: Request
  rewriteTargetPath: (
    route: MedusaHttpPartitionTargetRoute
  ) => string
}>

export type MedusaHttpPartitionCandidateInput = Readonly<{
  env: TenantRuntimeEnv
  isCandidateRoute: (url: URL) => boolean
  missingNamespaceMessage: string
  namespace?: DurableObjectFetchNamespace
  partitionFamily: string
  request: Request
  resolvePartitionKey?: (
    request: Request,
    url: URL
  ) => string | undefined
  rewriteTargetPath: (
    route: MedusaHttpPartitionTargetRoute
  ) => string
}>

export type MedusaHttpPartitionTargetRoute = Readonly<{
  partitionKey: string
  targetPath: string
}>

type MedusaHttpPartitionRoute = Readonly<{
  partitionKey: string
  targetPath: string
}>

export async function fetchTenantPartitionedDurableObject({
  aggregateId,
  env,
  family,
  namespace,
  request,
}: TenantPartitionedDurableObjectInput): Promise<Response> {
  try {
    const context = resolveTenantRuntimeContext(request, env)
    const partitionAddress = createPartitionAddress(context, {
      family,
      key: aggregateId,
    })
    const response = await namespace
      .getByName(partitionAddress.name)
      .fetch(request)

    return withPartitionAddressHeader(response, partitionAddress.name)
  } catch (error) {
    if (error instanceof TenantRuntimeContextError) {
      return Response.json(
        {
          error: error.message,
          field: error.field,
        },
        { status: 400 }
      )
    }

    throw error
  }
}

export async function fetchMedusaHttpPartitionRoute({
  env,
  missingNamespaceMessage,
  namespace,
  partitionFamily,
  request,
  rewriteTargetPath,
}: MedusaHttpPartitionRouteInput): Promise<Response> {
  const url = new URL(request.url)
  const route = parseMedusaHttpPartitionRoute(url.pathname)
  if (!route) {
    return Response.json(
      {
        error:
          "Medusa HTTP partition route must include a partition key and target path",
      },
      { status: 400 }
    )
  }

  if (!namespace) {
    return Response.json(
      { error: missingNamespaceMessage },
      { status: 503 }
    )
  }

  url.pathname = rewriteTargetPath(route)

  return await fetchTenantPartitionedDurableObject({
    aggregateId: route.partitionKey,
    env,
    family: partitionFamily,
    namespace,
    request: new Request(url, request),
  })
}

export async function tryFetchMedusaHttpPartitionCandidate({
  env,
  isCandidateRoute,
  missingNamespaceMessage,
  namespace,
  partitionFamily,
  request,
  resolvePartitionKey,
  rewriteTargetPath,
}: MedusaHttpPartitionCandidateInput): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (!isCandidateRoute(url)) {
    return undefined
  }

  const partitionKeyHeader = request.headers.get(
    MEDUSA_HTTP_PARTITION_KEY_HEADER
  )
  const partitionKey = partitionKeyHeader?.trim()
  if (partitionKeyHeader !== null && !partitionKey) {
    return Response.json(
      {
        error: `${MEDUSA_HTTP_PARTITION_KEY_HEADER} header cannot be empty`,
      },
      { status: 400 }
    )
  }

  const resolvedPartitionKey =
    partitionKey ?? resolvePartitionKey?.(request, url)
  if (!resolvedPartitionKey) {
    return undefined
  }

  if (!namespace) {
    return Response.json(
      { error: missingNamespaceMessage },
      { status: 503 }
    )
  }

  url.pathname = rewriteTargetPath({
    partitionKey: resolvedPartitionKey,
    targetPath: url.pathname,
  })

  return await fetchTenantPartitionedDurableObject({
    aggregateId: resolvedPartitionKey,
    env,
    family: partitionFamily,
    namespace,
    request: new Request(url, request),
  })
}

function parseMedusaHttpPartitionRoute(
  pathname: string
): MedusaHttpPartitionRoute | undefined {
  const remainder = pathname.slice(MEDUSA_HTTP_PARTITION_ROUTE_PREFIX.length)
  const pathSeparator = remainder.indexOf("/")

  if (pathSeparator <= 0 || pathSeparator === remainder.length - 1) {
    return undefined
  }

  try {
    return {
      partitionKey: decodeURIComponent(remainder.slice(0, pathSeparator)),
      targetPath: remainder.slice(pathSeparator),
    }
  } catch {
    return undefined
  }
}

function withPartitionAddressHeader(
  response: Response,
  partitionName: string
): Response {
  const headers = new Headers(response.headers)
  headers.set("x-medusa-partition-name", partitionName)

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
