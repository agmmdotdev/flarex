import {
  resetIndexTables,
  seedProductVariantPriceAttachSupportIndex,
} from "./relation-query-proof-fixture"
import {
  findSqliteIndexWorkerObservedStringField,
  runSqliteIndexWorkerEmptyQueryCheck,
  runSqliteIndexWorkerEventAttachDetachPathCheck,
  runSqliteIndexWorkerEventLifecycleStringCheck,
} from "./sqlite-index-worker-proof-checks"
import {
  createSqliteIndexWorkerProofRuntime,
  type SqliteIndexWorkerProofRuntime,
} from "./sqlite-index-worker-proof-runtime"
import {
  createSqliteIndexWorkerMutableProofDependencies,
  type SqliteIndexWorkerMutableProofRecordState,
} from "./sqlite-index-worker-proof-dependencies"
import type { SqliteIndexWorkerRuntimeDependencies } from "./sqlite-index-worker-runtime"
import {
  getSqliteIndexWorkerRequiredEntityListener,
  type SqliteIndexWorkerStaticModuleInput,
} from "./sqlite-index-worker-static-module-input"

export type SqliteIndexWorkerProductProofTarget = {
  created_at: string
  external_id: string
  handle: string
  id: string
  title: string
}

export type SqliteIndexWorkerProductVariantPriceSetLinkTarget = {
  id: string
  price_set_id: string
  variant_id: string
}

export type SqliteIndexWorkerProductProofRecord =
  | SqliteIndexWorkerProductProofTarget
  | SqliteIndexWorkerProductVariantPriceSetLinkTarget

export const sqliteIndexWorkerProductProofTarget = {
  created_at: "2026-01-01T00:00:00.000Z",
  external_id: "external_worker_index_event",
  handle: "worker-index-event-product",
  id: "prod_worker_index_event",
  title: "Worker Index Event Product",
} as const satisfies SqliteIndexWorkerProductProofTarget

export const sqliteIndexWorkerUpdatedProductProofTarget = {
  ...sqliteIndexWorkerProductProofTarget,
  handle: "worker-index-event-product-updated",
  title: "Worker Index Event Product Updated",
} as const satisfies SqliteIndexWorkerProductProofTarget

export const sqliteIndexWorkerProductVariantPriceSetLinkProofTarget = {
  id: "link_worker_index_price_set",
  price_set_id: "pset_worker_index_link",
  variant_id: "var_worker_index_link",
} as const satisfies SqliteIndexWorkerProductVariantPriceSetLinkTarget

export type SqliteIndexWorkerProductProofDependencies = Pick<
  SqliteIndexWorkerRuntimeDependencies,
  "eventBus" | "query"
> & {
  productVariantPriceSetLink: SqliteIndexWorkerProductVariantPriceSetLinkTarget
  proofRecords: SqliteIndexWorkerMutableProofRecordState<SqliteIndexWorkerProductProofRecord>
  targetProduct: SqliteIndexWorkerProductProofTarget
  updatedTargetProduct: SqliteIndexWorkerProductProofTarget
}

export type SqliteIndexWorkerProductProofEvents = {
  productCreated: string
  productDeleted: string
  productUpdated: string
  productVariantPriceSetAttached: string
  productVariantPriceSetDetached: string
}

export type SqliteIndexWorkerProductProofRuntimeInput = Pick<
  SqliteIndexWorkerRuntimeDependencies,
  "eventBus" | "executor" | "query"
> & {
  events?: SqliteIndexWorkerProductProofEvents
  input: Pick<
    SqliteIndexWorkerStaticModuleInput,
    "entities" | "joinerConfigs" | "schema"
  >
  productVariantPriceSetLink: SqliteIndexWorkerProductVariantPriceSetLinkTarget
  proofRecords: SqliteIndexWorkerMutableProofRecordState<SqliteIndexWorkerProductProofRecord>
  targetProduct: SqliteIndexWorkerProductProofTarget
  updatedTargetProduct: SqliteIndexWorkerProductProofTarget
}

export type SqliteIndexWorkerCompositionCheck = {
  dataCount: number
  estimateCount: number | undefined
  matched: boolean
  moduleEntity: "Product"
  runtimeInstanceId: number
  rootAlias: "product"
  serviceInitializations: number
  seeded: false
}

export type SqliteIndexWorkerProductEventIngestionCheck = {
  createMatched: boolean
  deleteDataCount: number
  deleteEstimateCount: number | undefined
  deleteMatched: boolean
  matched: boolean
  moduleEntity: "Product"
  productExternalId: string | undefined
  productHandle: string | undefined
  productId: string | undefined
  productTitle: string | undefined
  rootAlias: "product"
  serviceInitializations: number
  updatedProductHandle: string | undefined
  updatedProductTitle: string | undefined
  updateMatched: boolean
  writePath: "event"
}

