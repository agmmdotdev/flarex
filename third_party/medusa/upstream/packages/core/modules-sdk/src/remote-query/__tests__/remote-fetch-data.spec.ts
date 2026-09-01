import {
  callRemoteFetchServiceMethod,
  executeRemoteFetchServiceRequest,
  splitRemoteFetchFieldsAndRelations,
  type RemoteFetchOptions,
} from "../remote-fetch-data"

describe("remote fetch data", () => {
  it("resolves list method suffixes and applies id filters", async () => {
    const listProductVariants = jest.fn(
      async (
        filters: Record<string, unknown>,
        options: RemoteFetchOptions
      ) => {
        return [{ filters, options }]
      }
    )
    const service: Record<string, unknown> = {
      listProductVariants,
    }

    const result = await executeRemoteFetchServiceRequest({
      serviceName: "product",
      service,
      keyField: "id",
      ids: ["variant_1"],
      filters: {},
      options: {
        select: ["id"],
        relations: [],
      },
      methodSuffix: "product_variants",
    })

    expect(listProductVariants).toHaveBeenCalledWith(
      {
        id: ["variant_1"],
      },
      {
        select: ["id"],
        relations: [],
        take: null,
      }
    )
    expect(result).toEqual({
      data: [
        {
          filters: {
            id: ["variant_1"],
          },
          options: {
            select: ["id"],
            relations: [],
            take: null,
          },
        },
      ],
    })
  })

  it("uses listAndCount and shapes pagination metadata when paginated", async () => {
    const rows = [{ id: "prod_1" }]
    const listAndCountProducts = jest.fn(async () => [rows, 12])
    const service: Record<string, unknown> = {
      listAndCountProducts,
    }

    const result = await executeRemoteFetchServiceRequest({
      serviceName: "product",
      service,
      keyField: "id",
      filters: {
        status: "published",
      },
      options: {
        select: ["id"],
        relations: [],
        skip: 5,
        take: 10,
      },
      methodSuffix: "Products",
    })

    expect(listAndCountProducts).toHaveBeenCalledWith(
      {
        status: "published",
      },
      {
        select: ["id"],
        relations: [],
        skip: 5,
        take: 10,
      }
    )
    expect(result).toEqual({
      data: {
        rows,
        metadata: {
          skip: 5,
          take: 10,
          count: 12,
        },
      },
      path: "rows",
    })
  })

  it("returns empty data for empty id arrays without calling the service", async () => {
    const service: Record<string, unknown> = {
      listProducts: jest.fn(),
    }

    const result = await executeRemoteFetchServiceRequest({
      serviceName: "product",
      service,
      keyField: "id",
      ids: [],
      filters: {},
      options: {
        relations: [],
      },
    })

    expect(service.listProducts).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: [],
    })
  })

  it("returns empty paginated rows for empty id arrays with pagination", async () => {
    const service: Record<string, unknown> = {
      listAndCountProducts: jest.fn(),
    }

    const result = await executeRemoteFetchServiceRequest({
      serviceName: "product",
      service,
      keyField: "id",
      ids: [],
      filters: {},
      options: {
        relations: [],
        skip: 0,
        take: 20,
      },
      methodSuffix: "Products",
    })

    expect(service.listAndCountProducts).not.toHaveBeenCalled()
    expect(result).toEqual({
      data: {
        rows: [],
        metadata: {
          skip: 0,
          take: 20,
          count: 0,
        },
      },
      path: "rows",
    })
  })

  it("batches large unpaginated id arrays and flattens service results", async () => {
    const ids = Array.from({ length: 4001 }, (_, index) => `prod_${index}`)
    const list = jest.fn(async (filters: Record<string, unknown>) => {
      return Array.isArray(filters.id) ? filters.id : []
    })
    const service: Record<string, unknown> = {
      list,
    }

    const result = await executeRemoteFetchServiceRequest({
      serviceName: "product",
      service,
      keyField: "id",
      ids,
      filters: {},
      options: {
        relations: [],
      },
    })

    expect(list).toHaveBeenCalledTimes(2)
    expect(result.data).toHaveLength(4001)
  })

  it("wraps service method calls with the trace hook", async () => {
    const listProducts = jest.fn(async () => [{ id: "prod_1" }])
    const traceFetchData = jest.fn(
      async (
        fetcher: () => Promise<unknown>,
        serviceName: string,
        methodName: string,
        options: { select?: string[]; relations: string[] }
      ) => {
        return {
          result: await fetcher(),
          serviceName,
          methodName,
          options,
        }
      }
    )
    const service: Record<string, unknown> = {
      listProducts,
    }

    const result = await callRemoteFetchServiceMethod({
      serviceName: "product",
      service,
      methodName: "listProducts",
      options: {
        select: ["id"],
        relations: ["variants"],
      },
      traceFetchData,
    })

    expect(traceFetchData).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      result: [{ id: "prod_1" }],
      serviceName: "product",
      methodName: "listProducts",
      options: {
        select: ["id"],
        relations: ["variants"],
      },
    })
  })

  it("derives first-level relations from dotted field paths", () => {
    expect(
      splitRemoteFetchFieldsAndRelations([
        "id",
        "title",
        "products.id",
        "products.title",
      ])
    ).toEqual({
      select: ["id", "title", "products.id", "products.title"],
      relations: ["products"],
    })
  })
})
