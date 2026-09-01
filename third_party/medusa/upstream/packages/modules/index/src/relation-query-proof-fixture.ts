import { MedusaModule } from "@medusajs/framework/modules-sdk"
import {
  productSalesChannelIndexWorkerStaticManifest,
  productVariantPriceSetIndexWorkerStaticManifest,
} from "@medusajs/link-modules/index-worker-static-manifest"
import { pricingIndexWorkerStaticManifest } from "@medusajs/pricing/index-worker-static-manifest"
import { productIndexWorkerStaticManifest } from "@medusajs/product/index-worker-static-manifest"
import { salesChannelIndexWorkerStaticManifest } from "@medusajs/sales-channel/index-worker-static-manifest"
import {
  createSqliteIndexWorkerStaticManifest,
  createSqliteIndexWorkerStaticModuleInput,
} from "./sqlite-index-worker-static-module-input"
import type { SqliteIndexExecutor } from "./services/sqlite-index-storage-provider"

export const indexRelationQueryProofStaticManifest =
  createSqliteIndexWorkerStaticManifest({
    manifests: [
      productIndexWorkerStaticManifest,
      pricingIndexWorkerStaticManifest,
      salesChannelIndexWorkerStaticManifest,
      productVariantPriceSetIndexWorkerStaticManifest,
      productSalesChannelIndexWorkerStaticManifest,
    ],
  })

const indexRelationQueryProofInput = createSqliteIndexWorkerStaticModuleInput({
  entities: [
    {
      entity: "Product",
      events: ["product.created", "product.updated", "product.deleted"],
      fields: [
        "id",
        "title",
        "status",
        "handle",
        "is_giftcard",
        "external_id",
        "collection_id",
        "type_id",
        "created_at",
        "updated_at",
        "deleted_at",
        "categories",
        "collection",
        "images",
        "options",
        "sales_channels",
        "tags",
        "type",
        "variants",
      ],
    },
    {
      entity: "ProductVariant",
      events: ["variant.created", "variant.updated", "variant.deleted"],
      fields: [
        "id",
        "product_id",
        "sku",
        "created_at",
        "updated_at",
        "deleted_at",
        "images",
        "options",
        "prices",
      ],
    },
    {
      entity: "Price",
      events: ["price.created", "price.updated", "price.deleted"],
      fields: ["id", "amount", "price_rules"],
    },
    {
      entity: "PriceRule",
      events: [
        "price-rule.created",
        "price-rule.updated",
        "price-rule.deleted",
      ],
      fields: ["id", "attribute", "value", "price_id"],
    },
    {
      entity: "ProductCollection",
      events: [
        "product-collection.created",
        "product-collection.updated",
        "product-collection.deleted",
      ],
      fields: ["id", "title", "handle"],
    },
    {
      entity: "ProductCategory",
      events: [
        "product-category.created",
        "product-category.updated",
        "product-category.deleted",
      ],
      fields: ["id", "name", "handle", "is_active", "is_internal"],
    },
    {
      entity: "ProductType",
      events: [
        "product-type.created",
        "product-type.updated",
        "product-type.deleted",
      ],
      fields: ["id", "value"],
    },
    {
      entity: "ProductOption",
      events: [
        "product-option.created",
        "product-option.updated",
        "product-option.deleted",
      ],
      fields: ["id", "title", "product_id", "values"],
    },
    {
      entity: "ProductOptionValue",
      events: [
        "product-option-value.created",
        "product-option-value.updated",
        "product-option-value.deleted",
      ],
      fields: ["id", "value", "option_id"],
    },
    {
      entity: "ProductTag",
      events: [
        "product-tag.created",
        "product-tag.updated",
        "product-tag.deleted",
      ],
      fields: ["id", "value"],
    },
    {
      entity: "ProductImage",
      events: [
        "product-image.created",
        "product-image.updated",
        "product-image.deleted",
      ],
      fields: ["id", "url", "rank"],
    },
    {
      entity: "SalesChannel",
      events: [
        "sales-channel.sales-channel.created",
        "sales-channel.sales-channel.updated",
        "sales-channel.sales-channel.deleted",
      ],
      fields: ["id", "name", "description", "is_disabled"],
    },
  ],
  manifest: indexRelationQueryProofStaticManifest,
})

export const indexRelationQueryProofSchema = indexRelationQueryProofInput.schema

export function registerIndexRelationQueryProofJoinerConfigs(): void {
  for (const joinerConfig of indexRelationQueryProofInput.joinerConfigs) {
    const serviceName = joinerConfig.serviceName

    if (!serviceName) {
      throw new Error(
        "Index relation query proof joiner config requires a service name"
      )
    }

    MedusaModule.setJoinerConfig(serviceName, joinerConfig)
  }
}

