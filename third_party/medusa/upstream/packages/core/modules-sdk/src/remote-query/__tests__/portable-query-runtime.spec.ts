import {
  createDirectEntrypointQueryEntriesFromJoinerConfigs,
  createPortableQueryRuntime,
  type PortableQueryIndexHandler,
  type PortableQueryGraphResult,
} from "../portable-query-runtime"
import type { ModuleJoinerConfig } from "@medusajs/types"

describe("portable query runtime", () => {
  it("creates direct entrypoint entries from joiner aliases", () => {
    const entries = createDirectEntrypointQueryEntriesFromJoinerConfigs([
      {
        serviceName: "product",
        alias: [
          {
            name: ["product", "products"],
            args: {
              methodSuffix: "Products",
            },
          },
          {
            name: "product_type",
            args: {
              methodSuffix: "ProductTypes",
            },
          },
          {
            name: "ignored_without_suffix",
          },
        ],
      } satisfies ModuleJoinerConfig,
      undefined,
    ])

    expect(entries).toEqual(
      new Map([
        [
          "product",
          {
            methodSuffix: "Products",
            serviceName: "product",
          },
        ],
        [
          "products",
          {
            methodSuffix: "Products",
            serviceName: "product",
          },
        ],
        [
          "product_type",
          {
            methodSuffix: "ProductTypes",
            serviceName: "product",
          },
        ],
      ])
    )
  })

  it("fails query.index with a clear adapter boundary error by default", async () => {
    const runtime = createPortableQueryRuntime({
      entries: new Map(),
      services: {},
    })

    await expect(
      runtime.query.index({
        entity: "product",
        fields: ["id"],
      })
    ).rejects.toThrow(
      "Portable query.index requires a Worker-safe Index adapter."
    )
  })

  it("delegates query.index to the injected portable Index adapter", async () => {
    const index = jest.fn<
      Promise<PortableQueryGraphResult>,
      Parameters<PortableQueryIndexHandler>
    >(async (_queryConfig, _options) => ({
      data: [{ id: "prod_1" }],
      metadata: {
        count: 1,
        skip: 0,
        take: 10,
      },
    }))
    const runtime = createPortableQueryRuntime({
      entries: new Map(),
      index,
      services: {},
    })
    const queryConfig = {
      entity: "product",
      fields: ["id"],
      pagination: {
        skip: 0,
        take: 10,
      },
    }
    const options = {
      cache: {
        enable: true,
      },
    }

    await expect(runtime.query.index(queryConfig, options)).resolves.toEqual({
      data: [{ id: "prod_1" }],
      metadata: {
        count: 1,
        skip: 0,
        take: 10,
      },
    })
    expect(index).toHaveBeenCalledWith(queryConfig, options)
  })
})
