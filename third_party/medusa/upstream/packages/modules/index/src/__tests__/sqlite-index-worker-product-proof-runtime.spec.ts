import {
  createSqliteIndexWorkerProductProofDependencies,
  createSqliteIndexWorkerProductProofEvents,
  sqliteIndexWorkerProductProofTarget,
  sqliteIndexWorkerProductVariantPriceSetLinkProofTarget,
  sqliteIndexWorkerUpdatedProductProofTarget,
} from "../sqlite-index-worker-product-proof-runtime"
import type { SqliteIndexWorkerStaticModuleInput } from "../sqlite-index-worker-static-module-input"

describe("SQLite Index Worker product proof runtime", () => {
  it("derives Product and link proof event names from static input", () => {
    const events = createSqliteIndexWorkerProductProofEvents({
      input: {
        entities: [
          {
            entity: "Product",
            listeners: [
              "product.product.created",
              "product.product.updated",
              "product.product.deleted",
            ],
            moduleKey: "product",
            serviceName: "product",
          },
        ],
      } satisfies Pick<SqliteIndexWorkerStaticModuleInput, "entities">,
    })

    expect(events).toEqual({
      productCreated: "product.product.created",
      productDeleted: "product.product.deleted",
      productUpdated: "product.product.updated",
      productVariantPriceSetAttached: "LinkProductVariantPriceSet.attached",
      productVariantPriceSetDetached: "LinkProductVariantPriceSet.detached",
    })
  })

  it("fails loudly when Product listeners are missing", () => {
    expect(() =>
      createSqliteIndexWorkerProductProofEvents({
        input: {
          entities: [],
        },
      })
    ).toThrow("Index Worker Product proof input is missing Product.created listener")
  })

  it("creates package-owned mutable Product/link proof dependencies", async () => {
    const dependencies = createSqliteIndexWorkerProductProofDependencies()

    expect(dependencies.targetProduct).toEqual(sqliteIndexWorkerProductProofTarget)
    expect(dependencies.updatedTargetProduct).toEqual(
      sqliteIndexWorkerUpdatedProductProofTarget
    )
    expect(dependencies.productVariantPriceSetLink).toEqual(
      sqliteIndexWorkerProductVariantPriceSetLinkProofTarget
    )
    expect(dependencies.proofRecords.getRecords()).toEqual([
      sqliteIndexWorkerProductProofTarget,
    ])

    dependencies.proofRecords.setRecords([
      sqliteIndexWorkerUpdatedProductProofTarget,
    ])

    const result = await dependencies.query.graph({
      entity: "Product",
      fields: ["id", "handle", "title"],
      filters: {
        id: sqliteIndexWorkerUpdatedProductProofTarget.id,
      },
    })

    expect(result.data).toEqual([sqliteIndexWorkerUpdatedProductProofTarget])
  })
})
