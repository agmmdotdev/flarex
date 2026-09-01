import type { Subscriber } from "@medusajs/framework/types"
import {
  createSqliteIndexWorkerMutableProofDependencies,
  createSqliteIndexWorkerProofDependencies,
} from "../sqlite-index-worker-proof-dependencies"

type SubscriberMessage = Parameters<Subscriber>[0]

describe("SQLite Index Worker proof dependencies", () => {
  it("creates an event bus and remote query dependency pair", async () => {
    const dependencies = createSqliteIndexWorkerProofDependencies({
      records: [{ id: "pcat_1", name: "Proof category" }],
    })
    const receivedMessages: SubscriberMessage[] = []

    dependencies.eventBus.subscribe("product-category.created", async (message) => {
      receivedMessages.push(message)
    })

    await dependencies.eventBus.emit({
      name: "product-category.created",
      data: {
        id: "pcat_1",
      },
    })
    const result = await dependencies.query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })

    expect(receivedMessages).toEqual([
      {
        name: "product-category.created",
        data: {
          id: "pcat_1",
        },
      },
    ])
    expect(result.data).toEqual([{ id: "pcat_1", name: "Proof category" }])
  })

  it("creates isolated event bus instances", async () => {
    const firstDependencies = createSqliteIndexWorkerProofDependencies({
      records: [{ id: "pcat_1" }],
    })
    const secondDependencies = createSqliteIndexWorkerProofDependencies({
      records: [{ id: "pcat_1" }],
    })
    const receivedMessages: SubscriberMessage[] = []

    firstDependencies.eventBus.subscribe(
      "product-category.created",
      async (message) => {
        receivedMessages.push(message)
      }
    )

    await secondDependencies.eventBus.emit({
      name: "product-category.created",
      data: {
        id: "pcat_1",
      },
    })

    expect(receivedMessages).toEqual([])
  })

  it("creates mutable remote query records for event lifecycle proofs", async () => {
    const dependencies = createSqliteIndexWorkerMutableProofDependencies({
      records: [{ id: "pcat_1", name: "Original category" }],
    })

    dependencies.records.setRecords([
      { id: "pcat_1", name: "Updated category" },
    ])
    const result = await dependencies.query.graph({
      entity: "ProductCategory",
      fields: ["id", "name"],
      filters: {
        id: "pcat_1",
      },
    })

    expect(dependencies.records.getRecords()).toEqual([
      { id: "pcat_1", name: "Updated category" },
    ])
    expect(result.data).toEqual([{ id: "pcat_1", name: "Updated category" }])
  })
})
