import {
  createFetchHttpStaticHandler,
  FetchHttpAdapter,
} from "../adapters/fetch"
import {
  customersCreateMiddlewareMock,
  customersCreateMiddlewareValidatorMock,
  customersGlobalMiddlewareMock,
  storeGlobalMiddlewareMock,
} from "../__fixtures__/mocks"
import * as productMiddlewares from "../__fixtures__/static-middlewares/products-middlewares"
import {
  StaticHttpManifestResolver,
  StaticHttpResourceResolver,
} from "../resolvers"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { FeatureFlag } from "@medusajs/utils/feature-flags/flag-router"
import { MedusaError } from "@medusajs/utils/common/errors"
import { PUBLISHABLE_KEY_HEADER } from "@medusajs/utils/api-key/api-key-type"
import { staticHttpManifest } from "../__fixtures__/static-http-package/static-http-manifest"
import { applyLocale } from "../middlewares/apply-locale"
import { authenticate } from "../middlewares/authenticate-middleware"
import { ensurePublishableApiKeyMiddleware } from "../middlewares/ensure-publishable-api-key"
import { errorHandler } from "../middlewares/error-handler"
import {
  MiddlewareDescriptor,
  RouteDescriptor,
} from "../types"
import { buildStaticMiddlewareResources } from "../utils/static-middleware-resources"
import {
  getMedusaRequestAuthContext,
  getMedusaRequestPublishableKeyContext,
  setMedusaRequestAuthContext,
} from "../utils/request-context"

