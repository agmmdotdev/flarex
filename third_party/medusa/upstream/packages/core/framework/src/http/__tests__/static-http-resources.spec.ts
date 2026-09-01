import { resolve } from "path"
import { z } from "@medusajs/deps/zod"
import { createServer } from "../__fixtures__/server"
import * as productMiddlewares from "../__fixtures__/static-middlewares/products-middlewares"
import * as productRoute from "../__fixtures__/static-routes/products-route"
import { StaticHttpResourceResolver } from "../resolvers"
import {
  buildStaticHttpResources,
  composeStaticHttpResourceSets,
  mergeStaticHttpResourceManifests,
} from "../utils/static-http-resources"

describe("buildStaticHttpResources", () => {
  it("builds an HttpResourceSet from imported route and middleware modules", () => {
    const resources = buildStaticHttpResources({
      routes: [
        {
          route: "/static-middleware-products",
          module: productRoute,
          absolutePath: "products-route",
          relativePath: "/static-middleware-products/route.ts",
        },
      ],
      middlewares: [
        {
          module: productMiddlewares,
          source: "products-middlewares",
        },
      ],
    })

    expect(resources.routes).toHaveLength(2)
    expect(resources.routes.map((route) => route.method).sort()).toEqual([
      "GET",
      "POST",
    ])
    expect(resources.middlewares).toHaveLength(1)
    expect(resources.bodyParserConfigRoutes).toHaveLength(1)
    expect(resources.additionalDataValidatorRoutes).toHaveLength(1)
    expect(resources.errorHandler).toEqual(expect.any(Function))
  })

  it("uses the last static middleware error handler", () => {
    const firstErrorHandler = jest.fn()
    const secondErrorHandler = jest.fn()
    const resources = buildStaticHttpResources({
      middlewares: [
        {
          module: {
            default: {
              routes: [],
              errorHandler: firstErrorHandler,
            },
          },
        },
        {
          module: {
            default: {
              routes: [],
              errorHandler: secondErrorHandler,
            },
          },
        },
      ],
    })

    expect(resources.errorHandler).toBe(secondErrorHandler)
  })

  it("composes static resource sets in order with the last error handler", () => {
    const firstRoute = {
      matcher: "/first",
      method: "GET" as const,
      handler: jest.fn(),
      optedOutOfAuth: false,
      isRoute: true as const,
      shouldAppendAdminCors: false,
      shouldAppendStoreCors: false,
      shouldAppendAuthCors: false,
    }
    const secondRoute = {
      ...firstRoute,
      matcher: "/second",
      method: "POST" as const,
    }
    const firstMiddleware = {
      matcher: "/first",
      handler: jest.fn(),
    }
    const secondMiddleware = {
      matcher: "/second",
      handler: jest.fn(),
    }
    const additionalDataValidator = z.object({}).nullable().optional()
    const firstErrorHandler = jest.fn()
    const secondErrorHandler = jest.fn()

    const resources = composeStaticHttpResourceSets(
      {
        routes: [firstRoute],
        middlewares: [firstMiddleware],
        bodyParserConfigRoutes: [
          {
            matcher: "/first",
            methods: ["POST"],
            config: { sizeLimit: "1mb" },
          },
        ],
        errorHandler: firstErrorHandler,
      },
      {
        routes: [secondRoute],
        middlewares: [secondMiddleware],
        additionalDataValidatorRoutes: [
          {
            matcher: "/second",
            methods: ["POST"],
            schema: {},
            validator: additionalDataValidator,
          },
        ],
        errorHandler: secondErrorHandler,
      }
    )

    expect(resources.routes).toEqual([firstRoute, secondRoute])
    expect(resources.middlewares).toEqual([firstMiddleware, secondMiddleware])
    expect(resources.bodyParserConfigRoutes).toEqual([
      {
        matcher: "/first",
        methods: ["POST"],
        config: { sizeLimit: "1mb" },
      },
    ])
    expect(resources.additionalDataValidatorRoutes).toEqual([
      {
        matcher: "/second",
        methods: ["POST"],
        schema: {},
        validator: additionalDataValidator,
      },
    ])
    expect(resources.errorHandler).toBe(secondErrorHandler)
  })

  it("derives route matchers from filesystem-style relative paths", () => {
    const resources = buildStaticHttpResources({
      routes: [
        {
          relativePath: "/store/products/[id]/sync/route.ts",
          module: productRoute,
        },
      ],
    })

    expect(resources.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matcher: "/store/products/:id/sync",
          method: "GET",
          relativePath: "/store/products/[id]/sync/route.ts",
        }),
      ])
    )
  })

  it("runs combined static HTTP resources through ApiLoader", async () => {
    const resources = buildStaticHttpResources({
      routes: [
        {
          route: "/static-middleware-products",
          module: productRoute,
        },
      ],
      middlewares: [
        {
          module: productMiddlewares,
        },
      ],
    })
    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpResourceResolver(resources),
    })

    const response = await request("POST", "/static-middleware-products", {
      payload: {
        title: "Static product",
      },
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      product: {
        title: "Static product",
      },
    })
  })

  it("merges static manifests with later keyed route entries replacing earlier entries", () => {
    const proofRoute = {
      relativePath: "packages/medusa/src/api/store/carts/route.ts",
      route: "/proof-store-carts",
      module: { proof: true },
    }
    const sharedRoute = {
      relativePath: "packages/medusa/src/api/store/carts/route.ts",
      route: "/store/carts",
      module: { shared: true },
    }
    const proofOnlyRoute = {
      relativePath: "apps/medusa-cloudflare/src/http-proof/route.ts",
      route: "/http-proof/:proofId",
      module: { proofOnly: true },
    }

    const merged = mergeStaticHttpResourceManifests(
      {
        routes: [proofRoute, proofOnlyRoute],
      },
      {
        routes: [sharedRoute],
      }
    )

    expect(merged.routes).toEqual([sharedRoute, proofOnlyRoute])
  })

  it("merges static manifests with later keyed middleware entries replacing earlier entries", () => {
    const proofMiddleware = {
      source: "packages/medusa/src/api/store/carts/middlewares.ts",
      module: { proof: true },
    }
    const sharedMiddleware = {
      source: "packages/medusa/src/api/store/carts/middlewares.ts",
      module: { shared: true },
    }
    const keylessMiddleware = {
      module: { keyless: true },
    }

    const merged = mergeStaticHttpResourceManifests(
      {
        middlewares: [proofMiddleware, keylessMiddleware],
      },
      {
        middlewares: [sharedMiddleware],
      }
    )

    expect(merged.middlewares).toEqual([sharedMiddleware, keylessMiddleware])
  })
})