export type SqliteIndexWorkerLinkAttachDetachCheck = {
  attachDataCount: number
  attachMatched: boolean
  detachDataCount: number
  detachEstimateCount: number | undefined
  detachMatched: boolean
  matched: boolean
  moduleEntity: "LinkProductVariantPriceSet"
  productId: string | undefined
  productVariantId: string | undefined
  rootAlias: "product"
  serviceInitializations: number
  variantPriceAmount: number | undefined
  variantPriceId: string | undefined
  writePath: "event"
}

export class SqliteIndexWorkerProductProofRuntime {
  private readonly events: SqliteIndexWorkerProductProofEvents
  private readonly executor: SqliteIndexWorkerRuntimeDependencies["executor"]
  private readonly productVariantPriceSetLink: SqliteIndexWorkerProductVariantPriceSetLinkTarget
  private readonly proofRecords: SqliteIndexWorkerMutableProofRecordState<SqliteIndexWorkerProductProofRecord>
  private readonly runtime: SqliteIndexWorkerProofRuntime
  private readonly targetProduct: SqliteIndexWorkerProductProofTarget
  private readonly updatedTargetProduct: SqliteIndexWorkerProductProofTarget

  constructor({
    eventBus,
    events,
    executor,
    input,
    productVariantPriceSetLink,
    proofRecords,
    query,
    targetProduct,
    updatedTargetProduct,
  }: SqliteIndexWorkerProductProofRuntimeInput) {
    this.events =
      events ??
      createSqliteIndexWorkerProductProofEvents({
        input,
      })
    this.executor = executor
    this.productVariantPriceSetLink = productVariantPriceSetLink
    this.proofRecords = proofRecords
    this.targetProduct = targetProduct
    this.updatedTargetProduct = updatedTargetProduct
    this.runtime = createSqliteIndexWorkerProofRuntime({
      executor,
      eventBus,
      joinerConfigs: input.joinerConfigs,
      query,
      schema: input.schema,
      transactionErrorMessage:
        "Index Worker runtime composition should not open transactions",
      workerMode: "worker",
    })
  }

  async runCompositionCheck(): Promise<SqliteIndexWorkerCompositionCheck> {
    const check = await runSqliteIndexWorkerEmptyQueryCheck({
      runtime: this.runtime,
      query: {
        fields: ["product.*"],
        filters: {
          product: {
            id: "prod_worker_index_missing",
          },
        },
        pagination: {
          skip: 0,
          take: 1,
        },
      },
    })

    return {
      dataCount: check.dataCount,
      estimateCount: check.estimateCount,
      matched: check.matched,
      moduleEntity: "Product",
      runtimeInstanceId: check.runtimeInstanceId,
      rootAlias: "product",
      serviceInitializations: check.serviceInitializations,
      seeded: false,
    }
  }

  async runEventIngestionCheck(): Promise<SqliteIndexWorkerProductEventIngestionCheck> {
    const query = {
      fields: ["product.*"],
      filters: {
        product: {
          id: this.targetProduct.id,
        },
      },
      pagination: {
        skip: 0,
        take: 1,
      },
    }
    const check = await runSqliteIndexWorkerEventLifecycleStringCheck({
      runtime: this.runtime,
      beforeCreate: () => {
        this.proofRecords.setRecords([this.targetProduct])
      },
      beforeUpdate: () => {
        this.proofRecords.setRecords([this.updatedTargetProduct])
      },
      beforeDelete: () => {
        this.proofRecords.setRecords([this.updatedTargetProduct])
      },
      createEvent: {
        name: this.events.productCreated,
        data: { id: this.targetProduct.id },
      },
      updateEvent: {
        name: this.events.productUpdated,
        data: { id: this.targetProduct.id },
      },
      deleteEvent: {
        name: this.events.productDeleted,
        data: { id: this.targetProduct.id },
      },
      query,
      createExpectedFields: [
        {
          field: "id",
          value: this.targetProduct.id,
        },
        {
          field: "handle",
          value: this.targetProduct.handle,
        },
        {
          field: "external_id",
          value: this.targetProduct.external_id,
        },
        {
          field: "title",
          value: this.targetProduct.title,
        },
      ],
      updateExpectedFields: [
        {
          field: "id",
          value: this.updatedTargetProduct.id,
        },
        {
          field: "handle",
          value: this.updatedTargetProduct.handle,
        },
        {
          field: "external_id",
          value: this.updatedTargetProduct.external_id,
        },
        {
          field: "title",
          value: this.updatedTargetProduct.title,
        },
      ],
    })
    const productId = findSqliteIndexWorkerObservedStringField(
      check.createFields,
      "id"
    )?.actual
    const productHandle = findSqliteIndexWorkerObservedStringField(
      check.createFields,
      "handle"
    )?.actual
    const productExternalId = findSqliteIndexWorkerObservedStringField(
      check.createFields,
      "external_id"
    )?.actual
    const productTitle = findSqliteIndexWorkerObservedStringField(
      check.createFields,
      "title"
    )?.actual
    const updatedProductHandle = findSqliteIndexWorkerObservedStringField(
      check.updateFields,
      "handle"
    )?.actual
    const updatedProductTitle = findSqliteIndexWorkerObservedStringField(
      check.updateFields,
      "title"
    )?.actual

    return {
      createMatched: check.createMatched,
      deleteDataCount: check.deleteDataCount,
      deleteEstimateCount: check.deleteEstimateCount,
      deleteMatched: check.deleteMatched,
      matched: check.matched,
      moduleEntity: "Product",
      productExternalId,
      productHandle,
      productId,
      productTitle,
      rootAlias: "product",
      serviceInitializations: check.serviceInitializations,
      updatedProductHandle,
      updatedProductTitle,
      updateMatched: check.updateMatched,
      writePath: check.writePath,
    }
  }

