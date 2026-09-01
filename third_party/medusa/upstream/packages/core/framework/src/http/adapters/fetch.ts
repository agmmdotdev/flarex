import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { MedusaError } from "@medusajs/utils/common/errors"
import type { HttpResourceSet, StaticHttpResourceSetInput } from "../resolvers"
import { hasPermission } from "../../policies/has-permission"
import { errorHandler } from "../middlewares/error-handler"
import { RoutesSorter } from "../routes-sorter"
import {
  createStaticHttpManifestPathMatcher,
  matchStaticHttpPath,
} from "../utils/static-http-path-matcher"
import { getMedusaRequestAuthContext } from "../utils/request-context"
import {
  buildStaticHttpResources,
  composeStaticHttpResourceSets,
  mergeStaticHttpResourceManifests,
  type StaticHttpResourceManifest,
} from "../utils/static-http-resources"
import type {
  AdditionalDataValidatorRoute,
  BodyParserConfigRoute,
  HttpPathMatching,
  MedusaErrorHandlerFunction,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareDescriptor,
  MiddlewareFunction,
  RouteDescriptor,
} from "../types"

type RouteMatch = {
  route: RouteDescriptor
  params: Record<string, string>
  resourceIndex: number
}

export type FetchHttpAdapterOptions = {
  createRequestScope?: (request: Request) => MedusaRequest["scope"]
  createSession?: (request: Request) => FetchHttpSession | undefined
  commitSession?: (
    input: FetchHttpSessionCommitInput
  ) => Promise<void> | void
  prepareRequest?: (
    request: MedusaRequest,
    fetchRequest: Request
  ) => Promise<void> | void
}

export type FetchHttpStaticHandlerOptions = FetchHttpAdapterOptions & {
  handleSetupRequest?: (
    request: Request
  ) => Promise<Response | undefined> | Response | undefined
  isSetupPath?: (pathname: string) => boolean
}

export type FetchHttpStaticHandlerManifestInput =
  | StaticHttpResourceManifest
  | readonly StaticHttpResourceManifest[]

export type CreateFetchHttpStaticHandlerOptions =
  FetchHttpStaticHandlerOptions & {
    manifest: FetchHttpStaticHandlerManifestInput
    resources?: HttpResourceSet
    resourcesBeforeManifest?: readonly StaticHttpResourceSetInput[]
    resourcesAfterManifest?: readonly StaticHttpResourceSetInput[]
  }

export type FetchHttpStaticHandler = {
  handle: (request: Request) => Promise<Response>
  isPathHandled: (pathname: string) => boolean
  tryHandle: (request: Request) => Promise<Response | undefined>
}

export type FetchHttpSession = Record<string, unknown> & {
  destroy?: () => void
}

export type FetchHttpSessionCommitInput = {
  request: Request
  session: FetchHttpSession
  responseHeaders: Headers
}

type FetchResponseState = {
  body: BodyInit | null
  headers: Headers
  status: number
  stream?: ReadableStream<Uint8Array>
  streamController?: ReadableStreamDefaultController<Uint8Array>
  streamClosed: boolean
}

type FetchResponseShim = {
  status: (status: number) => FetchResponseShim
  sendStatus: (status: number) => FetchResponseShim
  send: (body?: unknown) => FetchResponseShim
  json: (body?: unknown) => FetchResponseShim
  writeHead: (
    status: number,
    headers?: HeadersInit | Record<string, FetchHeaderValue>
  ) => FetchResponseShim
  write: (chunk: unknown) => boolean
  end: (chunk?: unknown) => FetchResponseShim
  setHeader: (name: string, value: string | number | readonly string[]) => void
  getHeader: (name: string) => string | null
}

type FetchQueryObject = {
  [key: string]: FetchQueryValue
}

type FetchQueryValue = string | FetchQueryValue[] | FetchQueryObject

type FetchRequestShim = {
  method: string
  url: string
  originalUrl: string
  path: string
  protocol: string
  params: Record<string, string>
  query: Record<string, FetchQueryValue>
  headers: Record<string, string>
  get: (name: string) => string | undefined
  body?: unknown
  rawBody?: Uint8Array
  session?: FetchHttpSession
  scope?: MedusaRequest["scope"]
  additionalDataValidator?: AdditionalDataValidatorRoute["validator"]
  on: (
    event: string,
    listener: (error?: { code?: string }) => void
  ) => FetchRequestShim
}

type MiddlewareResult = "next" | "handled"

type FetchMiddlewareRunner = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => Promise<void> | void

