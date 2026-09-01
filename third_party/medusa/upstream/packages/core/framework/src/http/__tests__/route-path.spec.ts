import { createRoutePathFromRelativePath } from "../utils/route-path"

describe("createRoutePathFromRelativePath", () => {
  it("converts filesystem route paths to HTTP matchers", () => {
    expect(
      createRoutePathFromRelativePath(
        "/store/products/[id]/sync/route.ts"
      )
    ).toBe("/store/products/:id/sync")
    expect(
      createRoutePathFromRelativePath(
        "\\customers\\[customer_id]\\orders\\[order_id]\\route.js"
      )
    ).toBe("/customers/:customer_id/orders/:order_id")
  })

  it("throws when a route path repeats a param name", () => {
    expect(() =>
      createRoutePathFromRelativePath("/customers/[id]/orders/[id]/route.ts")
    ).toThrow(
      "Duplicate parameters found in route /customers/[id]/orders/[id]/route.ts (id). Make sure that all parameters are unique."
    )
  })
})
