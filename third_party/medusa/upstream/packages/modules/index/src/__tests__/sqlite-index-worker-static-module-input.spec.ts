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
  getSqliteIndexWorkerRequiredEntityListener,
  type SqliteIndexWorkerStaticModuleEntity,
} from "../sqlite-index-worker-static-module-input"

// Mirrors the static portions of the current Store/Admin product route defaults
// without importing packages/medusa into the Index module test graph.
const productRouteStaticDefaultEntities = [
  {
    entity: "Product",
    fields: [
      "id",
      "title",
      "subtitle",
      "status",
      "external_id",
      "description",
      "handle",
      "is_giftcard",
      "discountable",
      "thumbnail",
      "collection_id",
      "type_id",
      "weight",
      "length",
      "height",
      "width",
      "hs_code",
      "origin_country",
      "mid_code",
      "material",
      "created_at",
      "updated_at",
      "deleted_at",
      "metadata",
      "type",
      "categories",
      "collection",
      "options",
      "tags",
      "images",
      "variants",
      "sales_channels",
    ],
  },
  {
    entity: "ProductVariant",
    fields: [
      "id",
      "title",
      "sku",
      "thumbnail",
      "barcode",
      "ean",
      "upc",
      "allow_backorder",
      "manage_inventory",
      "hs_code",
      "origin_country",
      "mid_code",
      "material",
      "weight",
      "length",
      "height",
      "width",
      "metadata",
      "variant_rank",
      "product_id",
      "created_at",
      "updated_at",
      "deleted_at",
      "prices",
      "options",
    ],
  },
  {
    entity: "Price",
    fields: ["id", "amount", "price_rules"],
  },
  {
    entity: "PriceRule",
    fields: ["id", "attribute", "value", "price_id"],
  },
  {
    entity: "ProductCollection",
    fields: ["id", "title", "handle"],
  },
  {
    entity: "ProductCategory",
    fields: ["id", "name", "handle", "is_active", "is_internal"],
  },
  {
    entity: "ProductType",
    fields: ["id", "value"],
  },
  {
    entity: "ProductOption",
    fields: ["id", "title", "product_id", "values"],
  },
  {
    entity: "ProductOptionValue",
    fields: ["id", "value", "option_id"],
  },
  {
    entity: "ProductTag",
    fields: ["id", "value"],
  },
  {
    entity: "ProductImage",
    fields: ["id", "url", "rank"],
  },
  {
    entity: "SalesChannel",
    fields: ["id", "name", "description", "is_disabled"],
  },
] as const satisfies readonly SqliteIndexWorkerStaticModuleEntity[]

const productRouteAggregateManifest = createSqliteIndexWorkerStaticManifest({
  manifests: [
    productIndexWorkerStaticManifest,
    pricingIndexWorkerStaticManifest,
    salesChannelIndexWorkerStaticManifest,
    productVariantPriceSetIndexWorkerStaticManifest,
    productSalesChannelIndexWorkerStaticManifest,
  ],
})