type FetchErrorHandlerRunner = (
  error: unknown,
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => Promise<void> | void

type FetchResourceDescriptor = MiddlewareDescriptor | RouteDescriptor

type FetchHeaderValue = string | number | readonly string[] | undefined

export class FetchHttpAdapter {
  readonly #additionalDataValidatorRoutes: AdditionalDataValidatorRoute[]
  readonly #bodyParserConfigRoutes: BodyParserConfigRoute[]
  readonly #errorHandler: MedusaErrorHandlerFunction | undefined
  readonly #options: FetchHttpAdapterOptions
  readonly #resources: FetchResourceDescriptor[]

  constructor(
    resources: HttpResourceSet,
    options: FetchHttpAdapterOptions = {}
  ) {
    this.#resources = new RoutesSorter<FetchResourceDescriptor>(
      ([] as FetchResourceDescriptor[])
        .concat(resources.middlewares)
        .concat(resources.routes)
    ).sort()
    this.#bodyParserConfigRoutes = new RoutesSorter(
      resources.bodyParserConfigRoutes
    ).sort(["static", "params", "regex", "wildcard", "global"])
    this.#additionalDataValidatorRoutes = new RoutesSorter(
      resources.additionalDataValidatorRoutes
    ).sort(["static", "params", "regex", "wildcard", "global"])
    this.#errorHandler = resources.errorHandler
    this.#options = options
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const match = this.#findRoute(request.method, url.pathname)

    if (!match) {
      return new Response("Not Found", { status: 404 })
    }

    const responseState: FetchResponseState = {
      body: null,
      headers: new Headers(),
      status: 200,
      streamClosed: false,
    }

    const requestShim: FetchRequestShim = {
      method: request.method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      protocol: url.protocol.replace(/:$/, ""),
      params: match.params,
      query: parseFetchQuery(url.searchParams),
      headers: Object.fromEntries(request.headers.entries()),
      get: (name) => request.headers.get(name) ?? undefined,
      on: (event, listener) => {
        if (event === "close") {
          if (request.signal.aborted) {
            listener()
            return requestShim
          }

          request.signal.addEventListener(
            "abort",
            () => {
              listener()
            },
            { once: true }
          )
        }

        return requestShim
      },
    }
    const requestScope = this.#options.createRequestScope?.(request)
    if (requestScope) {
      requestShim.scope = requestScope
    }
    const requestSession = this.#options.createSession?.(request)
    if (requestSession) {
      requestShim.session = requestSession
    }
    initializeMedusaRequestDefaults(requestShim)
    const responseShim = createResponseShim(responseState)

    try {
      await this.#applyJsonBodyParser(requestShim, request, url.pathname)
      this.#applyAdditionalDataValidator(
        requestShim,
        request.method,
        url.pathname
      )
      await this.#prepareRequest(requestShim, request)

      const middlewareResult = await this.#runMiddlewares(
        requestShim,
        responseShim,
        request.method,
        url.pathname,
        match.resourceIndex
      )
      if (middlewareResult === "next") {
        // Existing Medusa handlers are still typed as Express handlers. The Fetch
        // adapter boundary owns the temporary structural bridge until the request
        // and response contracts become runtime-neutral.
        await match.route.handler(
          requestShim as MedusaRequest,
          responseShim as MedusaResponse
        )
      }
    } catch (error) {
      await this.#handleError(error, requestShim, responseShim)
    }
    await this.#commitSession(request, requestShim, responseState.headers)

    return createFetchResponse(responseState)
  }

  #findRoute(method: string, pathname: string): RouteMatch | undefined {
    for (let index = 0; index < this.#resources.length; index += 1) {
      const resource = this.#resources[index]
      if (!isRouteDescriptor(resource)) {
        continue
      }

      if (resource.method !== method.toUpperCase()) {
        continue
      }

      const params = matchStaticHttpPath(resource.matcher, pathname)
      if (params) {
        return { route: resource, params, resourceIndex: index }
      }
    }

    return undefined
  }

  async #runMiddlewares(
    requestShim: FetchRequestShim,
    responseShim: FetchResponseShim,
    method: string,
    pathname: string,
    routeResourceIndex: number
  ): Promise<MiddlewareResult> {
    for (const resource of this.#resources.slice(0, routeResourceIndex)) {
      if (!isMiddlewareDescriptor(resource)) {
        continue
      }

      const middleware = resource
      if (!matchesMiddleware(middleware, method, pathname)) {
        continue
      }

      const handler =
        middleware.policies && FeatureFlag.isFeatureEnabled("rbac")
          ? wrapFetchMiddlewareWithPoliciesCheck(
              middleware.handler,
              middleware.policies
            )
          : middleware.handler

      const result = await executeMiddleware(
        handler,
        requestShim,
        responseShim
      )
      if (result === "handled") {
        return result
      }
    }

    return "next"
  }

  #applyAdditionalDataValidator(
    requestShim: FetchRequestShim,
    method: string,
    pathname: string
  ): void {
    const validatorRoute = this.#additionalDataValidatorRoutes.find(
      (route) =>
        methodsMatch(route.methods, method) &&
        resourcePathMatches(route, pathname)
    )

    if (validatorRoute) {
      requestShim.additionalDataValidator = validatorRoute.validator
    }
  }

  async #applyJsonBodyParser(
    requestShim: FetchRequestShim,
    request: Request,
    pathname: string
  ): Promise<void> {
    const parserRoute = this.#findBodyParserConfigRoute(
      request.method,
      pathname
    )
    if (parserRoute?.config === false || !shouldParseJson(request)) {
      return
    }

    if (parserRoute?.config?.preserveRawBody) {
      const rawBody = new Uint8Array(await request.arrayBuffer())
      requestShim.rawBody = rawBody
      requestShim.body = parseJsonRawBody(rawBody)
      return
    }

    requestShim.body = await request.json()
  }

  #findBodyParserConfigRoute(
    method: string,
    pathname: string
  ): BodyParserConfigRoute | undefined {
    return this.#bodyParserConfigRoutes.find(
      (route) =>
        methodsMatch(route.methods, method) &&
        resourcePathMatches(route, pathname)
    )
  }

  async #handleError(
    error: unknown,
    requestShim: FetchRequestShim,
    responseShim: FetchResponseShim
  ): Promise<void> {
    const errorHandler = this.#errorHandler

    if (!errorHandler) {
      throw error
    }

    await executeErrorHandler(errorHandler, error, requestShim, responseShim)
  }

  async #prepareRequest(
    requestShim: FetchRequestShim,
    request: Request
  ): Promise<void> {
    await this.#options.prepareRequest?.(
      requestShim as MedusaRequest,
      request
    )
  }

  async #commitSession(
    request: Request,
    requestShim: FetchRequestShim,
    responseHeaders: Headers
  ): Promise<void> {
    if (!requestShim.session) {
      return
    }

    await this.#options.commitSession?.({
      request,
      session: requestShim.session,
      responseHeaders,
    })
  }
}

