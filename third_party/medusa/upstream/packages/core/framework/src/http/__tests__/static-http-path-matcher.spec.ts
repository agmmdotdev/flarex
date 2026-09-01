import {
  createStaticHttpManifestPathMatcher,
  createStaticHttpPathPatternMatcher,
  createStaticHttpRoutePathMatcher,
  matchStaticHttpPathPattern,
  matchStaticHttpPath,
} from "../utils/static-http-path-matcher"

describe("static HTTP path matcher", () => {
  it("matches exact and dynamic static manifest routes", () => {
    const matches = createStaticHttpManifestPathMatcher({
      routes: [
        {
          route: "/store/products",
          module: {},
        },
        {
          route: "/store/products/:id",
          module: {},
        },
      ],
    })

    expect(matches("/store/products")).toBe(true)
    expect(matches("/store/products/prod_123")).toBe(true)
    expect(matches("/store/products/prod_123/extra")).toBe(false)
    expect(matches("/store/currencies")).toBe(false)
  })

  it("derives matchers from relative route file paths", () => {
    const matches = createStaticHttpManifestPathMatcher({
      routes: [
        {
          relativePath: "/store/currencies/[code]/route.ts",
          module: {},
        },
      ],
    })

    expect(matches("/store/currencies/usd")).toBe(true)
    expect(matches("/store/currencies")).toBe(false)
  })

  it("matches wildcard route segments", () => {
    const matches = createStaticHttpRoutePathMatcher("/uploads/*")

    expect(matches("/uploads/image.png")).toBe(true)
    expect(matches("/uploads")).toBe(false)
  })

  it("matches exact string and regular expression path patterns", () => {
    const matches = createStaticHttpPathPatternMatcher([
      "/admin/products",
      /^\/admin\/products\/[^/]+$/,
    ])

    expect(matches("/admin/products")).toBe(true)
    expect(matches("/admin/products/prod_123")).toBe(true)
    expect(matches("/admin/products/prod_123/options")).toBe(false)
  })

  it("resets regular expression state between path pattern matches", () => {
    const pattern = /^\/store\/orders\/[^/]+$/g

    expect(matchStaticHttpPathPattern(pattern, "/store/orders/order_1")).toBe(
      true
    )
    expect(matchStaticHttpPathPattern(pattern, "/store/orders/order_2")).toBe(
      true
    )
  })

  it("returns decoded params for dynamic route matches", () => {
    expect(
      matchStaticHttpPath(
        "/store/products/:id/options/:option_id",
        "/store/products/prod%201/options/opt_1"
      )
    ).toEqual({
      id: "prod 1",
      option_id: "opt_1",
    })
  })

  it("supports partial matching for middleware-style route prefixes", () => {
    expect(
      matchStaticHttpPath("/store", "/store/products/prod_1", {
        partial: true,
      })
    ).toEqual({})
    expect(matchStaticHttpPath("/store/products/:id", "/store")).toBeUndefined()
  })
})
