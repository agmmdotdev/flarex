import { resolve } from "path"
import { MiddlewareFileLoader } from "../middleware-file-loader"

describe("Middleware file loader", () => {
  it("should load routes from the filesystem", async () => {
    const BASE_DIR = resolve(__dirname, "../__fixtures__/routers-middleware")
    const loader = new MiddlewareFileLoader()
    await loader.scanDir(BASE_DIR)

    expect(loader.getBodyParserConfigRoutes()).toMatchInlineSnapshot(`
      [
        {
          "config": {
            "sizeLimit": "500kb",
          },
          "matcher": "/v1*",
          "methods": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
            "HEAD",
          ],
          "pathMatching": "prefix",
        },
        {
          "config": {
            "preserveRawBody": true,
          },
          "matcher": "/webhooks",
          "methods": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
            "HEAD",
          ],
          "pathMatching": "prefix",
        },
        {
          "config": false,
          "matcher": "/webhooks/*",
          "methods": [
            "POST",
          ],
          "pathMatching": "prefix",
        },
      ]
    `)

    expect(loader.getMiddlewares()).toMatchInlineSnapshot(`
      [
        {
          "handler": [Function],
          "matcher": "/customers",
          "methods": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
            "HEAD",
          ],
          "pathMatching": "prefix",
          "policies": undefined,
        },
        {
          "handler": [Function],
          "matcher": "/customers",
          "methods": [
            "POST",
          ],
          "pathMatching": "exact",
          "policies": undefined,
        },
        {
          "handler": [Function],
          "matcher": "/store/*",
          "methods": [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
            "HEAD",
          ],
          "pathMatching": "prefix",
          "policies": undefined,
        },
        {
          "handler": [Function],
          "matcher": "/webhooks/*",
          "methods": [
            "POST",
          ],
          "pathMatching": "prefix",
          "policies": undefined,
        },
      ]
    `)
  })
})
