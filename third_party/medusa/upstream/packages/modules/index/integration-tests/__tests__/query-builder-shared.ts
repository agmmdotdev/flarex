import type { IndexTypes } from "@medusajs/framework/types"

type GetIndexModule = () => IndexTypes.IIndexService

export function runIndexQueryBuilderSharedTests(getModule: GetIndexModule): void {
  let module: IndexTypes.IIndexService

  beforeEach(() => {
    module = getModule()
  })

  it("should query all products where sku not null", async () => {
    const { data } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            sku: { $ne: null },
          },
        },
      },
    })

    const { data: dataNot } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            sku: {
              $not: {
                $eq: null,
              },
            },
          },
        },
      },
    })

    expect(data.length).toEqual(1)
    expect(dataNot.length).toEqual(1)
    expect(dataNot).toEqual(data)

    const { data: data2 } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            sku: { $eq: null },
          },
        },
      },
    })

    expect(data2.length).toEqual(0)
  })

  it("should query all products ordered by sku DESC", async () => {
    const { data } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      pagination: {
        order: {
          product: {
            variants: {
              sku: "DESC",
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },

          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
  })

  it("should query all products ordered by sku DESC with specific fields", async () => {
    const { data } = await module.query({
      fields: [
        "product.*",
        "product.variants.sku",
        "product.variants.prices.amount",
      ],
      pagination: {
        order: {
          product: {
            variants: {
              sku: "DESC",
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },

          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
  })

  it("should query all products ordered by price", async () => {
    const { data } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "DESC",
              },
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
          {
            id: "var_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },
        ],
      },
    ])

    const { data: dataAsc } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "ASC",
              },
            },
          },
        },
      },
    })

    expect(dataAsc).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
    ])
  })

  it("should query all products ordered by price returning only ids", async () => {
    const { data } = await module.query({
      fields: ["product.*", "product.variants.*"],
      idsOnly: true,
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "DESC",
              },
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_2",
        variants: [],
      },
      {
        id: "prod_1",
        variants: [
          {
            id: "var_1",
          },
          {
            id: "var_2",
          },
        ],
      },
    ])
  })

  it("should query products filtering by variant sku", async () => {
    const { data, metadata } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            sku: { $like: "aaa%" },
          },
        },
      },
      pagination: {
        take: 100,
        skip: 0,
      },
    })

    expect(metadata).toEqual({
      estimate_count: expect.any(Number),
      skip: 0,
      take: 100,
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
  })

  it("should query products filtering by variant sku and join filters on prices amount", async () => {
    const { data, metadata } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      joinFilters: {
        "product.variants.prices.amount": { $gt: 110 },
      },
      filters: {
        product: {
          variants: {
            sku: { $like: "aaa%" },
          },
        },
      },
      pagination: {
        take: 100,
        skip: 0,
        order: {
          product: {
            created_at: "ASC",
          },
        },
      },
    })

    expect(metadata).toEqual({
      estimate_count: expect.any(Number),
      skip: 0,
      take: 100,
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [],
          },
        ],
      },
    ])
  })

  it("should filter using fields not selected", async () => {
    const { data } = await module.query({
      fields: ["product.id", "product.variants.*"],
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "ASC",
              },
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        variants: [
          {
            id: "var_2",
            sku: "sku 123",
          },
          {
            id: "var_1",
            sku: "aaa test aaa",
          },
        ],
      },
      {
        id: "prod_2",
        variants: [],
      },
    ])
  })

  it("should filter using IN operator with array of strings", async () => {
    const { data } = await module.query({
      fields: ["product.id", "product.variants.*"],
      filters: {
        product: {
          variants: {
            sku: { $in: ["sku 123", "aaa test aaa", "does-not-exist"] },
          },
        },
      },
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "DESC",
              },
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
          },
          {
            id: "var_2",
            sku: "sku 123",
          },
        ],
      },
    ])
  })

  it("should filter using IN operator with array of strings", async () => {
    const { data } = await module.query({
      fields: ["product.id", "product.variants.*"],
      filters: {
        product: {
          variants: {
            sku: { $in: ["sku 123", "aaa test aaa", "does-not-exist"] },
          },
        },
      },
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "DESC",
              },
            },
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
          },
          {
            id: "var_2",
            sku: "sku 123",
          },
        ],
      },
    ])
  })

  it("should query products filtering by variant ids", async () => {
    const { data } = await module.query({
      fields: ["product.id", "product.variants.id"],
      filters: {
        product: {
          variants: {
            id: ["var_1"],
          },
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
          },
        ],
      },
    ])
  })

  it("should query products filtering by product ids", async () => {
    const { data } = await module.query({
      fields: ["product.id", "product.title"],
      filters: {
        product: {
          id: ["prod_1"],
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
      },
    ])
  })

  it("should query all products", async () => {
    const { data } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
          {
            id: "var_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },
        ],
      },
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
    ])
  })

  it("should paginate products", async () => {
    const { data, metadata } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      pagination: {
        take: 1,
        skip: 1,
        order: {
          product: {
            id: "ASC",
          },
        },
      },
    })

    expect(metadata).toEqual({
      estimate_count: expect.any(Number),
      skip: 1,
      take: 1,
    })
    expect(data).toEqual([
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
        variants: [],
      },
    ])
  })

  it("should query products filtering by deep nested levels", async () => {
    const { data, metadata } = await module.query({
      fields: ["product.*"],
      filters: {
        product: {
          deep: {
            obj: {
              b: 15,
            },
          },
        },
      },
      pagination: {
        take: 1,
        skip: 0,
      },
    })

    expect(metadata).toEqual({
      estimate_count: expect.any(Number),
      skip: 0,
      take: 1,
    })
    expect(data).toEqual([
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
      },
    ])
  })

  it("should query products filtering by prices bigger than 20", async () => {
    const { data, metadata } = await module.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            prices: {
              amount: { $gt: 20 },
            },
          },
        },
      },
      pagination: {
        take: 100,
        skip: 0,
        order: {
          product: {
            created_at: "ASC",
          },
        },
      },
    })

    expect(metadata).toEqual({
      estimate_count: expect.any(Number),
      skip: 0,
      take: 100,
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        title: "Product 1",
        variants: [
          {
            id: "var_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
  })

  it("should query products filtering product not in [X]", async () => {
    const expected = [
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
      },
    ]

    const { data } = await module.query({
      fields: ["product.*"],
      filters: {
        product: {
          $not: [
            {
              id: {
                $in: ["prod_1"],
              },
            },
          ],
        },
      },
    })
    expect(data).toEqual(expected)
  })

  it("should query products filtering product not in [X] using $nin", async () => {
    const expected = [
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
      },
    ]

    const { data } = await module.query({
      fields: ["product.*"],
      filters: {
        product: {
          id: {
            $nin: ["prod_1"],
          },
        },
      },
    })
    expect(data).toEqual(expected)
  })

  it("should query products with variants.sku not in [X] and title eq", async () => {
    const expected = [
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
      },
    ]

    const { data } = await module.query({
      fields: ["product.*", "variants.*"],
      filters: {
        product: {
          variants: {
            sku: {
              $nin: ["sku 123"],
            },
          },
          title: {
            $eq: "Product 2 title",
          },
        },
      },
    })
    expect(data).toEqual(expected)
  })

  it("should query products filtering title like and not equal specific value", async () => {
    const expected = [
      {
        id: "prod_2",
        title: "Product 2 title",
        deep: {
          a: 1,
          obj: {
            b: 15,
          },
        },
      },
    ]

    const { data } = await module.query({
      fields: ["product.*"],
      filters: {
        product: {
          $and: [
            {
              title: {
                $like: "Product%",
              },
            },
            {
              $not: {
                title: {
                  $eq: "Product 1",
                },
              },
            },
          ],
        },
      },
    })
    expect(data).toEqual(expected)
  })

  it("should query products filtering title using $ilike", async () => {
    const expected = [
      {
        id: "prod_2",
        title: "Product 2 title",
      },
    ]

    const { data } = await module.query({
      fields: ["product.id", "product.title"],
      filters: {
        product: {
          title: {
            $ilike: "PROdUCt 2%",
          },
        },
      },
    })
    expect(data).toEqual(expected)

    const { data: sensitive } = await module.query({
      fields: ["product.id", "product.title"],
      filters: {
        product: {
          title: {
            $like: "PROdUCt 2%",
          },
        },
      },
    })
    expect(sensitive).toEqual([])
  })
}