  async runLinkAttachDetachCheck(): Promise<SqliteIndexWorkerLinkAttachDetachCheck> {
    await resetIndexTables(this.executor)
    await seedProductVariantPriceAttachSupportIndex(this.executor)

    const check = await runSqliteIndexWorkerEventAttachDetachPathCheck({
      runtime: this.runtime,
      beforeAttach: () => {
        this.proofRecords.setRecords([this.productVariantPriceSetLink])
      },
      beforeDetach: () => {
        this.proofRecords.setRecords([this.productVariantPriceSetLink])
      },
      attachEvent: {
        name: this.events.productVariantPriceSetAttached,
        data: { id: this.productVariantPriceSetLink.id },
      },
      detachEvent: {
        name: this.events.productVariantPriceSetDetached,
        data: { id: this.productVariantPriceSetLink.id },
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
            id: "prod_worker_index_link",
            variants: {
              prices: {
                id: "price_worker_index_link",
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
          value: "prod_worker_index_link",
        },
        {
          path: ["variants", 0, "id"],
          value: "var_worker_index_link",
        },
        {
          path: ["variants", 0, "prices", 0, "id"],
          value: "price_worker_index_link",
        },
        {
          path: ["variants", 0, "prices", 0, "amount"],
          value: 500,
        },
      ],
    })
    const attachedProductId = check.attachFields.find(
      (field) => field.path.join(".") === "id"
    )?.actual
    const attachedVariantId = check.attachFields.find(
      (field) => field.path.join(".") === "variants.0.id"
    )?.actual
    const attachedPriceId = check.attachFields.find(
      (field) => field.path.join(".") === "variants.0.prices.0.id"
    )?.actual
    const attachedPriceAmount = check.attachFields.find(
      (field) => field.path.join(".") === "variants.0.prices.0.amount"
    )?.actual

    return {
      attachDataCount: check.attachDataCount,
      attachMatched: check.attachMatched,
      detachDataCount: check.detachDataCount,
      detachEstimateCount: check.detachEstimateCount,
      detachMatched: check.detachMatched,
      matched: check.matched,
      moduleEntity: "LinkProductVariantPriceSet",
      productId:
        typeof attachedProductId === "string" ? attachedProductId : undefined,
      productVariantId:
        typeof attachedVariantId === "string" ? attachedVariantId : undefined,
      rootAlias: "product",
      serviceInitializations: check.serviceInitializations,
      variantPriceAmount:
        typeof attachedPriceAmount === "number"
          ? attachedPriceAmount
          : undefined,
      variantPriceId:
        typeof attachedPriceId === "string" ? attachedPriceId : undefined,
      writePath: check.writePath,
    }
  }
}

export function createSqliteIndexWorkerProductProofDependencies(): SqliteIndexWorkerProductProofDependencies {
  const dependencies =
    createSqliteIndexWorkerMutableProofDependencies<SqliteIndexWorkerProductProofRecord>(
      {
        records: [sqliteIndexWorkerProductProofTarget],
      }
    )

  return {
    eventBus: dependencies.eventBus,
    productVariantPriceSetLink:
      sqliteIndexWorkerProductVariantPriceSetLinkProofTarget,
    proofRecords: dependencies.records,
    query: dependencies.query,
    targetProduct: sqliteIndexWorkerProductProofTarget,
    updatedTargetProduct: sqliteIndexWorkerUpdatedProductProofTarget,
  }
}

export function createSqliteIndexWorkerProductProofEvents({
  input,
}: {
  input: Pick<SqliteIndexWorkerStaticModuleInput, "entities">
}): SqliteIndexWorkerProductProofEvents {
  return {
    productCreated: getSqliteIndexWorkerRequiredEntityListener({
      action: "created",
      context: "Index Worker Product proof input",
      entity: "Product",
      input,
    }),
    productDeleted: getSqliteIndexWorkerRequiredEntityListener({
      action: "deleted",
      context: "Index Worker Product proof input",
      entity: "Product",
      input,
    }),
    productUpdated: getSqliteIndexWorkerRequiredEntityListener({
      action: "updated",
      context: "Index Worker Product proof input",
      entity: "Product",
      input,
    }),
    productVariantPriceSetAttached: "LinkProductVariantPriceSet.attached",
    productVariantPriceSetDetached: "LinkProductVariantPriceSet.detached",
  }
}
