import { resolve } from "path"
import {
  customersCreateMiddlewareMock,
  customersCreateMiddlewareValidatorMock,
  customersGlobalMiddlewareMock,
  storeGlobalMiddlewareMock,
} from "../__fixtures__/mocks"
import { createServer } from "../__fixtures__/server"
import { staticHttpManifest } from "../__fixtures__/static-http-package/static-http-manifest"
import { StaticHttpManifestResolver } from "../resolvers"

jest.mock("../middlewares/ensure-publishable-api-key", () => {
  return {
    ensurePublishableApiKeyMiddleware: async (
      _req: unknown,
      _res: unknown,
      next: () => void
    ) => next(),
  }
})

describe("Static HTTP manifest with existing API fixtures", () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it("runs existing route and middleware modules without filesystem discovery", async () => {
    const { request } = await createServer(resolve(__dirname), {
      resourceResolver: new StaticHttpManifestResolver(staticHttpManifest),
    })

    const listResponse = await request("GET", "/customers")
    expect(listResponse.status).toBe(200)
    expect(listResponse.text).toBe("list customers")
    expect(customersGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareMock).not.toHaveBeenCalled()

    jest.clearAllMocks()

    const createResponse = await request("POST", "/customers")
    expect(createResponse.status).toBe(200)
    expect(createResponse.text).toBe("create customer")
    expect(customersGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareMock).toHaveBeenCalled()
    expect(customersCreateMiddlewareValidatorMock).toHaveBeenCalled()

    jest.clearAllMocks()

    const syncResponse = await request("POST", "/store/products/prod_123/sync")
    expect(syncResponse.status).toBe(200)
    expect(syncResponse.text).toBe("sync product prod_123")
    expect(storeGlobalMiddlewareMock).toHaveBeenCalled()
    expect(customersGlobalMiddlewareMock).not.toHaveBeenCalled()
  })
})
