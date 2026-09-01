import { StaticHttpResourceResolver } from "../resolvers/static"
import {
  MedusaErrorHandlerFunction,
  MiddlewareDescriptor,
  RouteDescriptor,
} from "../types"

describe("StaticHttpResourceResolver", () => {
  it("normalizes missing arrays to empty arrays", async () => {
    const resolver = new StaticHttpResourceResolver({})

    await expect(resolver.resolve()).resolves.toEqual({
      routes: [],
      middlewares: [],
      errorHandler: undefined,
      bodyParserConfigRoutes: [],
      additionalDataValidatorRoutes: [],
    })
  })

  it("returns shallow copies of resource arrays", async () => {
    const route = {
      isRoute: true,
      matcher: "/store/test",
      method: "GET",
      handler: jest.fn(),
      optedOutOfAuth: false,
      shouldAppendAdminCors: false,
      shouldAppendAuthCors: false,
      shouldAppendStoreCors: true,
    } satisfies RouteDescriptor
    const middleware = {
      matcher: "/store/test",
      handler: jest.fn(),
    } satisfies MiddlewareDescriptor
    const resources = {
      routes: [route],
      middlewares: [middleware],
    }

    const resolved = await new StaticHttpResourceResolver(resources).resolve()

    expect(resolved.routes).toEqual([route])
    expect(resolved.middlewares).toEqual([middleware])
    expect(resolved.routes).not.toBe(resources.routes)
    expect(resolved.middlewares).not.toBe(resources.middlewares)
  })

  it("preserves optional error handler", async () => {
    const errorHandler = jest.fn() as MedusaErrorHandlerFunction

    const resolved = await new StaticHttpResourceResolver({
      errorHandler,
    }).resolve()

    expect(resolved.errorHandler).toBe(errorHandler)
  })
})
