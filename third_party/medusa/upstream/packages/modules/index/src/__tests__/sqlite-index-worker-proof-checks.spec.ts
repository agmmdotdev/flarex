import type { SqliteIndexWorkerProofRuntimeChecks } from "../sqlite-index-worker-proof-checks"
import {
  findSqliteIndexWorkerObservedStringField,
  runSqliteIndexWorkerEmptyQueryCheck,
  runSqliteIndexWorkerEventAttachDetachPathCheck,
  runSqliteIndexWorkerEventIngestionStringCheck,
  runSqliteIndexWorkerEventLifecycleStringCheck,
} from "../sqlite-index-worker-proof-checks"

describe("SQLite Index Worker proof checks", () => {
  it("matches empty query results and carries runtime stats", async () => {
    const runtime: SqliteIndexWorkerProofRuntimeChecks = {
      async queryWithRuntimeStats() {
        return {
          data: [],
          metadata: {
            estimate_count: 0,
            skip: 0,
            take: 1,
          },
          runtimeInstanceId: 7,
          serviceInitializations: 1,
        }
      },
      async emitAndQuery() {
        throw new Error("empty query check should not emit events")
      },
    }

    const check = await runSqliteIndexWorkerEmptyQueryCheck({
      runtime,
      query: {
        fields: ["product_category.*"],
      },
    })

    expect(check).toEqual({
      dataCount: 0,
      estimateCount: 0,
      matched: true,
      runtimeInstanceId: 7,
      seeded: false,
      serviceInitializations: 1,
    })
  })

  it("matches expected string fields after event ingestion", async () => {
    const runtime: SqliteIndexWorkerProofRuntimeChecks = {
      async queryWithRuntimeStats() {
        throw new Error("event ingestion check should use emitAndQuery")
      },
      async emitAndQuery() {
        return {
          data: [
            {
              id: "pcat_1",
              name: "Proof category",
              rank: 1,
            },
          ],
          metadata: undefined,
          runtimeInstanceId: 9,
          serviceInitializations: 1,
        }
      },
    }

    const check = await runSqliteIndexWorkerEventIngestionStringCheck({
      runtime,
      event: {
        name: "product.product-category.created",
        data: {
          id: "pcat_1",
        },
      },
      query: {
        fields: ["product_category.*"],
      },
      expectedFields: [
        {
          field: "id",
          value: "pcat_1",
        },
        {
          field: "name",
          value: "Proof category",
        },
        {
          field: "rank",
          value: "1",
        },
      ],
    })

    expect(check.matched).toEqual(false)
    expect(check.runtimeInstanceId).toEqual(9)
    expect(check.serviceInitializations).toEqual(1)
    expect(check.writePath).toEqual("event")
    expect(check.fields).toEqual([
      {
        actual: "pcat_1",
        expected: "pcat_1",
        field: "id",
        matched: true,
      },
      {
        actual: "Proof category",
        expected: "Proof category",
        field: "name",
        matched: true,
      },
      {
        actual: undefined,
        expected: "1",
        field: "rank",
        matched: false,
      },
    ])
    expect(
      findSqliteIndexWorkerObservedStringField(check.fields, "name")?.actual
    ).toEqual("Proof category")
  })

  it("matches create, update, and delete event lifecycle checks", async () => {
    const emittedEvents: string[] = []
    const runtime: SqliteIndexWorkerProofRuntimeChecks = {
      async queryWithRuntimeStats() {
        throw new Error("event lifecycle check should use emitAndQuery")
      },
      async emitAndQuery({ event }) {
        emittedEvents.push(event.name)

        if (event.name === "product.product-category.deleted") {
          return {
            data: [],
            metadata: {
              estimate_count: 0,
              skip: 0,
              take: 1,
            },
            runtimeInstanceId: 11,
            serviceInitializations: 1,
          }
        }

        return {
          data: [
            {
              id: "pcat_1",
              name:
                event.name === "product.product-category.updated"
                  ? "Updated category"
                  : "Original category",
            },
          ],
          metadata: {
            estimate_count: 1,
            skip: 0,
            take: 1,
          },
          runtimeInstanceId: 11,
          serviceInitializations: 1,
        }
      },
    }

    const check = await runSqliteIndexWorkerEventLifecycleStringCheck({
      runtime,
      createEvent: {
        name: "product.product-category.created",
        data: {
          id: "pcat_1",
        },
      },
      updateEvent: {
        name: "product.product-category.updated",
        data: {
          id: "pcat_1",
        },
      },
      deleteEvent: {
        name: "product.product-category.deleted",
        data: {
          id: "pcat_1",
        },
      },
      query: {
        fields: ["product_category.*"],
        pagination: {
          skip: 0,
          take: 1,
        },
      },
      createExpectedFields: [
        {
          field: "name",
          value: "Original category",
        },
      ],
      updateExpectedFields: [
        {
          field: "name",
          value: "Updated category",
        },
      ],
    })

    expect(emittedEvents).toEqual([
      "product.product-category.created",
      "product.product-category.updated",
      "product.product-category.deleted",
    ])
    expect(check).toEqual({
      createFields: [
        {
          actual: "Original category",
          expected: "Original category",
          field: "name",
          matched: true,
        },
      ],
      createMatched: true,
      deleteDataCount: 0,
      deleteEstimateCount: 0,
      deleteMatched: true,
      matched: true,
      runtimeInstanceId: 11,
      serviceInitializations: 1,
      updateFields: [
        {
          actual: "Updated category",
          expected: "Updated category",
          field: "name",
          matched: true,
        },
      ],
      updateMatched: true,
      writePath: "event",
    })
  })

  it("matches attach and detach event checks through nested paths", async () => {
    const emittedEvents: string[] = []
    const runtime: SqliteIndexWorkerProofRuntimeChecks = {
      async queryWithRuntimeStats() {
        throw new Error("attach detach check should use emitAndQuery")
      },
      async emitAndQuery({ event }) {
        emittedEvents.push(event.name)

        if (event.name === "LinkProductVariantPriceSet.detached") {
          return {
            data: [],
            metadata: {
              estimate_count: 0,
              skip: 0,
              take: 1,
            },
            runtimeInstanceId: 13,
            serviceInitializations: 1,
          }
        }

        return {
          data: [
            {
              id: "prod_1",
              variants: [
                {
                  id: "var_1",
                  prices: [
                    {
                      amount: 100,
                      id: "price_1",
                    },
                  ],
                },
              ],
            },
          ],
          metadata: {
            estimate_count: 1,
            skip: 0,
            take: 1,
          },
          runtimeInstanceId: 13,
          serviceInitializations: 1,
        }
      },
    }

    const check = await runSqliteIndexWorkerEventAttachDetachPathCheck({
      runtime,
      attachEvent: {
        name: "LinkProductVariantPriceSet.attached",
        data: {
          id: "link_1",
        },
      },
      detachEvent: {
        name: "LinkProductVariantPriceSet.detached",
        data: {
          id: "link_1",
        },
      },
      query: {
        fields: [
          "product.id",
          "product.variants.id",
          "product.variants.prices.id",
          "product.variants.prices.amount",
        ],
        filters: {
          product: {
            variants: {
              prices: {
                id: "price_1",
              },
            },
          },
        },
        pagination: {
          skip: 0,
          take: 1,
        },
      },
      expectedAttachedFields: [
        {
          path: ["id"],
          value: "prod_1",
        },
        {
          path: ["variants", 0, "id"],
          value: "var_1",
        },
        {
          path: ["variants", 0, "prices", 0, "amount"],
          value: 100,
        },
      ],
    })

    expect(emittedEvents).toEqual([
      "LinkProductVariantPriceSet.attached",
      "LinkProductVariantPriceSet.detached",
    ])
    expect(check).toEqual({
      attachDataCount: 1,
      attachFields: [
        {
          actual: "prod_1",
          expected: "prod_1",
          matched: true,
          path: ["id"],
        },
        {
          actual: "var_1",
          expected: "var_1",
          matched: true,
          path: ["variants", 0, "id"],
        },
        {
          actual: 100,
          expected: 100,
          matched: true,
          path: ["variants", 0, "prices", 0, "amount"],
        },
      ],
      attachMatched: true,
      detachDataCount: 0,
      detachEstimateCount: 0,
      detachMatched: true,
      matched: true,
      runtimeInstanceId: 13,
      serviceInitializations: 1,
      writePath: "event",
    })
  })
})