export function createFetchHttpStaticHandler({
  manifest,
  resources,
  resourcesBeforeManifest = [],
  resourcesAfterManifest = [],
  ...options
}: CreateFetchHttpStaticHandlerOptions): FetchHttpStaticHandler {
  const resolvedManifest = resolveFetchStaticManifest(manifest)
  const resolvedResources = withDefaultFetchErrorHandler(
    resolveFetchStaticResources({
      manifest: resolvedManifest,
      resources,
      resourcesBeforeManifest,
      resourcesAfterManifest,
    })
  )
  const isManifestPath = createStaticHttpManifestPathMatcher(resolvedManifest)
  const isPathHandled = (pathname: string) =>
    isManifestPath(pathname) || options.isSetupPath?.(pathname) === true
  let adapter: FetchHttpAdapter | undefined
  const handle = async (request: Request): Promise<Response> => {
    const setupResponse = await options.handleSetupRequest?.(request)
    if (setupResponse) {
      return setupResponse
    }

    adapter ??= new FetchHttpAdapter(resolvedResources, options)
    return await adapter.handle(request)
  }

  return {
    handle,

    isPathHandled(pathname: string): boolean {
      return isPathHandled(pathname)
    },

    async tryHandle(request: Request): Promise<Response | undefined> {
      const pathname = new URL(request.url).pathname
      if (!isPathHandled(pathname)) {
        return undefined
      }

      return await handle(request)
    },
  }
}

function withDefaultFetchErrorHandler(
  resources: HttpResourceSet
): HttpResourceSet {
  return {
    ...resources,
    errorHandler: resources.errorHandler ?? errorHandler(),
  }
}

function resolveFetchStaticManifest(
  manifest: FetchHttpStaticHandlerManifestInput
): StaticHttpResourceManifest {
  return isFetchStaticManifestArray(manifest)
    ? mergeStaticHttpResourceManifests(...manifest)
    : manifest
}

