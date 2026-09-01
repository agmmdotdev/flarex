import {
  ContainerRegistrationKeys,
  FeatureFlag,
  isFileDisabled,
  parseCorsOrigins,
} from "@medusajs/utils"
import cors, { CorsOptions } from "cors"
import type { Express } from "express"
import type {
  AdditionalDataValidatorRoute,
  BodyParserConfigRoute,
  MedusaErrorHandlerFunction,
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MiddlewareDescriptor,
  MiddlewareFunction,
  MiddlewareVerb,
  RouteDescriptor,
} from "./types"

import { Logger, MedusaContainer } from "@medusajs/types"
import { join } from "path"
import { configManager } from "../config"
import { ExpressHttpAdapter } from "./adapters/express"
import type {
  HttpRuntimeAdapter,
  HttpTraceMiddleware,
  HttpTraceRoute,
} from "./adapters/types"
import { applyLocale, authenticate, AuthType } from "./middlewares"
import { createBodyParserMiddlewaresStack } from "./middlewares/bodyparser"
import { ensurePublishableApiKeyMiddleware } from "./middlewares/ensure-publishable-api-key"
import { errorHandler } from "./middlewares/error-handler"
import { FilesystemHttpResourceResolver } from "./resolvers/filesystem"
import type {
  HttpResourceResolver,
  HttpResourceSet,
} from "./resolvers/types"
import { RoutesFinder } from "./routes-finder"
import { RoutesSorter } from "./routes-sorter"

export class ApiLoader {
  /**
   * Wrap the original route handler implementation for
   * instrumentation.
   */
  static traceRoute?: HttpTraceRoute

  /**
   * Wrap the original middleware handler implementation for
   * instrumentation.
   */
  static traceMiddleware?: HttpTraceMiddleware

  /**
   * HTTP runtime adapter
   * @private
   */
  readonly #httpAdapter: HttpRuntimeAdapter

  /**
   * HTTP resource resolver
   * @private
   */
  readonly #resourceResolver: HttpResourceResolver

  /**
   * Path from where to load the routes from
   * @private
   */
  readonly #sourceDirs: string[]

  readonly #logger: Logger

