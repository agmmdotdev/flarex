import {
  createLazyMedusaFetchHttpHandler,
  defineMedusaFetchHttpRuntime,
} from "../fetch-http-handler"

describe("Medusa static Fetch HTTP handler", () => {
  it("creates a reusable lazy handler from Medusa runtime options", async () => {
    const runtime = defineMedusaFetchHttpRuntime({
      isSetupPath: (pathname) => pathname === "/setup",
      handleSetupRequest: (request) => {
        const pathname = new URL(request.url).pathname

        if (pathname !== "/setup") {
          return undefined
        }

        return new Response("setup handled", { status: 202 })
      },
    })
    const handler = createLazyMedusaFetchHttpHandler(runtime)

    expect(handler.isPathHandled("/setup")).toBe(true)
    await expect(
      handler.tryHandle(new Request("https://medusa.test/unhandled"))
    ).resolves.toBeUndefined()

    const response = await handler.tryHandle(
      new Request("https://medusa.test/setup")
    )

    expect(response?.status).toBe(202)
    await expect(response?.text()).resolves.toBe("setup handled")
  })
})