describe("SQLite Index Worker static module input", () => {
  it("derives schema listeners and joiner configs from static module manifests", () => {
    const joinerConfig = {
      alias: [
        {
          entity: "ProductCategory",
          name: "product_category",
        },
      ],
      schema: `
        type ProductCategory {
          id: ID!
          name: String!
        }
      `,
      serviceName: "product",
    }

    const staticManifest = createSqliteIndexWorkerStaticManifest({
      manifests: [
        {
          moduleDefinition: {
            key: "product",
          },
          resources: {
            indexEntities: [
              {
                entity: "ProductCategory",
                fields: ["id", "name"],
              },
            ],
            joinerConfig,
          },
        },
      ],
    })
    const input = createSqliteIndexWorkerStaticModuleInput({
      manifest: staticManifest,
    })

    expect(input.joinerConfigs).toEqual([joinerConfig])
    expect(input.entities).toEqual([
      {
        entity: "ProductCategory",
        listeners: [
          "product.product-category.created",
          "product.product-category.updated",
          "product.product-category.deleted",
        ],
        moduleKey: "product",
        serviceName: "product",
      },
    ])
    expect(input.schema).toContain(
      'type ProductCategory @Listeners(values: ["product.product-category.created", "product.product-category.updated", "product.product-category.deleted"])'
    )
  })

  it("preserves support joiner configs that do not contribute indexed schema", () => {
    const productJoinerConfig = {
      alias: [
        {
          entity: "Product",
          name: "product",
        },
      ],
      schema: `
        type Product {
          id: ID!
        }
      `,
      serviceName: "product",
    }
    const linkJoinerConfig = {
      isLink: true,
      serviceName: "product_variant_price_set",
    }
    const input = createSqliteIndexWorkerStaticModuleInput({
      manifests: [
        {
          moduleDefinition: {
            key: "product",
          },
          resources: {
            indexEntities: [
              {
                entity: "Product",
                fields: ["id"],
              },
            ],
            joinerConfig: productJoinerConfig,
          },
        },
        {
          moduleDefinition: {
            key: "product_variant_price_set",
          },
          resources: {
            joinerConfig: linkJoinerConfig,
          },
        },
      ],
    })

    expect(input.joinerConfigs).toEqual([
      productJoinerConfig,
      linkJoinerConfig,
    ])
    expect(input.entities).toEqual([
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
    ])
    expect(input.schema).toContain("type Product")
  })

  it("derives requested link-extended fields from support joiner configs", () => {
    const productJoinerConfig = {
      alias: [
        {
          entity: "Product",
          name: "product",
        },
        {
          entity: "ProductVariant",
          name: "product_variant",
        },
      ],
      schema: `
        type Product {
          id: ID!
          title: String!
          variants: [ProductVariant]
        }

        type ProductVariant {
          id: ID!
          sku: String
          product_id: String
        }
      `,
      serviceName: "product",
    }
    const pricingJoinerConfig = {
      alias: [
        {
          entity: "PriceSet",
          name: "price_set",
        },
        {
          entity: "Price",
          name: "price",
        },
      ],
      schema: `
        type PriceSet {
          id: ID!
          prices: [Price]!
        }

        type Price {
          id: ID!
          amount: Float!
        }
      `,
      serviceName: "pricing",
    }
    const linkJoinerConfig = {
      alias: [
        {
          entity: "LinkProductVariantPriceSet",
          name: "product_variant_price_set",
        },
      ],
      extends: [
        {
          entity: "ProductVariant",
          fieldAlias: {
            prices: {
              isList: true,
              path: "price_set_link.price_set.prices",
            },
          },
          relationship: {
            alias: "price_set_link",
            foreignKey: "id",
            primaryKey: "variant_id",
            serviceName: "product_variant_price_set",
          },
          serviceName: "product",
        },
      ],
      isLink: true,
      relationships: [
        {
          alias: "variant",
          entity: "ProductVariant",
          foreignKey: "variant_id",
          primaryKey: "id",
          serviceName: "product",
        },
        {
          alias: "price_set",
          entity: "PriceSet",
          foreignKey: "price_set_id",
          primaryKey: "id",
          serviceName: "pricing",
        },
      ],
      serviceName: "product_variant_price_set",
    }

    const input = createSqliteIndexWorkerStaticModuleInput({
      manifests: [
        {
          moduleDefinition: {
            key: "product",
          },
          resources: {
            indexEntities: [
              {
                entity: "Product",
                fields: ["id", "title", "variants"],
              },
              {
                entity: "ProductVariant",
                fields: ["id", "sku", "product_id", "prices"],
              },
            ],
            joinerConfig: productJoinerConfig,
          },
        },
        {
          moduleDefinition: {
            key: "pricing",
          },
          resources: {
            indexEntities: [
              {
                entity: "Price",
                fields: ["id", "amount"],
              },
            ],
            joinerConfig: pricingJoinerConfig,
          },
        },
        {
          moduleDefinition: {
            key: "product_variant_price_set",
          },
          resources: {
            joinerConfig: linkJoinerConfig,
          },
        },
      ],
    })

    expect(input.schema).toContain("prices: [Price]!")
    expect(input.schema).toContain("type Price")
    expect(input.entities.map((entity) => entity.entity)).toEqual([
      "Product",
      "ProductVariant",
      "Price",
    ])
  })

  it("builds the aggregate schema for current Store/Admin product route static defaults", () => {
    const input = createSqliteIndexWorkerStaticModuleInput({
      entities: productRouteStaticDefaultEntities,
      manifest: productRouteAggregateManifest,
    })

    expect(input.entities.map((entity) => entity.entity)).toEqual([
      "Product",
      "ProductVariant",
      "ProductCollection",
      "ProductCategory",
      "ProductType",
      "ProductOption",
      "ProductOptionValue",
      "ProductTag",
      "ProductImage",
      "Price",
      "PriceRule",
      "SalesChannel",
    ])
    expect(input.schema).toContain("sales_channels: [SalesChannel]")
    expect(input.schema).toContain("categories: [ProductCategory]")
    expect(input.schema).toContain("prices: [Price]")
    expect(input.schema).toContain("price_rules: [PriceRule]")
    expect(input.schema).not.toContain("calculated_price")
  })

  it("keeps Store product calculated price out of static Product Index projection", () => {
    const entitiesWithCalculatedPrice =
      productRouteStaticDefaultEntities.map((entity) =>
        entity.entity === "ProductVariant"
          ? {
              ...entity,
              fields: [...entity.fields, "calculated_price"],
            }
          : entity
      )

    expect(() =>
      createSqliteIndexWorkerStaticModuleInput({
        entities: entitiesWithCalculatedPrice,
        manifest: productRouteAggregateManifest,
      })
    ).toThrow(
      "SQLite Index Worker static input could not resolve extended field ProductVariant.calculated_price from path price_set_link.price_set.calculated_price"
    )
  })

  it("fails loudly when a requested link-extended field cannot be resolved", () => {
    const productJoinerConfig = {
      alias: [
        {
          entity: "ProductVariant",
          name: "product_variant",
        },
      ],
      schema: `
        type ProductVariant {
          id: ID!
        }
      `,
      serviceName: "product",
    }
    const pricingJoinerConfig = {
      alias: [
        {
          entity: "PriceSet",
          name: "price_set",
        },
      ],
      schema: `
        type PriceSet {
          id: ID!
        }
      `,
      serviceName: "pricing",
    }
    const linkJoinerConfig = {
      alias: [
        {
          entity: "LinkProductVariantPriceSet",
          name: "product_variant_price_set",
        },
      ],
      extends: [
        {
          entity: "ProductVariant",
          fieldAlias: {
            calculated_price: {
              path: "price_set_link.price_set.calculated_price",
            },
          },
          relationship: {
            alias: "price_set_link",
            foreignKey: "id",
            primaryKey: "variant_id",
            serviceName: "product_variant_price_set",
          },
          serviceName: "product",
        },
      ],
      isLink: true,
      relationships: [
        {
          alias: "price_set",
          entity: "PriceSet",
          foreignKey: "price_set_id",
          primaryKey: "id",
          serviceName: "pricing",
        },
      ],
      serviceName: "product_variant_price_set",
    }

    expect(() =>
      createSqliteIndexWorkerStaticModuleInput({
        manifests: [
          {
            moduleDefinition: {
              key: "product",
            },
            resources: {
              indexEntities: [
                {
                  entity: "ProductVariant",
                  fields: ["id", "calculated_price"],
                },
              ],
              joinerConfig: productJoinerConfig,
            },
          },
          {
            moduleDefinition: {
              key: "pricing",
            },
            resources: {
              joinerConfig: pricingJoinerConfig,
            },
          },
          {
            moduleDefinition: {
              key: "product_variant_price_set",
            },
            resources: {
              joinerConfig: linkJoinerConfig,
            },
          },
        ],
      })
    ).toThrow(
      "SQLite Index Worker static input could not resolve extended field ProductVariant.calculated_price from path price_set_link.price_set.calculated_price"
    )
  })

  it("fails loudly when a requested entity is absent from the manifests", () => {
    expect(() =>
      createSqliteIndexWorkerStaticModuleInput({
        entities: [{ entity: "ProductCategory" }],
        manifests: [
          {
            moduleDefinition: {
              key: "product",
            },
            resources: {},
          },
        ],
      })
    ).toThrow(
      "SQLite Index Worker static input could not find entities: ProductCategory"
    )
  })

  it("fails loudly when no indexed entities are provided", () => {
    expect(() =>
      createSqliteIndexWorkerStaticModuleInput({
        manifests: [
          {
            moduleDefinition: {
              key: "product",
            },
            resources: {},
          },
        ],
      })
    ).toThrow(
      "SQLite Index Worker static input requires at least one indexed entity"
    )
  })

  it("fails loudly when an aggregate manifest repeats a module", () => {
    expect(() =>
      createSqliteIndexWorkerStaticManifest({
        manifests: [
          {
            moduleDefinition: {
              key: "product",
            },
            resources: {},
          },
          {
            moduleDefinition: {
              key: "product",
            },
            resources: {},
          },
        ],
      })
    ).toThrow(
      "SQLite Index Worker static manifest contains duplicate module product"
    )
  })

  it("returns a required listener from static module input", () => {
    expect(
      getSqliteIndexWorkerRequiredEntityListener({
        action: "created",
        entity: "ProductCategory",
        input: {
          entities: [
            {
              entity: "ProductCategory",
              listeners: [
                "product.product-category.created",
                "product.product-category.updated",
              ],
              moduleKey: "product",
              serviceName: "product",
            },
          ],
        },
      })
    ).toBe("product.product-category.created")
  })

  it("fails loudly when a required listener is missing", () => {
    expect(() =>
      getSqliteIndexWorkerRequiredEntityListener({
        action: "deleted",
        context: "Index Worker proof input",
        entity: "ProductCategory",
        input: {
          entities: [
            {
              entity: "ProductCategory",
              listeners: ["product.product-category.created"],
              moduleKey: "product",
              serviceName: "product",
            },
          ],
        },
      })
    ).toThrow(
      "Index Worker proof input is missing ProductCategory.deleted listener"
    )
  })
})