describe("FetchHttpAdapter", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("creates a static Fetch handler with setup interception and manifest path matching", async () => {
    const routeHandler = jest.fn((_req, res) => {
      res.status(200).send("handled")
    })
    const resources = await new StaticHttpResourceResolver({
      routes: [
        {
          isRoute: true,
          matcher: "/fetch-static-handler",
          method: "GET",
          handler: routeHandler,
          optedOutOfAuth: true,
          shouldAppendAdminCors: false,
          shouldAppendAuthCors: false,
          shouldAppendStoreCors: false,
        } satisfies RouteDescriptor,
      ],
    }).resolve()
    const handler = createFetchHttpStaticHandler({
      manifest: {
        routes: [
          {
            route: "/fetch-static-handler",
            module: {},
          },
        ],
      },
      resources,
      handleSetupRequest: (request) => {
        return new URL(request.url).pathname === "/fetch-static-setup"
          ? new Response("setup")
          : undefined
      },
      isSetupPath: (pathname) => pathname === "/fetch-static-setup",
    })

    expect(handler.isPathHandled("/fetch-static-handler")).toBe(true)
    expect(handler.isPathHandled("/fetch-static-setup")).toBe(true)
    expect(handler.isPathHandled("/unhandled")).toBe(false)

    const missingResponse = await handler.tryHandle(
      new Request("https://medusa.test/unhandled")
    )
    expect(missingResponse).toBeUndefined()

    const setupResponse = await handler.tryHandle(
      new Request("https://medusa.test/fetch-static-setup")
    )
    if (!setupResponse) {
      throw new Error("Expected setup request to be handled")
    }
    expect(setupResponse.status).toBe(200)
    expect(await setupResponse.text()).toBe("setup")
    expect(routeHandler).not.toHaveBeenCalled()

    const routeResponse = await handler.tryHandle(
      new Request("https://medusa.test/fetch-static-handler", {
        method: "GET",
      })
    )
    if (!routeResponse) {
      throw new Error("Expected static route request to be handled")
    }
    expect(routeResponse.status).toBe(200)
    expect(await routeResponse.text()).toBe("handled")
    expect(routeHandler).toHaveBeenCalledTimes(1)
  })

  it("uses the default Medusa error handler for static Fetch route errors", async () => {
    const requestScope = createMedusaContainer()
    requestScope.register({
      [ContainerRegistrationKeys.LOGGER]: {
        resolve: () => ({
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
        }),
      },
    })
    const handler = createFetchHttpStaticHandler({
      manifest: {
        routes: [
          {
            route: "/fetch-static-default-error",
            module: {
              GET: () => {
                throw new MedusaError(
                  MedusaError.Types.NOT_FOUND,
                  "Static route entity was not found"
                )
              },
            },
          },
        ],
      },
      createRequestScope: () => requestScope,
    })

    const response = await handler.handle(
      new Request("https://medusa.test/fetch-static-default-error")
    )
    const body: unknown = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual(
      expect.objectContaining({
        type: "not_found",
        message: "Static route entity was not found",
      })
    )
  })

  it("creates a static Fetch handler from merged manifests and composed resource sets", async () => {
    const firstRouteHandler = jest.fn((_req, res) => {
      res.status(200).json({ route: "first" })
    })
    const secondRouteHandler = jest.fn((req, res) => {
      res.status(200).json({
        route: "second",
        prepared: req.context?.prepared === true,
      })
    })
    const beforeMiddleware = jest.fn((_req, _res, next) => {
      next()
    })
    const handler = createFetchHttpStaticHandler({
      manifest: [
        {
          routes: [
            {
              route: "/fetch-static-merged-first",
              module: { GET: firstRouteHandler },
            },
          ],
        },
        {
          routes: [
            {
              route: "/fetch-static-merged-second",
              module: { GET: secondRouteHandler },
            },
          ],
        },
      ],
      resourcesBeforeManifest: [
        {
          middlewares: [
            {
              matcher: "/fetch-static-merged-second",
              methods: ["GET"],
              handler: beforeMiddleware,
            },
          ],
        },
      ],
      prepareRequest: (req) => {
        req.context = {
          ...req.context,
          prepared: true,
        }
      },
    })

    expect(handler.isPathHandled("/fetch-static-merged-first")).toBe(true)
    expect(handler.isPathHandled("/fetch-static-merged-second")).toBe(true)
    expect(handler.isPathHandled("/fetch-static-merged-missing")).toBe(false)

    const firstResponse = await handler.handle(
      new Request("https://medusa.test/fetch-static-merged-first")
    )
    const firstBody: unknown = await firstResponse.json()
    expect(firstResponse.status).toBe(200)
    expect(firstBody).toEqual({ route: "first" })
    expect(firstRouteHandler).toHaveBeenCalledTimes(1)

    const secondResponse = await handler.handle(
      new Request("https://medusa.test/fetch-static-merged-second")
    )
    const secondBody: unknown = await secondResponse.json()
    expect(secondResponse.status).toBe(200)
    expect(secondBody).toEqual({ route: "second", prepared: true })
    expect(secondRouteHandler).toHaveBeenCalledTimes(1)
    expect(beforeMiddleware).toHaveBeenCalledTimes(1)
  })

  it("executes an existing static route descriptor through Fetch Request/Response", async () => {
    const resources = await new StaticHttpManifestResolver(
      staticHttpManifest
    ).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/customers", { method: "GET" })
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("list customers")
    expect(customersGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareMock).not.toHaveBeenCalled()
  })

  it("executes matching method middleware before an existing route descriptor", async () => {
    const resources = await new StaticHttpManifestResolver(
      staticHttpManifest
    ).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/customers", { method: "POST" })
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("create customer")
    expect(customersGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareValidatorMock).toHaveBeenCalled()
  })

  it("supports Express-style sendStatus in route descriptors", async () => {
    const route = {
      isRoute: true,
      matcher: "/send-status",
      method: "POST",
      handler: (_req, res) => {
        res.sendStatus(201)
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/send-status", { method: "POST" })
    )

    expect(response.status).toBe(201)
    expect(response.headers.get("content-type")).toContain("text/plain")
    expect(await response.text()).toBe("Created")
  })

  it("supports Express-style numeric res.send status responses", async () => {
    const route = {
      isRoute: true,
      matcher: "/send-status-number",
      method: "POST",
      handler: (_req, res) => {
        res.send(200)
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/send-status-number", { method: "POST" })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/plain")
    expect(await response.text()).toBe("OK")
  })

  it("sets the Express-style request protocol from the Fetch request URL", async () => {
    const route = {
      isRoute: true,
      matcher: "/protocol",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          protocol: req.protocol,
          url: req.url,
          originalUrl: req.originalUrl,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/protocol?source=fetch")
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      protocol: "https",
      url: "/protocol?source=fetch",
      originalUrl: "/protocol?source=fetch",
    })
  })

  it("supports Express-style streaming response helpers", async () => {
    const route = {
      isRoute: true,
      matcher: "/events",
      method: "GET",
      handler: (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        })

        setTimeout(() => {
          res.write("event: ready\n")
          res.end("data: ok\n\n")
        }, 0)
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/events", { method: "GET" })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(await response.text()).toBe("event: ready\ndata: ok\n\n")
  })

  it("maps request close listeners to the Fetch abort signal", async () => {
    let closed = false
    const route = {
      isRoute: true,
      matcher: "/events/close",
      method: "GET",
      handler: (req, res) => {
        req.on("close", () => {
          closed = true
          res.end()
        })

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)
    const controller = new AbortController()

    const response = await adapter.handle(
      new Request("https://medusa.test/events/close", {
        method: "GET",
        signal: controller.signal,
      })
    )

    controller.abort()

    expect(await response.text()).toBe("")
    expect(closed).toBe(true)
  })

  it("uses Medusa route sorting before matching route descriptors", async () => {
    const paramRoute = {
      isRoute: true,
      matcher: "/sorted-routes/:id",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          route: "param",
          id: req.params.id,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const staticRoute = {
      isRoute: true,
      matcher: "/sorted-routes/static",
      method: "GET",
      handler: (_req, res) => {
        res.status(200).json({
          route: "static",
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [paramRoute, staticRoute],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/sorted-routes/static", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      route: "static",
    })
  })

  it("uses Medusa middleware sorting before running middleware descriptors", async () => {
    const staticMiddleware = {
      matcher: "/sorted-middlewares/static",
      methods: ["GET"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          trace: [...getTrace(req.context?.trace), "static"],
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const wildcardMiddleware = {
      matcher: "/sorted-middlewares/*",
      methods: ["GET"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          trace: [...getTrace(req.context?.trace), "wildcard"],
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/sorted-middlewares/static",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          trace: getTrace(req.context?.trace),
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [staticMiddleware, wildcardMiddleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/sorted-middlewares/static", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      trace: ["wildcard", "static"],
    })
  })

  it("does not run sorted param middleware registered after a matching static route", async () => {
    const staticMiddleware = {
      matcher: "/sorted-shadow/batch",
      methods: ["POST"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          trace: [...getTrace(req.context?.trace), "batch-middleware"],
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const paramMiddleware = {
      matcher: "/sorted-shadow/:id",
      methods: ["POST"],
      handler: jest.fn((_req, _res, next) => {
        next()
      }),
    } satisfies MiddlewareDescriptor
    const batchRoute = {
      isRoute: true,
      matcher: "/sorted-shadow/batch",
      method: "POST",
      handler: (req, res) => {
        res.status(200).json({
          trace: getTrace(req.context?.trace),
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const paramRoute = {
      isRoute: true,
      matcher: "/sorted-shadow/:id",
      method: "POST",
      handler: (_req, res) => {
        res.status(200).json({
          route: "param",
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [batchRoute, paramRoute],
      middlewares: [staticMiddleware, paramMiddleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/sorted-shadow/batch", {
        method: "POST",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      trace: ["batch-middleware"],
    })
    expect(paramMiddleware.handler).not.toHaveBeenCalled()
  })

  it("supports explicit prefix middleware matching", async () => {
    const middleware = {
      matcher: "/store",
      pathMatching: "prefix",
      methods: ["GET"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          matchedPrefix: true,
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/store/products",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          matchedPrefix: req.context?.matchedPrefix,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/store/products", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      matchedPrefix: true,
    })
  })

  it("keeps method-scoped static middleware exact for nested routes", async () => {
    const parentMiddleware = {
      matcher: "/store/carts/:id",
      methods: ["POST"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          parentMiddlewareRan: true,
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const nestedRoute = {
      isRoute: true,
      matcher: "/store/carts/:id/line-items",
      method: "POST",
      handler: (req, res) => {
        res.status(200).json({
          cartId: req.params.id,
          parentMiddlewareRan: req.context?.parentMiddlewareRan ?? false,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [nestedRoute],
      middlewares: [parentMiddleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/store/carts/cart_123/line-items", {
        method: "POST",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      cartId: "cart_123",
      parentMiddlewareRan: false,
    })
  })

  it("assigns a request scope before middleware and route handlers execute", async () => {
    const requestScope = createMedusaContainer()
    const resolveMock = jest.fn((key: string) => `resolved:${key}`)
    requestScope.resolve = resolveMock
    const middleware = {
      matcher: "/scoped-route",
      methods: ["GET"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          middlewareValue: req.scope.resolve("middleware"),
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/scoped-route",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          middlewareValue: req.context?.middlewareValue,
          routeValue: req.scope.resolve("route"),
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      createRequestScope: () => requestScope,
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/scoped-route", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      middlewareValue: "resolved:middleware",
      routeValue: "resolved:route",
    })
    expect(resolveMock).toHaveBeenCalledWith("middleware")
    expect(resolveMock).toHaveBeenCalledWith("route")
  })

  it("initializes Medusa request defaults before middleware executes", async () => {
    const middleware = {
      matcher: "/request-defaults",
      methods: ["GET"],
      handler: (req, res) => {
        res.status(200).json({
          allowedProperties: req.allowedProperties,
          errors: req.errors,
          filterableFields: req.filterableFields,
          listConfig: req.listConfig,
          retrieveConfig: req.retrieveConfig,
          queryConfig: req.queryConfig,
          remoteQueryConfig: req.remoteQueryConfig,
          context: req.context,
        })
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/request-defaults",
      method: "GET",
      handler: (_req, res) => {
        res.status(500).json({ error: "middleware should end response" })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/request-defaults")
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      allowedProperties: [],
      errors: [],
      filterableFields: {},
      listConfig: {},
      retrieveConfig: {},
      queryConfig: {
        fields: [],
        pagination: {
          skip: 0,
        },
      },
      remoteQueryConfig: {
        fields: [],
        pagination: {
          skip: 0,
        },
      },
      context: {},
    })
  })

  it("runs framework middleware that reads headers through req.get", async () => {
    const route = {
      isRoute: true,
      matcher: "/localized-route",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          locale: req.locale,
          query: req.query,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [
        {
          matcher: "/localized-route",
          handler: applyLocale,
        },
      ],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/localized-route?source=fetch", {
        method: "GET",
        headers: {
          "x-medusa-locale": "en-us",
        },
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      locale: "en-US",
      query: {
        source: "fetch",
      },
    })
  })

  it("normalizes bracket array query parameters before middleware executes", async () => {
    const middleware = {
      matcher: "/array-query",
      methods: ["GET"],
      handler: (req, res) => {
        res.status(200).json({
          query: req.query,
        })
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/array-query",
      method: "GET",
      handler: (_req, res) => {
        res.status(500).json({ error: "middleware should end response" })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request(
        "https://medusa.test/array-query?code[]=en-US&code[]=fr-FR&sales_channel_id[0]=sc_1&q=french&$and[0][category_id][0]=pcat_1&$and[0][category_id][1]=pcat_2&variants.options[option_id]=opt_1"
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      query: {
        $and: [
          {
            category_id: ["pcat_1", "pcat_2"],
          },
        ],
        code: ["en-US", "fr-FR"],
        sales_channel_id: ["sc_1"],
        q: "french",
        variants: {
          options: {
            option_id: "opt_1",
          },
        },
      },
    })
  })

  it("runs publishable key middleware through the Fetch request scope", async () => {
    const requestScope = createMedusaContainer()
    requestScope.register({
      [ContainerRegistrationKeys.QUERY]: {
        resolve: () => ({
          graph: jest.fn(async () => ({
            data: [
              {
                id: "apk_test",
                token: "pk_test",
                revoked_at: null,
                sales_channels_link: [
                  {
                    sales_channel_id: "sc_test",
                  },
                ],
              },
            ],
          })),
        }),
      },
    })

    const route = {
      isRoute: true,
      matcher: "/store/publishable-proof",
      method: "GET",
      handler: (req, res) => {
        const context = getMedusaRequestPublishableKeyContext(req)
        res.status(200).json({
          key: context?.key,
          salesChannelIds: context?.sales_channel_ids ?? [],
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [
        {
          matcher: "/store",
          pathMatching: "prefix",
          handler: ensurePublishableApiKeyMiddleware,
        },
      ],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      createRequestScope: () => requestScope,
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/store/publishable-proof", {
        method: "GET",
        headers: {
          [PUBLISHABLE_KEY_HEADER]: "pk_test",
        },
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      key: "pk_test",
      salesChannelIds: ["sc_test"],
    })
  })

  it("runs optional customer auth middleware through the Fetch request scope", async () => {
    const requestScope = createMedusaContainer()
    requestScope.register({
      [ContainerRegistrationKeys.CONFIG_MODULE]: {
        resolve: () => ({
          projectConfig: {
            http: {
              jwtSecret: "test-secret",
            },
          },
        }),
      },
    })

    const route = {
      isRoute: true,
      matcher: "/store/auth-proof",
      method: "GET",
      handler: (req, res) => {
        const context = getMedusaRequestAuthContext(req)
        res.status(200).json({
          actorType: context?.actor_type ?? "unauthenticated",
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [
        {
          matcher: "/store",
          pathMatching: "prefix",
          handler: authenticate("customer", ["session", "bearer"], {
            allowUnauthenticated: true,
          }) as MiddlewareDescriptor["handler"],
        },
      ],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      createRequestScope: () => requestScope,
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/store/auth-proof", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      actorType: "unauthenticated",
    })
  })

  it("commits Fetch request sessions after route handlers mutate them", async () => {
    const committedSessions: unknown[] = []
    const route = {
      isRoute: true,
      matcher: "/auth/session-proof",
      method: "POST",
      handler: (req, res) => {
        req.session.auth_context = {
          actor_id: "user_fetch_session",
          actor_type: "user",
          auth_identity_id: "auth_fetch_session",
          app_metadata: {},
          user_metadata: {},
        }
        res.status(200).json({ ok: true })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      createSession: () => ({}),
      commitSession: ({ session, responseHeaders }) => {
        committedSessions.push(session.auth_context)
        responseHeaders.append(
          "set-cookie",
          "connect.sid=session_fetch_proof; Path=/; HttpOnly"
        )
      },
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/auth/session-proof", {
        method: "POST",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(committedSessions).toEqual([
      {
        actor_id: "user_fetch_session",
        actor_type: "user",
        auth_identity_id: "auth_fetch_session",
        app_metadata: {},
        user_metadata: {},
      },
    ])
    expect(response.headers.get("set-cookie")).toBe(
      "connect.sid=session_fetch_proof; Path=/; HttpOnly"
    )
  })

  it("authenticates with an upstream runtime auth context before JWT verification", async () => {
    const route = {
      isRoute: true,
      matcher: "/auth/upstream-context-proof",
      method: "POST",
      handler: (req, res) => {
        const context = getMedusaRequestAuthContext(req)
        res.status(200).json({
          actorId: context?.actor_id,
          actorType: context?.actor_type,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [
        {
          matcher: "/auth/upstream-context-proof",
          methods: ["POST"],
          handler: authenticate("*", "bearer") as MiddlewareDescriptor["handler"],
        },
      ],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      prepareRequest: (req) => {
        setMedusaRequestAuthContext(req, {
          actor_id: "user_upstream_context",
          actor_type: "user",
          auth_identity_id: "auth_upstream_context",
          app_metadata: {},
          user_metadata: {},
        })
      },
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/auth/upstream-context-proof", {
        method: "POST",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      actorId: "user_upstream_context",
      actorType: "user",
    })
  })

  it("applies middleware policies when RBAC is enabled", async () => {
    const featureFlagSpy = jest
      .spyOn(FeatureFlag, "isFeatureEnabled")
      .mockImplementation((flag) => flag === "rbac")
    const requestScope = createMedusaContainer()
    requestScope.register({
      [ContainerRegistrationKeys.LOGGER]: {
        resolve: () => ({
          error: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
        }),
      },
    })
    const route = {
      isRoute: true,
      matcher: "/admin/policy-proof",
      method: "GET",
      handler: (_req, res) => {
        res.status(200).json({ allowed: true })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [
        {
          matcher: "/admin/policy-proof",
          methods: ["GET"],
          handler: (_req, _res, next) => next(),
          policies: {
            resource: "currency",
            operation: "read",
          },
        },
      ],
      errorHandler: errorHandler(),
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      createRequestScope: () => requestScope,
    })

    try {
      const response = await adapter.handle(
        new Request("https://medusa.test/admin/policy-proof")
      )
      const body: unknown = await response.json()

      expect(response.status).toBe(403)
      expect(body).toEqual(
        expect.objectContaining({
          type: "forbidden",
          message: "Forbidden",
        })
      )
    } finally {
      featureFlagSpy.mockRestore()
    }
  })

  it("prepares a Medusa request before middleware and route handlers execute", async () => {
    const middleware = {
      matcher: "/prepared-route",
      methods: ["GET"],
      handler: (req, _res, next) => {
        req.context = {
          ...(req.context ?? {}),
          middlewareFields: req.queryConfig.fields,
        }
        next()
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/prepared-route",
      method: "GET",
      handler: (req, res) => {
        res.status(200).json({
          middlewareFields: req.context?.middlewareFields,
          routeFields: req.queryConfig.fields,
          filters: req.filterableFields,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources, {
      prepareRequest: (req) => {
        req.queryConfig = {
          fields: ["id", "value"],
          pagination: {
            skip: 0,
            take: 20,
          },
        }
        req.remoteQueryConfig = req.queryConfig
        req.filterableFields = {
          value: "prepared",
        }
      },
    })

    const response = await adapter.handle(
      new Request("https://medusa.test/prepared-route", {
        method: "GET",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      middlewareFields: ["id", "value"],
      routeFields: ["id", "value"],
      filters: {
        value: "prepared",
      },
    })
  })

  it("parses JSON request bodies before middleware and route handlers", async () => {
    const middlewareResources = buildStaticMiddlewareResources({
      module: productMiddlewares,
    })
    const route = {
      isRoute: true,
      matcher: "/static-middleware-products",
      method: "POST",
      handler: (req, res) => {
        res.status(201).json({
          body: req.body,
          hasAdditionalDataValidator:
            req.context?.hasAdditionalDataValidator,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      ...middlewareResources,
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/static-middleware-products", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Static product",
        }),
      })
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      body: {
        title: "Static product",
      },
      hasAdditionalDataValidator: true,
    })
  })

  it("skips JSON body parsing when a matching body parser config disables it", async () => {
    const middlewareResources = buildStaticMiddlewareResources({
      module: productMiddlewares,
    })
    const route = {
      isRoute: true,
      matcher: "/static-raw",
      method: "POST",
      handler: (req, res) => {
        res.status(200).json({
          hasBody: req.body !== undefined,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      ...middlewareResources,
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/static-raw", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "Raw product",
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      hasBody: false,
    })
  })

  it("preserves raw JSON body bytes when the body parser config requests it", async () => {
    const route = {
      isRoute: true,
      matcher: "/preserve-raw-json",
      method: "POST",
      handler: (req, res) => {
        const rawBody: unknown = req.rawBody

        res.status(200).json({
          body: req.body,
          rawBodyText:
            rawBody instanceof Uint8Array
              ? new TextDecoder().decode(rawBody)
              : null,
        })
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      bodyParserConfigRoutes: [
        {
          matcher: "/preserve-raw-json",
          methods: "POST",
          config: {
            preserveRawBody: true,
          },
        },
      ],
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const rawJson = JSON.stringify({
      provider: "stripe",
      event: "payment_intent.succeeded",
    })
    const response = await adapter.handle(
      new Request("https://medusa.test/preserve-raw-json", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: rawJson,
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      body: {
        provider: "stripe",
        event: "payment_intent.succeeded",
      },
      rawBodyText: rawJson,
    })
  })

  it("runs a static error handler when a route throws", async () => {
    const middlewareResources = buildStaticMiddlewareResources({
      module: productMiddlewares,
    })
    const route = {
      isRoute: true,
      matcher: "/static-route-error",
      method: "GET",
      handler: () => {
        throw new Error("Route failure")
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      errorHandler: middlewareResources.errorHandler,
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/static-route-error", { method: "GET" })
    )

    expect(response.status).toBe(418)
    expect(await response.json()).toEqual({
      message: "Route failure",
    })
  })

  it("runs a static error handler when middleware calls next with an error", async () => {
    const middlewareResources = buildStaticMiddlewareResources({
      module: productMiddlewares,
    })
    const middleware = {
      matcher: "/static-middleware-error",
      methods: ["GET"],
      handler: (_req, _res, next) => {
        next(new Error("Middleware failure"))
      },
    } satisfies MiddlewareDescriptor
    const route = {
      isRoute: true,
      matcher: "/static-middleware-error",
      method: "GET",
      handler: (_req, res) => {
        res.status(200).send("unreachable")
      },
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor
    const resources = await new StaticHttpResourceResolver({
      routes: [route],
      middlewares: [middleware],
      errorHandler: middlewareResources.errorHandler,
    }).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/static-middleware-error", {
        method: "GET",
      })
    )

    expect(response.status).toBe(418)
    expect(await response.json()).toEqual({
      message: "Middleware failure",
    })
  })

  it("passes dynamic route params to existing handlers", async () => {
    const resources = await new StaticHttpManifestResolver(
      staticHttpManifest
    ).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/store/products/prod_123/sync", {
        method: "POST",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("sync product prod_123")
    expect(storeGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersGlobalMiddlewareMock).not.toHaveBeenCalled()
  })

  it("returns 404 when no route descriptor matches", async () => {
    const resources = await new StaticHttpManifestResolver(
      staticHttpManifest
    ).resolve()
    const adapter = new FetchHttpAdapter(resources)

    const response = await adapter.handle(
      new Request("https://medusa.test/missing", { method: "GET" })
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("Not Found")
  })
})

function getTrace(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}