function isFetchStaticManifestArray(
  manifest: FetchHttpStaticHandlerManifestInput
): manifest is readonly StaticHttpResourceManifest[] {
  return Array.isArray(manifest)
}

function resolveFetchStaticResources({
  manifest,
  resources,
  resourcesBeforeManifest,
  resourcesAfterManifest,
}: {
  manifest: StaticHttpResourceManifest
  resources: HttpResourceSet | undefined
  resourcesBeforeManifest: readonly StaticHttpResourceSetInput[]
  resourcesAfterManifest: readonly StaticHttpResourceSetInput[]
}): HttpResourceSet {
  const manifestResources = resources ?? buildStaticHttpResources(manifest)

  return composeStaticHttpResourceSets(
    ...resourcesBeforeManifest,
    manifestResources,
    ...resourcesAfterManifest
  )
}

function isRouteDescriptor(
  resource: FetchResourceDescriptor
): resource is RouteDescriptor {
  return "isRoute" in resource
}

function isMiddlewareDescriptor(
  resource: FetchResourceDescriptor
): resource is MiddlewareDescriptor {
  return !isRouteDescriptor(resource)
}

function shouldParseJson(request: Request): boolean {
  if (request.body === null) {
    return false
  }

  const contentType = request.headers.get("content-type") ?? ""
  return contentType.toLowerCase().includes("application/json")
}

function parseJsonRawBody(rawBody: Uint8Array): unknown {
  const text = new TextDecoder().decode(rawBody)
  return text.length > 0 ? JSON.parse(text) : undefined
}

function parseFetchQuery(
  searchParams: URLSearchParams
): Record<string, FetchQueryValue> {
  const query: FetchQueryObject = {}

  for (const [rawKey, value] of searchParams.entries()) {
    assignFetchQueryValue(query, parseFetchQueryKey(rawKey), value)
  }

  return query
}

function parseFetchQueryKey(rawKey: string): string[] {
  const parts: string[] = []
  const matcher = /([^[\]]+)|\[([^\]]*)\]/g

  for (const match of rawKey.matchAll(matcher)) {
    const plainKey = match[1]
    if (plainKey) {
      parts.push(...plainKey.split(".").filter(Boolean))
      continue
    }

    parts.push(match[2] ?? "")
  }

  return parts.length > 0 ? parts : [rawKey]
}

function assignFetchQueryValue(
  target: FetchQueryObject,
  path: string[],
  value: string
): void {
  if (path.length === 0) {
    return
  }

  assignFetchQueryObjectValue(target, path, value)
}

function assignFetchQueryObjectValue(
  target: FetchQueryObject,
  path: string[],
  value: string
): void {
  const [key, ...rest] = path
  if (!key) {
    return
  }

  if (rest.length === 0) {
    target[key] = mergeFetchQueryScalar(target[key], value)
    return
  }

  if (isFetchQueryArrayKey(rest[0])) {
    const next = Array.isArray(target[key]) ? target[key] : []
    target[key] = next
    assignFetchQueryArrayValue(next, rest, value)
    return
  }

  const next = isFetchQueryObject(target[key]) ? target[key] : {}
  target[key] = next
  assignFetchQueryObjectValue(next, rest, value)
}

function assignFetchQueryArrayValue(
  target: FetchQueryValue[],
  path: string[],
  value: string
): void {
  const [key, ...rest] = path
  const index = key === "" ? target.length : Number.parseInt(key, 10)
  if (!Number.isInteger(index) || index < 0) {
    return
  }

  if (rest.length === 0) {
    target[index] = mergeFetchQueryScalar(target[index], value)
    return
  }

  if (isFetchQueryArrayKey(rest[0])) {
    const next = Array.isArray(target[index]) ? target[index] : []
    target[index] = next
    assignFetchQueryArrayValue(next, rest, value)
    return
  }

  const next = isFetchQueryObject(target[index]) ? target[index] : {}
  target[index] = next
  assignFetchQueryObjectValue(next, rest, value)
}

function mergeFetchQueryScalar(
  existing: FetchQueryValue | undefined,
  value: string
): FetchQueryValue {
  if (existing === undefined) {
    return value
  }

  return Array.isArray(existing) ? [...existing, value] : [existing, value]
}

function isFetchQueryArrayKey(key: string | undefined): boolean {
  return key === "" || (key !== undefined && /^\d+$/.test(key))
}

