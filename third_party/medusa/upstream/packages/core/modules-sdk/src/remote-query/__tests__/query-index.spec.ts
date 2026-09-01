import type {
  IIndexService,
  MedusaContainer,
  QueryResultSet,
} from "@medusajs/types"
import { QueryContext } from "@medusajs/utils"
import { Query } from "../query"
import type { RemoteQuery } from "../remote-query"

type ProductResult = {
  id: string
  variants: Array<{
    id: string
    calculated_price: {
      calculated_amount: number
      currency_code: string
    }
  }>
}

type RemoteQueryMock = {
  query: jest.MockedFunction<
    (
      query: object,
      variables?: object,
      options?: object
    ) => Promise<ProductResult[]>
  >
  getEntitiesMap: jest.MockedFunction<() => Map<string, unknown>>
}

function createRemoteQueryMock(result: ProductResult[]): RemoteQueryMock {
  return {
    query: jest.fn(async (_query: object) => result),
    getEntitiesMap: jest.fn(() => new Map()),
  }
}

function createIndexServiceMock(
  result: QueryResultSet<"indexed_product">
): Pick<IIndexService, "query"> {
  return {
    query: jest.fn(async () => result) as Pick<IIndexService, "query">["query"],
  }
}

function createMockContainer(): MedusaContainer {
  return {
    resolve: jest.fn(),
  } as unknown as MedusaContainer
}

describe("Query.index", () => {
  it("hydrates calculated price through graph while keeping Index lookup ID-only", async () => {
    const metadata = {
      estimate_count: 1,
      skip: 0,
      take: 10,
    } satisfies NonNullable<QueryResultSet<"indexed_product">["metadata"]>
    const indexModule = createIndexServiceMock({
      data: [{ id: "prod_1" }],
      metadata,
    })
    const product = {
      id: "prod_1",
      variants: [
        {
          id: "var_1",
          calculated_price: {
            calculated_amount: 100,
            currency_code: "usd",
          },
        },
      ],
    } satisfies ProductResult
    const remoteQuery = createRemoteQueryMock([product])
    const query = new Query({
      remoteQuery: remoteQuery as unknown as RemoteQuery,
      indexModule: indexModule as unknown as IIndexService,
      container: createMockContainer(),
    })

    const result = await query.index({
      entity: "indexed_product",
      fields: ["id", "variants.id", "variants.calculated_price"],
      filters: {
        status: "published",
      },
      pagination: {
        take: 10,
        skip: 0,
      },
      context: {
        variants: {
          calculated_price: QueryContext({
            region_id: "reg_1",
            currency_code: "usd",
          }),
        },
      },
    })

    expect(indexModule.query).toHaveBeenCalledWith({
      fields: ["indexed_product.id"],
      filters: {
        indexed_product: {
          status: "published",
        },
      },
      joinFilters: {},
      pagination: {
        take: 10,
        skip: 0,
      },
      idsOnly: true,
    })
    expect(remoteQuery.query).toHaveBeenCalledWith(
      {
        indexed_product: {
          __fields: ["id"],
          __args: {
            filters: {
              id: ["prod_1"],
            },
            take: 10,
          },
          variants: {
            calculated_price: {
              __args: {
                context: {
                  region_id: "reg_1",
                  currency_code: "usd",
                },
              },
            },
            __fields: ["id", "calculated_price"],
          },
        },
      },
      undefined,
      {
        initialData: [{ id: "prod_1" }],
      }
    )
    expect(result).toEqual({
      data: [product],
      metadata,
    })
  })
})
