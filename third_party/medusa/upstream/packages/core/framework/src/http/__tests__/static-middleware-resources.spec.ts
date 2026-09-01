import { resolve } from "path"
import { createServer } from "../__fixtures__/server"
import * as productMiddlewares from "../__fixtures__/static-middlewares/products-middlewares"
import { StaticHttpResourceResolver } from "../resolvers"
import { RouteDescriptor } from "../types"
import { buildStaticMiddlewareResources } from "../utils/static-middleware-resources"

describe("buildStaticMiddlewareResources", () => {
  it("skips middleware modules marked with the Medusa skip-file symbol", () => {
    const resources = buildStaticMiddlewareResources({
      module: {
        [Symbol.for("__MEDUSA_SKIP_FILE__")]: true,
        default: {
          routes: [
            {
              matcher: "/skipped",
              middlewares: [jest.fn()],
            },
          ],
        },
      },
    })

    expect(resources).toEqual({
      middlewares: [],
      bodyParserConfigRoutes: [],
      additionalDataValidatorRoutes: [],
    })
  })

  it("builds HTTP resources from imported middleware modules", () => {
    const resources = buildStaticMiddlewareResources({
      module: productMiddlewares,
      source: "products-middlewares",
    })

    expect(resources.middlewares).toHaveLength(1)
    expect(resources.middlewares[0]).toEqual(
      expect.objectContaining({
        matcher: "/static-middleware-products",
        methods: ["POST"],
        pathMatching: "exact",
      })
    )
    expect(resources.additionalDataValidatorRoutes).toHaveLength(1)
    expect(resources.additionalDataValidatorRoutes[0]).toEqual(
      expect.objectContaining({
        matcher: "/static-middleware-products",
        methods: ["POST"],
        pathMatching: "exact",
        schema: expect.objectContaining({
          title: expect.any(Object),
        }),
      })
    )
    expect(resources.bodyParserConfigRoutes).toEqual([
      {
        matcher: "/static-raw",
        methods: ["POST"],
        pathMatching: "exact",
        config: false,
      },
    ])
    expect(resources.errorHandler).toEqual(expect.any(Function))
  })

  it("honors deprecated method on direct middleware route configs", () => {
    const middleware = jest.fn()
    const resources = buildStaticMiddlewareResources({
      module: {
        default: {
          routes: [
            {
              matcher: "/direct-method",
              method: "GET",
              middlewares: [middleware],
            },
            {
              matcher: "/direct-method",
              method: "POST",
              bodyParser: false,
            },
          ],
        },
      },
    })

    expect(resources.middlewares).toEqual([
      expect.objectContaining({
        matcher: "/direct-method",
        methods: "GET",
        pathMatching: "exact",
      }),
    ])
    expect(resources.bodyParserConfigRoutes).toEqual([
      {
        matcher: "/direct-method",
        methods: "POST",
        pathMatching: "exact",
        config: false,
      },
    ])
  })

  it("runs imported middleware module resources through ApiLoader", async () => {
    const resources = buildStaticMiddlewareResources({
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
    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpResourceResolver({
        routes: [route],
        ...resources,
      }),
    })

    const response = await request("POST", "/static-middleware-products", {
      payload: {
        title: "Static product",
      },
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      body: {
        title: "Static product",
      },
      hasAdditionalDataValidator: true,
    })
  })
})