  constructor({
    app,
    sourceDir,
    baseRestrictedFields = [],
    container,
    resourceResolver,
  }: {
    app: Express
    sourceDir: string | string[]
    baseRestrictedFields?: string[]
    container: MedusaContainer
    resourceResolver?: HttpResourceResolver
  }) {
    this.#sourceDirs = Array.isArray(sourceDir) ? sourceDir : [sourceDir]
    this.#logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    this.#httpAdapter = new ExpressHttpAdapter({
      app,
      logger: this.#logger,
      traceRoute: ApiLoader.traceRoute,
      traceMiddleware: ApiLoader.traceMiddleware,
      isRouteFileDisabled: (matcher) => this.#isRouteFileDisabled(matcher),
    })
    this.#resourceResolver =
      resourceResolver ?? new FilesystemHttpResourceResolver(this.#sourceDirs)
    this.#httpAdapter.registerRestrictedFields(baseRestrictedFields ?? [])
  }

  async #loadHttpResources(): Promise<HttpResourceSet> {
    return await this.#resourceResolver.resolve()
  }

  /**
   * Checks if a route file is disabled for a given matcher and method
   * by trying to find the corresponding route file path
   */
  #isRouteFileDisabled(matcher: string): boolean {
    const routePathSegments = matcher
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        if (segment.startsWith(":")) {
          return `[${segment.slice(1)}]`
        }
        return segment
      })

    for (const sourceDir of this.#sourceDirs) {
      for (const ext of [".ts", ".js"]) {
        const routeFilePath = join(
          sourceDir,
          ...routePathSegments,
          `route${ext}`
        )

        if (isFileDisabled(routeFilePath)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Creates the options for the Cors middleware
   */
  #createCorsOptions(origin: string): CorsOptions {
    return {
      origin: parseCorsOrigins(origin),
      credentials: true,
      preflightContinue: false,
    }
  }

  /**
   * Assigns global cors middleware for a given prefix
   */
  #applyCorsMiddleware(
    routesFinder: RoutesFinder<RouteDescriptor>,
    namespace: string,
    toggleKey:
      | "shouldAppendAdminCors"
      | "shouldAppendAuthCors"
      | "shouldAppendStoreCors",
    corsOptions: CorsOptions
  ) {
    const logger = this.#logger
    const corsFn = cors(corsOptions)
    const corsMiddleware: MiddlewareFunction = function corsMiddleware(
      req,
      res,
      next
    ) {
      let method: string = req.method
      if (req.method === "OPTIONS") {
        method = req.headers["access-control-request-method"] ?? req.method
      }

      const path = `${namespace}${req.path}`
      const matchingRoute = routesFinder.find(path, method as MiddlewareVerb)
      if (matchingRoute && matchingRoute[toggleKey] === true) {
        return corsFn(req, res, next)
      }

      logger.debug(`Skipping CORS middleware ${req.method} ${path}`)
      return next()
    }

    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      ApiLoader.traceMiddleware
        ? ApiLoader.traceMiddleware(corsMiddleware, {
            route: namespace,
          })
        : corsMiddleware
    )
  }

  /**
   * Applies the route middleware on a route. Encapsulates the logic
   * needed to pass the middleware via the trace calls
   */
  #applyAuthMiddleware(
    routesFinder: RoutesFinder<RouteDescriptor>,
    namespace: string,
    actorType: string | string[],
    authType: AuthType | AuthType[],
    options?: { allowUnauthenticated?: boolean; allowUnregistered?: boolean }
  ) {
    const logger = this.#logger
    logger.debug(`Registering auth middleware for prefix ${namespace}`)

    const originalFn = authenticate(actorType, authType, options)
    const authMiddleware: MiddlewareFunction = function authMiddleware(
      req,
      res,
      next
    ) {
      const path = `${namespace}${req.path}`
      const matchingRoute = routesFinder.find(
        path,
        req.method as MiddlewareVerb
      )
      if (matchingRoute && matchingRoute.optedOutOfAuth) {
        logger.debug(`Skipping auth ${req.method} ${path}`)
        return next()
      }

      logger.debug(`Authenticating route ${req.method} ${path}`)
      return originalFn(req, res, next)
    }

    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      ApiLoader.traceMiddleware
        ? ApiLoader.traceMiddleware(authMiddleware, {
            route: namespace,
          })
        : authMiddleware
    )
  }

  /**
   * Apply the most specific body parser middleware to the router
   */
  #applyBodyParserMiddleware(
    namespace: string,
    routesFinder: RoutesFinder<BodyParserConfigRoute>
  ): void {
    this.#logger.debug(
      `Registering bodyparser middleware for prefix ${namespace}`
    )
    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      createBodyParserMiddlewaresStack(
        namespace,
        routesFinder,
        ApiLoader.traceMiddleware
      )
    )
  }

  /**
   * Applies the route middleware on a route. Encapsulates the logic
   * needed to pass the middleware via the trace calls
   */
  #assignAdditionalDataValidator(
    namespace: string,
    routesFinder: RoutesFinder<AdditionalDataValidatorRoute>
  ) {
    const logger = this.#logger
    logger.debug(
      `Registering assignAdditionalDataValidator middleware for prefix ${namespace}`
    )

    const additionalDataValidator = function additionalDataValidator(
      req: MedusaRequest,
      _: MedusaResponse,
      next: MedusaNextFunction
    ) {
      const matchingRoute = routesFinder.find(
        req.path,
        req.method as MiddlewareVerb
      )
      if (matchingRoute && matchingRoute.validator) {
        logger.debug(
          `Using validator to validate additional data on ${req.method} ${req.path}`
        )
        req.additionalDataValidator = matchingRoute.validator
      }
      return next()
    }

    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      ApiLoader.traceMiddleware
        ? (ApiLoader.traceMiddleware(additionalDataValidator, {
            route: namespace,
          }) as MiddlewareFunction)
        : additionalDataValidator
    )
  }

  /**
   * Applies the middleware to authenticate the headers to contain
   * a `x-publishable-key` header
   */
  #applyStorePublishableKeyMiddleware(namespace: string) {
    this.#logger.debug(
      `Registering publishable key middleware for namespace ${namespace}`
    )
    let middleware = ApiLoader.traceMiddleware
      ? ApiLoader.traceMiddleware(ensurePublishableApiKeyMiddleware, {
          route: namespace,
        })
      : ensurePublishableApiKeyMiddleware

    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      middleware as MiddlewareFunction
    )
  }

  #applyLocaleMiddleware(namespace: string) {
    this.#logger.debug(
      `Registering locale middleware for namespace ${namespace}`
    )
    let middleware = ApiLoader.traceMiddleware
      ? ApiLoader.traceMiddleware(applyLocale, {
          route: namespace,
        })
      : applyLocale
    this.#httpAdapter.registerGlobalMiddleware(
      namespace,
      middleware as MiddlewareFunction
    )
  }

  #registerHttpResources({
    errorHandler: sourceErrorHandler,
    middlewares,
    routes,
    bodyParserConfigRoutes,
    additionalDataValidatorRoutes,
  }: HttpResourceSet): void {
    const routesFinder = new RoutesFinder<RouteDescriptor>()
    const {
      projectConfig: {
        http: { adminCors, storeCors, authCors },
      },
    } = configManager.config

    const bodyParserRoutesFinder = new RoutesFinder<BodyParserConfigRoute>(
      new RoutesSorter(bodyParserConfigRoutes).sort([
        "static",
        "params",
        "regex",
        "wildcard",
        "global",
      ])
    )
    this.#applyBodyParserMiddleware("/", bodyParserRoutesFinder)

    if (additionalDataValidatorRoutes.length) {
      const additionalDataValidatorRoutesFinder =
        new RoutesFinder<AdditionalDataValidatorRoute>(
          new RoutesSorter(additionalDataValidatorRoutes).sort([
            "static",
            "params",
            "regex",
            "wildcard",
            "global",
          ])
        )
      this.#assignAdditionalDataValidator(
        "/",
        additionalDataValidatorRoutesFinder
      )
    }

    this.#applyCorsMiddleware(
      routesFinder,
      "/admin",
      "shouldAppendAdminCors",
      this.#createCorsOptions(adminCors)
    )
    this.#applyAuthMiddleware(routesFinder, "/admin", "user", [
      "bearer",
      "session",
      "api-key",
    ])

    this.#applyCorsMiddleware(
      routesFinder,
      "/store",
      "shouldAppendStoreCors",
      this.#createCorsOptions(storeCors)
    )
    this.#applyStorePublishableKeyMiddleware("/store")

    this.#applyLocaleMiddleware("/store")

    this.#applyAuthMiddleware(
      routesFinder,
      "/store",
      "customer",
      ["bearer", "session"],
      {
        allowUnauthenticated: true,
      }
    )

    this.#applyCorsMiddleware(
      routesFinder,
      "/auth",
      "shouldAppendAuthCors",
      this.#createCorsOptions(authCors)
    )

    const collectionToSort = ([] as (MiddlewareDescriptor | RouteDescriptor)[])
      .concat(middlewares)
      .concat(routes)

    const sortedRoutes = new RoutesSorter(collectionToSort).sort()
    sortedRoutes.forEach((route) => {
      if ("isRoute" in route) {
        routesFinder.add(route)
      }
      this.#httpAdapter.registerResource(route)
    })

    this.#httpAdapter.registerErrorHandler(
      sourceErrorHandler ??
        (errorHandler() as unknown as MedusaErrorHandlerFunction)
    )
  }

  async load() {
    if (FeatureFlag.isFeatureEnabled("backend_hmr")) {
      ;(global as any).__MEDUSA_HMR_API_LOADER__ = this
    }

    const resources = await this.#loadHttpResources()
    this.#registerHttpResources(resources)
  }

  /**
   * Clear all API resources registered by this loader
   * This removes all routes and middleware added after the initial stack state
   * Used by HMR to reset the API state before reloading
   */
  clearAllResources() {
    const initialStackLength =
      (global as any).__MEDUSA_HMR_INITIAL_STACK_LENGTH__ ?? 0

    this.#httpAdapter.clearAllResources(initialStackLength)
  }
}
