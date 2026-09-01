import { resolve } from "path"
import { createServer } from "../__fixtures__/server"
import * as productMiddlewares from "../__fixtures__/static-middlewares/products-middlewares"
import * as productRoute from "../__fixtures__/static-routes/products-route"
import { StaticHttpManifestResolver } from "../resolvers"

describe("StaticHttpManifestResolver", () => {
  it("resolves imported route and middleware modules into an HttpResourceSet", async () => {
    const resolver = new StaticHttpManifestResolver({
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

    const resources = await resolver.resolve()

    expect(resources.routes.map((route) => route.method).sort()).toEqual([
      "GET",
      "POST",
    ])
    expect(resources.middlewares).toHaveLength(1)
    expect(resources.bodyParserConfigRoutes).toHaveLength(1)
    expect(resources.additionalDataValidatorRoutes).toHaveLength(1)
    expect(resources.errorHandler).toEqual(expect.any(Function))
  })

  it("runs manifest resources through ApiLoader", async () => {
    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpManifestResolver({
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
      }),
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
})
