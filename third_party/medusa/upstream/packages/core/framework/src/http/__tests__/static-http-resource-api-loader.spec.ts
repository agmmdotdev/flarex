import { resolve } from "path"
import { createServer } from "../__fixtures__/server"
import { StaticHttpResourceResolver } from "../resolvers"
import { MiddlewareFunction, RouteDescriptor } from "../types"

describe("ApiLoader static HTTP resources", () => {
  it("serves statically provided route descriptors through the Express adapter", async () => {
    const handler = jest.fn((_, res) => {
      res.status(200).send("static route")
    })
    const staticRoute = {
      isRoute: true,
      matcher: "/static-route",
      method: "GET",
      handler,
      optedOutOfAuth: true,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: false,
    } satisfies RouteDescriptor

    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpResourceResolver({
        routes: [staticRoute],
      }),
    })

    const res = await request("GET", "/static-route")

    expect(res.status).toBe(200)
    expect(res.text).toBe("static route")
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("serves statically provided middleware descriptors before routes", async () => {
    const middleware = jest.fn(((req, _, next) => {
      req.context = {
        ...(req.context ?? {}),
        fromStaticMiddleware: true,
      }
      next()
    }) satisfies MiddlewareFunction)
    const handler = jest.fn((req, res) => {
      res.status(200).json({
        fromStaticMiddleware: req.context?.fromStaticMiddleware,
      })
    })

    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpResourceResolver({
        middlewares: [
          {
            matcher: "/static-middleware",
            methods: ["GET"],
            handler: middleware,
          },
        ],
        routes: [
          {
            isRoute: true,
            matcher: "/static-middleware",
            method: "GET",
            handler,
            optedOutOfAuth: true,
            shouldAppendAdminCors: false,
            shouldAppendAuthCors: false,
            shouldAppendStoreCors: false,
          },
        ],
      }),
    })

    const res = await request("GET", "/static-middleware")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      fromStaticMiddleware: true,
    })
    expect(middleware).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
