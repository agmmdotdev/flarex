import { createServer } from "../__fixtures__/server"
import * as productRoute from "../__fixtures__/static-routes/products-route"
import { StaticHttpResourceResolver } from "../resolvers"
import { buildStaticRouteDescriptors } from "../utils/static-route-descriptors"
import { resolve } from "path"

describe("buildStaticRouteDescriptors", () => {
  it("skips route modules marked with the Medusa skip-file symbol", () => {
    const descriptors = buildStaticRouteDescriptors({
      route: "/store/skipped-products",
      module: {
        [Symbol.for("__MEDUSA_SKIP_FILE__")]: true,
        GET: jest.fn(),
      },
    })

    expect(descriptors).toEqual([])
  })

  it("builds route descriptors from imported route modules", () => {
    const descriptors = buildStaticRouteDescriptors({
      route: "/store/static-products",
      module: productRoute,
      absolutePath: "static-products-route",
      relativePath: "/store/static-products/route.ts",
    })

    expect(descriptors).toHaveLength(2)
    expect(descriptors.map((descriptor) => descriptor.method).sort()).toEqual([
      "GET",
      "POST",
    ])
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          absolutePath: "static-products-route",
          relativePath: "/store/static-products/route.ts",
          matcher: "/store/static-products",
          method: "GET",
          optedOutOfAuth: true,
          shouldAppendStoreCors: true,
        }),
        expect.objectContaining({
          matcher: "/store/static-products",
          method: "POST",
          optedOutOfAuth: true,
          shouldAppendStoreCors: true,
        }),
      ])
    )
  })

  it("runs imported route module descriptors through ApiLoader", async () => {
    const routes = buildStaticRouteDescriptors({
      route: "/static-products",
      module: productRoute,
    })
    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpResourceResolver({
        routes,
      }),
    })

    const listResponse = await request("GET", "/static-products")
    const createResponse = await request("POST", "/static-products", {
      payload: { title: "Static product" },
    })

    expect(listResponse.status).toBe(200)
    expect(listResponse.body).toEqual({
      products: [],
    })
    expect(createResponse.status).toBe(201)
    expect(createResponse.body).toEqual({
      product: {
        title: "Static product",
      },
    })
  })
})