export async function resetIndexTables(
  executor: SqliteIndexExecutor
): Promise<void> {
  await executor.execute("DELETE FROM index_relation")
  await executor.execute("DELETE FROM index_data")
}

export async function seedProductVariantPriceIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "Product", "prod_1", {
    id: "prod_1",
    title: "Product 1",
  })
  await insertIndexData(executor, "Product", "prod_2", {
    id: "prod_2",
    title: "Product 2 title",
    deep: {
      a: 1,
      obj: {
        b: 15,
      },
    },
  })
  await insertIndexData(executor, "ProductVariant", "var_1", {
    id: "var_1",
    sku: "aaa test aaa",
  })
  await insertIndexData(executor, "ProductVariant", "var_2", {
    id: "var_2",
    sku: "sku 123",
  })
  await insertIndexData(
    executor,
    "LinkProductVariantPriceSet",
    "link_id_1",
    {
      id: "link_id_1",
      variant_id: "var_1",
      price_set_id: "price_set_1",
    }
  )
  await insertIndexData(
    executor,
    "LinkProductVariantPriceSet",
    "link_id_2",
    {
      id: "link_id_2",
      variant_id: "var_2",
      price_set_id: "price_set_2",
    }
  )
  await insertIndexData(executor, "PriceSet", "price_set_1", {
    id: "price_set_1",
  })
  await insertIndexData(executor, "PriceSet", "price_set_2", {
    id: "price_set_2",
  })
  await insertIndexData(executor, "Price", "money_amount_1", {
    id: "money_amount_1",
    amount: 100,
  })
  await insertIndexData(executor, "Price", "money_amount_2", {
    id: "money_amount_2",
    amount: 10,
  })
  await insertIndexData(executor, "PriceRule", "price_rule_1", {
    id: "price_rule_1",
    attribute: "region_id",
    value: "reg_1",
    price_id: "money_amount_1",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductVariant",
    "var_1"
  )
  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductVariant",
    "var_2"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_1",
    "LinkProductVariantPriceSet",
    "link_id_1"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_2",
    "LinkProductVariantPriceSet",
    "link_id_2"
  )
  await insertIndexRelation(
    executor,
    "LinkProductVariantPriceSet",
    "link_id_1",
    "PriceSet",
    "price_set_1"
  )
  await insertIndexRelation(
    executor,
    "LinkProductVariantPriceSet",
    "link_id_2",
    "PriceSet",
    "price_set_2"
  )
  await insertIndexRelation(
    executor,
    "PriceSet",
    "price_set_1",
    "Price",
    "money_amount_1"
  )
  await insertIndexRelation(
    executor,
    "PriceSet",
    "price_set_2",
    "Price",
    "money_amount_2"
  )
  await insertIndexRelation(
    executor,
    "Price",
    "money_amount_1",
    "PriceRule",
    "price_rule_1"
  )
}

export async function seedProductVariantRouteFieldsIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await updateIndexData(executor, "ProductVariant", "var_1", {
    created_at: "2026-03-01T00:00:00.000Z",
    deleted_at: null,
    id: "var_1",
    product_id: "prod_1",
    sku: "aaa test aaa",
    updated_at: "2026-03-02T00:00:00.000Z",
  })
  await updateIndexData(executor, "ProductVariant", "var_2", {
    created_at: "2026-04-22T22:22:22.000Z",
    deleted_at: null,
    id: "var_2",
    product_id: "prod_1",
    sku: "sku 123",
    updated_at: "2026-04-23T23:23:23.000Z",
  })
}

export async function seedProductVariantPriceAttachSupportIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "Product", "prod_worker_index_link", {
    id: "prod_worker_index_link",
    title: "Worker Link Product",
  })
  await insertIndexData(
    executor,
    "ProductVariant",
    "var_worker_index_link",
    {
      id: "var_worker_index_link",
      sku: "worker-link-variant",
    }
  )
  await insertIndexData(executor, "PriceSet", "pset_worker_index_link", {
    id: "pset_worker_index_link",
  })
  await insertIndexData(executor, "Price", "price_worker_index_link", {
    amount: 500,
    id: "price_worker_index_link",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_worker_index_link",
    "ProductVariant",
    "var_worker_index_link"
  )
  await insertIndexRelation(
    executor,
    "PriceSet",
    "pset_worker_index_link",
    "Price",
    "price_worker_index_link"
  )
}

export async function seedProductStatusIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await updateIndexData(executor, "Product", "prod_1", {
    id: "prod_1",
    status: "published",
    title: "Product 1",
  })
  await updateIndexData(executor, "Product", "prod_2", {
    deep: {
      a: 1,
      obj: {
        b: 15,
      },
    },
    id: "prod_2",
    status: "draft",
    title: "Product 2 title",
  })
}