function isFetchQueryObject(
  value: FetchQueryValue | undefined
): value is FetchQueryObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function initializeMedusaRequestDefaults(requestShim: FetchRequestShim): void {
  const medusaRequest = requestShim as MedusaRequest

  medusaRequest.allowedProperties = []
  medusaRequest.errors = []
  medusaRequest.filterableFields = {}
  medusaRequest.listConfig = {}
  medusaRequest.retrieveConfig = {}
  medusaRequest.queryConfig = {
    fields: [],
    pagination: {
      skip: 0,
    },
  }
  medusaRequest.remoteQueryConfig = medusaRequest.queryConfig
  medusaRequest.context = {}
}

type FetchPolicyAction = {
  resource: string
  operation: string | string[]
}

type PolicyAwareRequest = MedusaRequest & {
  policies?: FetchPolicyAction[]
}

function wrapFetchMiddlewareWithPoliciesCheck(
  handler: MiddlewareFunction,
  policies: FetchPolicyAction | FetchPolicyAction[]
): MiddlewareFunction {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    try {
      const policyAwareReq = req as PolicyAwareRequest
      policyAwareReq.policies ??= []
      policyAwareReq.policies.push(
        ...(Array.isArray(policies) ? policies : [policies])
      )

      await checkFetchPermissions(policies, req)
      return handler(req, res, next)
    } catch (error) {
      return next(error)
    }
  }
}

async function checkFetchPermissions(
  policies: FetchPolicyAction | FetchPolicyAction[],
  req: MedusaRequest
): Promise<void> {
  const policyList = Array.isArray(policies) ? policies : [policies]
  if (!policyList.length) {
    return
  }

  const roleIds = getPolicyRoleIds(req)
  if (!roleIds.length) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
  }

  const hasAccess = await hasPermission({
    roles: roleIds,
    actions: policyList,
    container: req.scope,
  })

  if (!hasAccess) {
    const policyKeys = policyList
      .map((policy) => `${policy.resource}:${policy.operation}`)
      .join(", ")

    throw new MedusaError(
      MedusaError.Types.FORBIDDEN,
      `Insufficient permissions. Required policies: ${policyKeys}`
    )
  }
}

function getPolicyRoleIds(req: MedusaRequest): string[] {
  const authContext = getMedusaRequestAuthContext(req)
  const roles = authContext?.app_metadata?.roles
  if (!Array.isArray(roles)) {
    return []
  }

  return roles.filter((role): role is string => typeof role === "string")
}

async function executeMiddleware(
  handler: MiddlewareFunction,
  requestShim: FetchRequestShim,
  responseShim: FetchResponseShim
): Promise<MiddlewareResult> {
  let nextCalled = false
  let nextError: unknown
  const next: MedusaNextFunction = ((error?: unknown) => {
    nextCalled = true
    nextError = error
  }) as MedusaNextFunction

  // Existing middleware functions are still typed as Express-compatible
  // handlers. The Fetch adapter keeps this assertion at the runtime boundary.
  await (handler as FetchMiddlewareRunner)(
    requestShim as MedusaRequest,
    responseShim as MedusaResponse,
    next
  )

  if (nextError) {
    throw nextError
  }

  return nextCalled ? "next" : "handled"
}

async function executeErrorHandler(
  handler: MedusaErrorHandlerFunction,
  error: unknown,
  requestShim: FetchRequestShim,
  responseShim: FetchResponseShim
): Promise<void> {
  let nextError: unknown
  const next: MedusaNextFunction = ((error?: unknown) => {
    nextError = error
  }) as MedusaNextFunction

  // Existing error handlers are still Express-compatible. The Fetch adapter
  // keeps this assertion at the runtime boundary.
  await (handler as FetchErrorHandlerRunner)(
    error,
    requestShim as MedusaRequest,
    responseShim as MedusaResponse,
    next
  )

  if (nextError) {
    throw nextError
  }
}

function matchesMiddleware(
  middleware: MiddlewareDescriptor,
  method: string,
  pathname: string
): boolean {
  return (
    methodsMatch(middleware.methods, method) &&
    resourcePathMatches(middleware, pathname)
  )
}

function resourcePathMatches(
  resource: {
    matcher: string
    pathMatching?: HttpPathMatching
  },
  pathname: string
): boolean {
  return (
    matchStaticHttpPath(resource.matcher, pathname, {
      partial: resource.pathMatching === "prefix",
    }) !== undefined
  )
}

