import { createSqliteIndexWorkerRemoteQuery } from "../sqlite-index-worker-remote-query"

describe("SQLite Index Worker remote query", () => {
  it("returns matching records for string id filters", async () => {
    const query = createSqliteIndexWorkerRemoteQuery({
      records: [
        { id: "pcat_1", name: "First category" },
        { id: "pcat_2", name: "Second category" },
      ],
    })

    const result = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_2",
      },
    })

    expect(result.data).toEqual([{ id: "pcat_2", name: "Second category" }])
  })

  it("returns matching records for array id filters", async () => {
    const query = createSqliteIndexWorkerRemoteQuery({
      records: [
        { id: "pcat_1", name: "First category" },
        { id: "pcat_2", name: "Second category" },
        { id: "pcat_3", name: "Third category" },
      ],
    })

    const result = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: ["pcat_1", "pcat_3"],
      },
    })

    expect(result.data).toEqual([
      { id: "pcat_1", name: "First category" },
      { id: "pcat_3", name: "Third category" },
    ])
  })

  it("returns copied records so callers cannot mutate stored proof data", async () => {
    const query = createSqliteIndexWorkerRemoteQuery({
      records: [{ id: "pcat_1", name: "Original category" }],
    })

    const firstResult = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })
    firstResult.data[0].name = "Changed category"

    const secondResult = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })

    expect(secondResult.data).toEqual([
      { id: "pcat_1", name: "Original category" },
    ])
  })

  it("reads records lazily for mutable proof fixtures", async () => {
    let records = [{ id: "pcat_1", name: "Original category" }]
    const query = createSqliteIndexWorkerRemoteQuery({
      records: () => records,
    })

    const firstResult = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })
    records = [{ id: "pcat_1", name: "Updated category" }]
    const secondResult = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })

    expect(firstResult.data).toEqual([
      { id: "pcat_1", name: "Original category" },
    ])
    expect(secondResult.data).toEqual([
      { id: "pcat_1", name: "Updated category" },
    ])
  })

  it("returns no records for unmatched id filters", async () => {
    const query = createSqliteIndexWorkerRemoteQuery({
      records: [{ id: "pcat_1", name: "First category" }],
    })

    const result = await query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_missing",
      },
    })

    expect(result.data).toEqual([])
  })
})