export async function seedProductTypeCollectionIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await updateIndexData(executor, "Product", "prod_1", {
    collection_id: "pcol_1",
    id: "prod_1",
    status: "published",
    title: "Product 1",
    type_id: "ptyp_1",
  })
  await insertIndexData(executor, "ProductCollection", "pcol_1", {
    handle: "collection-1",
    id: "pcol_1",
    title: "Collection 1",
  })
  await insertIndexData(executor, "ProductType", "ptyp_1", {
    id: "ptyp_1",
    value: "Type 1",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductCollection",
    "pcol_1"
  )
  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductType",
    "ptyp_1"
  )
}

export async function seedProductRouteDirectFieldsIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await updateIndexData(executor, "Product", "prod_1", {
    collection_id: "pcol_1",
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    external_id: "external_prod_1",
    handle: "product-1",
    id: "prod_1",
    is_giftcard: false,
    status: "published",
    title: "Product 1",
    type_id: "ptyp_1",
    updated_at: "2026-01-02T00:00:00.000Z",
  })
  await updateIndexData(executor, "Product", "prod_2", {
    created_at: "2026-02-22T22:22:22.000Z",
    deep: {
      a: 1,
      obj: {
        b: 15,
      },
    },
    deleted_at: null,
    external_id: "external_prod_2",
    handle: "product-2",
    id: "prod_2",
    is_giftcard: true,
    status: "draft",
    title: "Product 2 title",
    updated_at: "2026-02-23T23:23:23.000Z",
  })
}

export async function seedProductCategoryIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "ProductCategory", "pcat_1", {
    handle: "category-1",
    id: "pcat_1",
    is_active: true,
    is_internal: false,
    name: "Category 1",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductCategory",
    "pcat_1"
  )
}

export async function seedProductOptionValueIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "ProductOption", "opt_1", {
    id: "opt_1",
    product_id: "prod_1",
    title: "Color",
  })
  await insertIndexData(executor, "ProductOptionValue", "optval_1", {
    id: "optval_1",
    option_id: "opt_1",
    value: "Red",
  })
  await insertIndexData(executor, "ProductOptionValue", "optval_2", {
    id: "optval_2",
    option_id: "opt_1",
    value: "Blue",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductOption",
    "opt_1"
  )
  await insertIndexRelation(
    executor,
    "ProductOption",
    "opt_1",
    "ProductOptionValue",
    "optval_1"
  )
  await insertIndexRelation(
    executor,
    "ProductOption",
    "opt_1",
    "ProductOptionValue",
    "optval_2"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_1",
    "ProductOptionValue",
    "optval_1"
  )
}

export async function seedProductTagIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "ProductTag", "ptag_1", {
    id: "ptag_1",
    value: "Featured",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductTag",
    "ptag_1"
  )
}

export async function seedProductImageIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "ProductImage", "img_1", {
    id: "img_1",
    rank: 0,
    url: "https://example.test/product-image-1.png",
  })
  await insertIndexData(executor, "ProductImage", "img_variant_1", {
    id: "img_variant_1",
    rank: 1,
    url: "https://example.test/variant-image-1.png",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductImage",
    "img_1"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_1",
    "ProductImage",
    "img_variant_1"
  )
}

export async function seedProductSalesChannelIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(
    executor,
    "LinkProductSalesChannel",
    "prod_sc_link_1",
    {
      id: "prod_sc_link_1",
      product_id: "prod_1",
      sales_channel_id: "sc_1",
    }
  )
  await insertIndexData(executor, "SalesChannel", "sc_1", {
    description: "Default sales channel",
    id: "sc_1",
    is_disabled: false,
    name: "Default Sales Channel",
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "LinkProductSalesChannel",
    "prod_sc_link_1"
  )
  await insertIndexRelation(
    executor,
    "LinkProductSalesChannel",
    "prod_sc_link_1",
    "SalesChannel",
    "sc_1"
  )
}

async function insertIndexData(
  executor: SqliteIndexExecutor,
  entity: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await executor.execute(
    `
      INSERT INTO index_data (id, name, data, staled_at)
      VALUES (?, ?, ?, ?)
    `,
    [id, entity, JSON.stringify(data), null]
  )
}

async function updateIndexData(
  executor: SqliteIndexExecutor,
  entity: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await executor.execute(
    `
      UPDATE index_data
      SET data = ?
      WHERE name = ? AND id = ?
    `,
    [JSON.stringify(data), entity, id]
  )
}

async function insertIndexRelation(
  executor: SqliteIndexExecutor,
  parentName: string,
  parentId: string,
  childName: string,
  childId: string
): Promise<void> {
  await executor.execute(
    `
      INSERT INTO index_relation (
        pivot,
        parent_name,
        parent_id,
        child_name,
        child_id,
        staled_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [`${parentName}-${childName}`, parentName, parentId, childName, childId, null]
  )
}