function methodsMatch(
  methods: MiddlewareDescriptor["methods"],
  requestMethod: string
): boolean {
  if (!methods) {
    return true
  }

  const normalizedRequestMethod = requestMethod.toUpperCase()
  const methodList = Array.isArray(methods) ? methods : [methods]

  return methodList.some(
    (method) =>
      method === "ALL" || method === "USE" || method === normalizedRequestMethod
  )
}

function createResponseShim(state: FetchResponseState): FetchResponseShim {
  const shim: FetchResponseShim = {
    status(status) {
      state.status = status
      return shim
    },

    sendStatus(status) {
      state.status = status
      setTextPlainHeaderIfUnset(state.headers)
      state.body = getHttpStatusText(status)
      return shim
    },

    send(body) {
      if (typeof body === "number") {
        state.status = body
        setTextPlainHeaderIfUnset(state.headers)
        state.body = getHttpStatusText(body)
        return shim
      }

      state.body = normalizeBody(body, state.headers)
      return shim
    },

    json(body) {
      state.headers.set("content-type", "application/json; charset=utf-8")
      state.body = JSON.stringify(body ?? null)
      return shim
    },

    writeHead(status, headers) {
      state.status = status
      applyFetchHeaders(state.headers, headers)

      if (isStreamingContentType(state.headers)) {
        ensureResponseStream(state)
      }

      return shim
    },

    write(chunk) {
      writeResponseChunk(state, chunk)
      return true
    },

    end(chunk) {
      if (chunk !== undefined) {
        writeResponseChunk(state, chunk)
      }
      closeResponseStream(state)
      return shim
    },

    setHeader(name, value) {
      const normalized = Array.isArray(value) ? value.join(", ") : String(value)
      state.headers.set(name, normalized)
    },

    getHeader(name) {
      return state.headers.get(name)
    },
  }

  return shim
}

function createFetchResponse(state: FetchResponseState): Response {
  return new Response(state.body, {
    headers: state.headers,
    status: state.status,
  })
}

function setTextPlainHeaderIfUnset(headers: Headers): void {
  if (!headers.has("content-type")) {
    headers.set("content-type", "text/plain; charset=utf-8")
  }
}

function getHttpStatusText(status: number): string {
  return HTTP_STATUS_TEXT[status] ?? String(status)
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  509: "Bandwidth Limit Exceeded",
  510: "Not Extended",
  511: "Network Authentication Required",
}

function applyFetchHeaders(
  target: Headers,
  headers: HeadersInit | Record<string, FetchHeaderValue> | undefined
): void {
  if (!headers) {
    return
  }

  if (headers instanceof Headers) {
    headers.forEach((value, name) => {
      target.set(name, value)
    })
    return
  }

  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      target.set(name, value)
    }
    return
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    target.set(name, Array.isArray(value) ? value.join(", ") : String(value))
  }
}

function isStreamingContentType(headers: Headers): boolean {
  return headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("text/event-stream") === true
}

function ensureResponseStream(
  state: FetchResponseState
): ReadableStreamDefaultController<Uint8Array> {
  if (state.streamController) {
    return state.streamController
  }

  if (state.streamClosed) {
    throw new Error("Cannot write to a closed Fetch response stream")
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      state.streamController = controller
    },
    cancel() {
      state.streamClosed = true
      state.streamController = undefined
    },
  })

  state.stream = stream
  state.body = stream

  if (!state.streamController) {
    throw new Error("Fetch response stream controller was not initialized")
  }

  return state.streamController
}

function writeResponseChunk(
  state: FetchResponseState,
  chunk: unknown
): void {
  const controller = ensureResponseStream(state)
  controller.enqueue(normalizeStreamChunk(chunk))
}

function closeResponseStream(state: FetchResponseState): void {
  if (!state.streamController || state.streamClosed) {
    return
  }

  try {
    state.streamController.close()
  } catch (error) {
    if (!isClosedStreamControllerError(error)) {
      throw error
    }
  } finally {
    state.streamClosed = true
    state.streamController = undefined
  }
}

function isClosedStreamControllerError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message.includes("Controller is already closed") ||
      error.message.includes("Invalid state"))
  )
}

function normalizeStreamChunk(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk
  }

  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk)
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  return new TextEncoder().encode(String(chunk))
}

function normalizeBody(body: unknown, headers: Headers): BodyInit | null {
  if (body === undefined || body === null) {
    return null
  }

  if (isBodyInit(body)) {
    return body
  }

  headers.set("content-type", "application/json; charset=utf-8")
  return JSON.stringify(body)
}

function isBodyInit(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof ArrayBuffer ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream ||
    ArrayBuffer.isView(body)
  )
}
