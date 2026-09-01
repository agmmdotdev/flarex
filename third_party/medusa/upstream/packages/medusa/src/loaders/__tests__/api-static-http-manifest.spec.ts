import express from "express"
import supertest from "supertest"

import { asValue } from "@medusajs/framework/awilix"
import { configManager } from "@medusajs/framework/config"
import type { MedusaRequest } from "@medusajs/framework/http"
import { StaticHttpManifestResolver } from "@medusajs/framework/http/static"
import { logger } from "@medusajs/framework/logger"
import type {
  AuthenticationInput,
  IAuthModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  createMedusaContainer,
  FeatureFlag,
  Modules,
} from "@medusajs/framework/utils"

import { medusaStaticHttpManifest } from "../../static/http-manifest"
import apiLoader from "../api"

type CurrencyRow = {
  code: string
  name: string
  symbol: string
  symbol_native: string
  decimal_digits: number
  rounding: number
}

type RemoteQueryResult = {
  rows:
    | CurrencyRow[]
    | RegionRow[]
    | RegionPaymentProviderRow[]
    | FulfillmentProviderRow[]
    | ShippingProfileRow[]
    | StockLocationRow[]
    | TaxRegionRow[]
    | AdminApiKeyRemoteQueryRow[]
    | InventoryItemRemoteQueryRow[]
    | ReservationRemoteQueryRow[]
    | ProductCollectionRow[]
    | ProductTypeRow[]
    | SalesChannelRemoteQueryRow[]
    | StoreRemoteQueryRow[]
  metadata: {
    count: number
    skip: number
    take: number
  }
}

type RemoteQueryResponse =
  | RemoteQueryResult
  | ServiceZoneRemoteQueryRow[]
  | CustomerRemoteQueryRow[]
  | PromotionRemoteQueryRow[]
  | CartRemoteQueryRow[]

type ServiceZoneRemoteQueryRow = {
  id: string
  name: string
  geo_zones: Array<{
    id: string
    type: string
    country_code: string
  }>
}

type RegionRow = {
  id: string
  name: string
  currency_code: string
}

type RegionPaymentProviderRow = {
  payment_provider: {
    id: string
    is_enabled: boolean
  }
}

type FulfillmentProviderRow = {
  id: string
  is_enabled: boolean
}

type ShippingProfileRow = {
  id: string
  name: string
  type: string
  metadata: Record<string, unknown>
}

type StockLocationRow = {
  id: string
  name: string
  metadata: Record<string, unknown>
  address: {
    id: string
    address_1: string
    address_2: string | null
    city: string
    country_code: string
    phone: string | null
    province: string | null
    postal_code: string
    metadata: Record<string, unknown>
  }
}

type TaxRegionRow = {
  id: string
  country_code: string
  province_code: string | null
  parent_id: string | null
  provider_id: string
}

type StoreRemoteQueryRow = {
  id: string
  name: string
  default_sales_channel_id: string
}

type CustomerRemoteQueryRow = {
  id: string
  email: string
  company_name: string | null
  first_name: string
  last_name: string
  phone: string | null
  metadata: Record<string, unknown>
  has_account: boolean
  deleted_at: null
  created_at: string
  updated_at: string
  addresses: unknown[]
}

type PromotionRemoteQueryRow = {
  id: string
  code: string
  is_automatic: boolean
  is_tax_inclusive: boolean
  type: string
  limit: number | null
  used: number
  status: string
  created_at: string
  updated_at: string
  deleted_at: null
  application_method: {
    type: string
    target_type: string
    value: number
    allocation: string
  }
  campaign: null
  rules: unknown[]
}

type CartRemoteQueryRow = {
  id: string
  currency_code: string
  email: string
  sales_channel_id: string
}

type SalesChannelRemoteQueryRow = {
  id: string
  name: string
  description: string
  is_disabled: boolean
}

type AdminApiKeyRemoteQueryRow = {
  id: string
  title: string
  token: string
  redacted: string
  type: string
  last_used_at: null
  created_by: string
  revoked_at: null
  revoked_by: null
  sales_channels: Array<{
    id: string
    name: string
  }>
}

type InventoryItemRemoteQueryRow = {
  id: string
  sku: string
  title: string
  description: string
  thumbnail: string | null
  origin_country: string | null
  hs_code: string | null
  requires_shipping: boolean
  mid_code: string | null
  material: string | null
  weight: number | null
  length: number | null
  height: number | null
  width: number | null
  metadata: Record<string, unknown>
  reserved_quantity: number
  stocked_quantity: number
  location_levels: Array<{
    id: string
    location_id: string
    stocked_quantity: number
    reserved_quantity: number
    incoming_quantity: number
    available_quantity: number
  }>
}

type ReservationRemoteQueryRow = {
  id: string
  location_id: string
  inventory_item_id: string
  quantity: number
  line_item_id: string | null
  description: string
  metadata: Record<string, unknown>
  inventory_item: {
    id: string
    sku: string
    title: string
  }
}

type PublishableApiKeyRow = {
  id: string
  token: string
  revoked_at: null
  sales_channels_link: Array<{
    sales_channel_id: string
  }>
}

type ProductTagRow = {
  id: string
  value: string
}

type ProductTypeRow = {
  id: string
  value: string
}

type ProductCollectionRow = {
  id: string
  title: string
  handle: string
}

type ProductCategoryRow = {
  id: string
  name: string
  description: string
  handle: string
  is_active: boolean
  is_internal: boolean
  rank: number
  parent_category_id: string | null
}

type PricePreferenceRow = {
  id: string
  attribute: string
  value: string
  is_tax_inclusive: boolean
}

type RefundReasonRow = {
  id: string
  label: string
  code: string
  description: string
}

type ShippingOptionTypeRow = {
  id: string
  label: string
  code: string
  description: string
}

type ProductRow = {
  id: string
  title: string
  handle: string
}

type ProductSalesChannelRow = {
  product_id: string
}

type ProductVariantRow = {
  id: string
  title: string
  sku: string
  product_id: string
}

type StoreRow = {
  supported_locales: Array<{
    locale_code: string
    locale: {
      name: string
    }
  }>
}

type LocaleRow = {
  code: string
  name: string
}

type TranslationRow = {
  id: string
  reference_id: string
  reference: string
  locale_code: string
  translations: Record<string, string>
}

type ShippingOptionRow = {
  id: string
  name: string
  price_type: string
}

type SalesChannelRow = {
  id: string
}

type QueryGraphInput = {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  pagination?: {
    skip: number
    take?: number
  }
}

type QueryService = {
  graph: (
    query: QueryGraphInput,
    options: Record<string, unknown>
  ) => Promise<{
    data:
      | PublishableApiKeyRow[]
      | ProductTagRow[]
      | ProductTypeRow[]
      | ProductCollectionRow[]
      | ProductCategoryRow[]
      | PricePreferenceRow[]
      | RefundReasonRow[]
      | ShippingOptionTypeRow[]
      | ShippingOptionRow[]
      | ProductRow[]
      | ProductSalesChannelRow[]
      | ProductVariantRow[]
      | StoreRow[]
      | LocaleRow[]
      | TranslationRow[]
      | SalesChannelRow[]
    metadata?: {
      count: number
      skip: number
      take: number
    }
  }>
}

type ListShippingOptionsWorkflowInput = {
  input: {
    cart_id: string
    is_return: boolean
    fields?: string[]
  }
}

type BatchTranslationsWorkflowInput = {
  input: {
    create: Array<{
      reference_id: string
      reference: string
      locale_code: string
      translations: Record<string, string>
    }>
    update: Array<{
      id: string
      reference_id?: string
      reference?: string
      locale_code?: string
      translations?: Record<string, string>
    }>
    delete: string[]
  }
}

type CreatePromotionsWorkflowInput = {
  input: {
    promotionsData: Array<{
      code: string
      type: string
      status?: string
      application_method: {
        type: string
        target_type: string
        value: number
        allocation?: string
      }
      is_automatic?: boolean
      is_tax_inclusive?: boolean
      limit?: number | null
    }>
    additional_data?: Record<string, unknown>
  }
}

type CreateShippingOptionsWorkflowInput = {
  input: Array<{
    name: string
    service_zone_id: string
    shipping_profile_id: string
    price_type: string
    provider_id: string
    type_id?: string
    prices: Array<{
      currency_code?: string
      region_id?: string
      amount: number
    }>
    data?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }>
}

type CreateProductsWorkflowInput = {
  input: {
    products: Array<{
      title: string
      handle?: string
      status?: string
    }>
    additional_data?: Record<string, unknown>
  }
}

type CreateCartWorkflowInput = {
  input: {
    currency_code?: string
    email?: string
    sales_channel_id?: string
    customer_id?: string
    additional_data?: Record<string, unknown>
  }
}

type WorkflowEngineInput =
  | ListShippingOptionsWorkflowInput
  | BatchTranslationsWorkflowInput
  | CreatePromotionsWorkflowInput
  | CreateShippingOptionsWorkflowInput
  | CreateProductsWorkflowInput
  | CreateCartWorkflowInput

type BatchTranslationsWorkflowResult = {
  created: Array<{ id: string }>
  updated: Array<{ id: string }>
}

type CreatePromotionsWorkflowResult = Array<{ id: string }>
type CreateProductsWorkflowResult = Array<{ id: string }>
type CreateCartWorkflowResult = { id: string }

type WorkflowEngineService = {
  run: (
    workflowId: string,
    input: WorkflowEngineInput
  ) => Promise<{
    result:
      | ShippingOptionRow[]
      | BatchTranslationsWorkflowResult
      | CreatePromotionsWorkflowResult
      | CreateProductsWorkflowResult
      | CreateCartWorkflowResult
  }>
}

type AuthModuleService = Pick<IAuthModuleService, "authenticate">

describe("Medusa API loader static HTTP manifest", () => {
  afterEach(() => {
    FeatureFlag.setFlag("translation", false)
  })

  it("registers generated Store/Admin manifest resources through the Express loader path", async () => {
    const app = express()
    const container = createMedusaContainer()
    const loadedConfig = configManager.loadConfig({
      baseDir: __dirname,
      throwOnError: false,
      projectConfig: {
        projectConfig: {
          http: {
            adminCors: "http://localhost:7001",
            authMethodsPerActor: {
              customer: ["emailpass"],
            },
            authCors: "http://localhost:9000",
            cookieSecret: "supersecret",
            jwtSecret: "supersecret",
            storeCors: "http://localhost:8000",
          },
        },
      },
    })

    const remoteQuery = jest.fn(
      async (query: {
        __value?: Record<
          string,
          {
            __args?: {
              take?: number
              skip?: number
            }
          }
        >
      }): Promise<RemoteQueryResponse> => {
        const currencyQuery = query.__value?.currency
        if (currencyQuery) {
          return {
            rows: [
              {
                code: "usd",
                decimal_digits: 2,
                name: "US Dollar",
                rounding: 0,
                symbol: "$",
                symbol_native: "$",
              },
            ],
            metadata: {
              count: 1,
              skip: currencyQuery.__args?.skip ?? 0,
              take: currencyQuery.__args?.take ?? 50,
            },
          }
        }

        const regionQuery = query.__value?.region
        if (regionQuery) {
          return {
            rows: [
              {
                currency_code: "usd",
                id: "reg_test",
                name: "United States",
              },
            ],
            metadata: {
              count: 1,
              skip: regionQuery.__args?.skip ?? 0,
              take: regionQuery.__args?.take ?? 50,
            },
          }
        }

        const regionPaymentProviderQuery =
          query.__value?.region_payment_provider
        if (regionPaymentProviderQuery) {
          return {
            rows: [
              {
                payment_provider: {
                  id: "pp_system_default",
                  is_enabled: true,
                },
              },
            ],
            metadata: {
              count: 1,
              skip: regionPaymentProviderQuery.__args?.skip ?? 0,
              take: regionPaymentProviderQuery.__args?.take ?? 20,
            },
          }
        }

        const fulfillmentProviderQuery = query.__value?.fulfillment_provider
        if (fulfillmentProviderQuery) {
          return {
            rows: [
              {
                id: "fp_manual",
                is_enabled: true,
              },
            ],
            metadata: {
              count: 1,
              skip: fulfillmentProviderQuery.__args?.skip ?? 0,
              take: fulfillmentProviderQuery.__args?.take ?? 50,
            },
          }
        }

        const shippingProfilesQuery = query.__value?.shipping_profiles
        if (shippingProfilesQuery) {
          return {
            rows: [
              {
                id: "sp_test",
                metadata: {},
                name: "Default Shipping Profile",
                type: "default",
              },
            ],
            metadata: {
              count: 1,
              skip: shippingProfilesQuery.__args?.skip ?? 0,
              take: shippingProfilesQuery.__args?.take ?? 20,
            },
          }
        }

        const stockLocationsQuery = query.__value?.stock_locations
        if (stockLocationsQuery) {
          return {
            rows: [
              {
                address: {
                  address_1: "100 Worker Ave",
                  address_2: null,
                  city: "Worker City",
                  country_code: "us",
                  id: "sladdr_test",
                  metadata: {},
                  phone: null,
                  postal_code: "10000",
                  province: null,
                },
                id: "sloc_test",
                metadata: {},
                name: "Worker Warehouse",
              },
            ],
            metadata: {
              count: 1,
              skip: stockLocationsQuery.__args?.skip ?? 0,
              take: stockLocationsQuery.__args?.take ?? 20,
            },
          }
        }

        const taxRegionsQuery = query.__value?.tax_regions
        if (taxRegionsQuery) {
          return {
            rows: [
              {
                country_code: "us",
                id: "txreg_test",
                parent_id: null,
                provider_id: "tp_system_default",
                province_code: null,
              },
            ],
            metadata: {
              count: 1,
              skip: taxRegionsQuery.__args?.skip ?? 0,
              take: taxRegionsQuery.__args?.take ?? 20,
            },
          }
        }

        const serviceZonesQuery = query.__value?.service_zones
        if (serviceZonesQuery) {
          return [
            {
              geo_zones: [
                {
                  country_code: "us",
                  id: "gz_test",
                  type: "country",
                },
              ],
              id: "serzo_test",
              name: "United States",
            },
          ]
        }

        const productCollectionQuery = query.__value?.product_collection
        if (productCollectionQuery) {
          return {
            rows: [
              {
                handle: "summer",
                id: "pcol_test",
                title: "Summer",
              },
            ],
            metadata: {
              count: 1,
              skip: productCollectionQuery.__args?.skip ?? 0,
              take: productCollectionQuery.__args?.take ?? 10,
            },
          }
        }

        const storeQuery = query.__value?.store
        if (storeQuery) {
          return {
            rows: [
              {
                default_sales_channel_id: "sc_test",
                id: "store_test",
                name: "Worker Store",
              },
            ],
            metadata: {
              count: 1,
              skip: storeQuery.__args?.skip ?? 0,
              take: storeQuery.__args?.take ?? 50,
            },
          }
        }

        const customerQuery = query.__value?.customer
        if (customerQuery) {
          return [
            {
              addresses: [],
              company_name: null,
              created_at: "2026-01-01T00:00:00.000Z",
              deleted_at: null,
              email: "customer@example.com",
              first_name: "Store",
              has_account: true,
              id: "cus_test",
              last_name: "Customer",
              metadata: {},
              phone: null,
              updated_at: "2026-01-02T00:00:00.000Z",
            },
          ]
        }

        const promotionQuery = query.__value?.promotion
        if (promotionQuery) {
          return [
            {
              application_method: {
                allocation: "each",
                target_type: "items",
                type: "percentage",
                value: 10,
              },
              campaign: null,
              code: "SUMMER10",
              created_at: "2026-01-01T00:00:00.000Z",
              deleted_at: null,
              id: "promo_test",
              is_automatic: false,
              is_tax_inclusive: false,
              limit: null,
              rules: [],
              status: "active",
              type: "standard",
              updated_at: "2026-01-02T00:00:00.000Z",
              used: 0,
            },
          ]
        }

        const apiKeyQuery = query.__value?.api_key
        if (apiKeyQuery) {
          return {
            rows: [
              {
                created_by: "user_test",
                id: "apikey_test",
                last_used_at: null,
                redacted: "pk_...test",
                revoked_at: null,
                revoked_by: null,
                sales_channels: [
                  {
                    id: "sc_test",
                    name: "Worker Sales Channel",
                  },
                ],
                title: "Worker publishable key",
                token: "pk_worker_test",
                type: "publishable",
              },
            ],
            metadata: {
              count: 1,
              skip: apiKeyQuery.__args?.skip ?? 0,
              take: apiKeyQuery.__args?.take ?? 20,
            },
          }
        }

        const cartQuery = query.__value?.cart
        if (cartQuery) {
          return [
            {
              currency_code: "usd",
              email: "cart@example.com",
              id: "cart_test",
              sales_channel_id: "sc_test",
            },
          ]
        }

        const inventoryItemsQuery = query.__value?.inventory_items
        if (inventoryItemsQuery) {
          return {
            rows: [
              {
                description: "Inventory for worker product",
                height: null,
                hs_code: null,
                id: "iitem_test",
                length: null,
                location_levels: [
                  {
                    available_quantity: 8,
                    id: "ilev_test",
                    incoming_quantity: 0,
                    location_id: "sloc_test",
                    reserved_quantity: 2,
                    stocked_quantity: 10,
                  },
                ],
                material: null,
                metadata: {},
                mid_code: null,
                origin_country: null,
                requires_shipping: true,
                reserved_quantity: 2,
                sku: "worker-sku",
                stocked_quantity: 10,
                thumbnail: null,
                title: "Worker Inventory Item",
                weight: null,
                width: null,
              },
            ],
            metadata: {
              count: 1,
              skip: inventoryItemsQuery.__args?.skip ?? 0,
              take: inventoryItemsQuery.__args?.take ?? 20,
            },
          }
        }

        const reservationQuery = query.__value?.reservation
        if (reservationQuery) {
          return {
            rows: [
              {
                description: "Worker reservation",
                id: "resv_test",
                inventory_item: {
                  id: "iitem_test",
                  sku: "worker-sku",
                  title: "Worker Inventory Item",
                },
                inventory_item_id: "iitem_test",
                line_item_id: null,
                location_id: "sloc_test",
                metadata: {},
                quantity: 2,
              },
            ],
            metadata: {
              count: 1,
              skip: reservationQuery.__args?.skip ?? 0,
              take: reservationQuery.__args?.take ?? 20,
            },
          }
        }

        const productTypeQuery = query.__value?.product_type
        if (productTypeQuery) {
          return {
            rows: [
              {
                id: "ptyp_test",
                value: "shirt",
              },
            ],
            metadata: {
              count: 1,
              skip: productTypeQuery.__args?.skip ?? 0,
              take: productTypeQuery.__args?.take ?? 10,
            },
          }
      }

      const salesChannelQuery = query.__value?.sales_channels
      if (salesChannelQuery) {
          return {
            rows: [
              {
                description: "Worker sales channel",
                id: "sc_test",
                is_disabled: false,
                name: "Worker Sales Channel",
              },
            ],
            metadata: {
              count: 1,
              skip: salesChannelQuery.__args?.skip ?? 0,
              take: salesChannelQuery.__args?.take ?? 20,
            },
          }
        }

        throw new Error(
          `Unexpected remote query entry point: ${Object.keys(
            query.__value ?? {}
          ).join(",")}`
        )
      }
    )

    const queryGraph = jest.fn(
      async (query: QueryGraphInput): ReturnType<QueryService["graph"]> => {
        if (query.entity === "api_key") {
          return {
            data: [
              {
                id: "pak_test",
                revoked_at: null,
                sales_channels_link: [{ sales_channel_id: "sc_test" }],
                token: "pk_test",
              },
            ],
          }
        }

        if (query.entity === "product_tag") {
          return {
            data: [
              {
                id: "ptag_test",
                value: "summer",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 50,
            },
          }
        }

        if (query.entity === "product_type") {
          return {
            data: [
              {
                id: "ptyp_test",
                value: "shirt",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 50,
            },
          }
        }

        if (query.entity === "product_collection") {
          return {
            data: [
              {
                handle: "summer",
                id: "pcol_test",
                title: "Summer",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 10,
            },
          }
        }

        if (query.entity === "product_category") {
          return {
            data: [
              {
                description: "Worker category",
                handle: "worker-category",
                id: "pcat_test",
                is_active: true,
                is_internal: false,
                name: "Worker Category",
                parent_category_id: null,
                rank: 0,
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 50,
            },
          }
        }

        if (query.entity === "price_preference") {
          return {
            data: [
              {
                attribute: "region_id",
                id: "ppref_test",
                is_tax_inclusive: true,
                value: "reg_test",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 300,
            },
          }
        }

        if (query.entity === "refund_reasons") {
          return {
            data: [
              {
                code: "damaged",
                description: "Item arrived damaged",
                id: "rr_test",
                label: "Damaged",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 15,
            },
          }
        }

        if (query.entity === "shipping_option_type") {
          return {
            data: [
              {
                code: "standard",
                description: "Standard shipping",
                id: "sotype_test",
                label: "Standard",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 10,
            },
          }
        }

        if (query.entity === "shipping_option") {
          return {
            data: [
              {
                id: "so_admin_test",
                name: "Admin standard shipping",
                price_type: "flat",
              },
            ],
          }
        }

        if (query.entity === "sales_channels") {
          return {
            data: [
              {
                id: "sc_test",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 1,
            },
          }
        }

        if (query.entity === "product") {
          if (query.filters?.id === "prod_admin_test") {
            return {
              data: [
                {
                  handle: "admin-worker-product",
                  id: "prod_admin_test",
                  title: "Admin Worker Product",
                },
              ],
            }
          }

          return {
            data: [
              {
                handle: "worker-product",
                id: "prod_test",
                title: "Worker Product",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 50,
            },
          }
        }

        if (query.entity === "product_sales_channel") {
          return {
            data: [
              {
                product_id: "prod_test",
              },
            ],
          }
        }

        if (query.entity === "variant") {
          return {
            data: [
              {
                id: "variant_test",
                product_id: "prod_test",
                sku: "worker-variant",
                title: "Worker Variant",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 20,
            },
          }
        }

        if (query.entity === "store") {
          return {
            data: [
              {
                supported_locales: [
                  {
                    locale: {
                      name: "English",
                    },
                    locale_code: "en",
                  },
                ],
              },
            ],
          }
        }

        if (query.entity === "locale") {
          return {
            data: [
              {
                code: "en",
                name: "English",
              },
            ],
            metadata: {
              count: 1,
              skip: query.pagination?.skip ?? 0,
              take: query.pagination?.take ?? 200,
            },
          }
        }

        if (query.entity === "translation") {
          return {
            data: [
              {
                id: "tr_test",
                locale_code: "en",
                reference: "product",
                reference_id: "prod_test",
                translations: {
                  title: "Worker Product",
                },
              },
            ],
          }
        }

        throw new Error(`Unexpected query entity: ${query.entity}`)
      }
    )
    const query: QueryService = {
      graph: queryGraph,
    }
    const workflowEngineRun = jest.fn(
      async (
        workflowId: string,
        input: WorkflowEngineInput
      ): ReturnType<WorkflowEngineService["run"]> => {
        if (workflowId === "list-shipping-options-for-cart") {
          return {
            result: [
              {
                id: "so_test",
                name: "Standard shipping",
                price_type: "flat",
              },
            ],
          }
        }

        if (workflowId === "batch-translations") {
          return {
            result: {
              created: [{ id: "tr_test" }],
              updated: [],
            },
          }
        }

        if (workflowId === "create-promotions") {
          return {
            result: [{ id: "promo_test" }],
          }
        }

        if (workflowId === "create-shipping-options-workflow") {
          return {
            result: [
              {
                id: "so_admin_test",
                name: "Admin standard shipping",
                price_type: "flat",
              },
            ],
          }
        }

        if (workflowId === "create-products") {
          return {
            result: [{ id: "prod_admin_test" }],
          }
        }

        if (workflowId === "create-cart") {
          return {
            result: { id: "cart_test" },
          }
        }

        throw new Error(`Unexpected workflow id: ${workflowId}`)
      }
    )
    const workflowEngine: WorkflowEngineService = {
      run: workflowEngineRun,
    }
    const authServiceAuthenticate = jest.fn(
      async (
        provider: string,
        providerData: AuthenticationInput
      ): ReturnType<AuthModuleService["authenticate"]> => {
        if (
          provider === "emailpass" &&
          providerData.query?.callback_url ===
            "https://store.example.test/auth/callback"
        ) {
          return {
            location: "https://auth.example.test/start",
            success: true,
          }
        }

        throw new Error(`Unexpected auth provider: ${provider}`)
      }
    )
    const authService: AuthModuleService = {
      authenticate: authServiceAuthenticate,
    }

    container.register({
      [ContainerRegistrationKeys.CONFIG_MODULE]: asValue(loadedConfig),
      [ContainerRegistrationKeys.FEATURE_FLAG_ROUTER]: asValue(FeatureFlag),
      [ContainerRegistrationKeys.LOGGER]: asValue(logger),
      [ContainerRegistrationKeys.QUERY]: asValue(query),
      [ContainerRegistrationKeys.REMOTE_QUERY]: asValue(remoteQuery),
      [Modules.AUTH]: asValue(authService),
      [Modules.WORKFLOW_ENGINE]: asValue(workflowEngine),
    })

    app.use((req, _res, next) => {
      const medusaReq = req as MedusaRequest
      medusaReq.scope = container.createScope() as MedusaContainer
      const isStoreCustomerRequest = medusaReq.path.startsWith(
        "/store/customers"
      )
      medusaReq.session = {
        auth_context: {
          actor_id: isStoreCustomerRequest ? "cus_test" : "user_test",
          actor_type: isStoreCustomerRequest ? "customer" : "user",
          auth_identity_id: isStoreCustomerRequest
            ? "auth_identity_customer_test"
            : "auth_identity_test",
          app_metadata: {},
          user_metadata: {},
        },
      }
      next()
    })

    FeatureFlag.setFlag("translation", true)
    await apiLoader({
      app,
      container,
      plugins: [],
      resourceResolver: new StaticHttpManifestResolver(medusaStaticHttpManifest),
    })
    FeatureFlag.setFlag("translation", false)

    const adminPluginsResponse = await supertest(app)
      .get("/admin/plugins")
      .expect(200)

    expect(adminPluginsResponse.body).toEqual({
      plugins: [],
    })

    const adminFeatureFlagsResponse = await supertest(app)
      .get("/admin/feature-flags")
      .expect(200)

    expect(adminFeatureFlagsResponse.body).toEqual({
      feature_flags: {
        translation: false,
      },
    })

    const adminPromotionsResponse = await supertest(app)
      .post("/admin/promotions")
      .send({
        application_method: {
          allocation: "each",
          target_type: "items",
          type: "percentage",
          value: 10,
        },
        code: "SUMMER10",
        status: "active",
        type: "standard",
      })
      .expect(200)

    expect(adminPromotionsResponse.body).toEqual({
      promotion: {
        application_method: {
          allocation: "each",
          target_type: "items",
          type: "percentage",
          value: 10,
        },
        campaign: null,
        code: "SUMMER10",
        created_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
        id: "promo_test",
        is_automatic: false,
        is_tax_inclusive: false,
        limit: null,
        rules: [],
        status: "active",
        type: "standard",
        updated_at: "2026-01-02T00:00:00.000Z",
        used: 0,
      },
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "create-promotions",
      expect.objectContaining({
        input: expect.objectContaining({
          promotionsData: [
            expect.objectContaining({
              code: "SUMMER10",
              type: "standard",
            }),
          ],
        }),
      })
    )
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          promotion: expect.objectContaining({
            __args: expect.objectContaining({
              filters: {
                id: "promo_test",
              },
            }),
            fields: expect.arrayContaining(["id", "code", "type", "status"]),
          }),
        }),
      })
    )

    const adminProductsResponse = await supertest(app)
      .post("/admin/products")
      .send({
        title: "Admin Worker Product",
      })
      .expect(200)

    expect(adminProductsResponse.body).toEqual({
      product: {
        handle: "admin-worker-product",
        id: "prod_admin_test",
        title: "Admin Worker Product",
      },
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "create-products",
      expect.objectContaining({
        input: expect.objectContaining({
          products: [
            expect.objectContaining({
              title: "Admin Worker Product",
            }),
          ],
        }),
      })
    )
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        fields: expect.arrayContaining(["id", "title", "handle"]),
        filters: {
          id: "prod_admin_test",
        },
      }),
      undefined
    )

    const adminLocalesResponse = await supertest(app)
      .get("/admin/locales")
      .expect(200)

    expect(adminLocalesResponse.body).toEqual({
      count: 1,
      limit: 200,
      locales: [
        {
          code: "en",
          name: "English",
        },
      ],
      offset: 0,
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "locale",
        fields: expect.arrayContaining(["code", "name"]),
      }),
      expect.objectContaining({
        cache: { enable: true },
      })
    )

    const adminTranslationsBatchResponse = await supertest(app)
      .post("/admin/translations/batch")
      .send({
        create: [
          {
            locale_code: "en",
            reference: "product",
            reference_id: "prod_test",
            translations: {
              title: "Worker Product",
            },
          },
        ],
      })
      .expect(200)

    expect(adminTranslationsBatchResponse.body).toEqual({
      created: [
        {
          id: "tr_test",
          locale_code: "en",
          reference: "product",
          reference_id: "prod_test",
          translations: {
            title: "Worker Product",
          },
        },
      ],
      deleted: {
        deleted: true,
        ids: [],
        object: "translation",
      },
      updated: [],
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "batch-translations",
      expect.objectContaining({
        input: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({
              locale_code: "en",
              reference: "product",
              reference_id: "prod_test",
            }),
          ]),
          delete: [],
          update: [],
        }),
      })
    )
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "translation",
        filters: {
          id: ["tr_test"],
        },
        fields: expect.arrayContaining([
          "id",
          "reference_id",
          "reference",
          "locale_code",
          "translations",
        ]),
      })
    )

    const adminFulfillmentProvidersResponse = await supertest(app)
      .get("/admin/fulfillment-providers")
      .expect(200)

    expect(adminFulfillmentProvidersResponse.body).toEqual({
      count: 1,
      fulfillment_providers: [
        {
          id: "fp_manual",
          is_enabled: true,
        },
      ],
      limit: 50,
      offset: 0,
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          fulfillment_provider: expect.objectContaining({
            fields: expect.arrayContaining(["id", "is_enabled"]),
          }),
        }),
      })
    )

    const adminFulfillmentSetServiceZoneResponse = await supertest(app)
      .get("/admin/fulfillment-sets/fset_test/service-zones/serzo_test")
      .expect(200)

    expect(adminFulfillmentSetServiceZoneResponse.body).toEqual({
      service_zone: {
        geo_zones: [
          {
            country_code: "us",
            id: "gz_test",
            type: "country",
          },
        ],
        id: "serzo_test",
        name: "United States",
      },
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          service_zones: expect.objectContaining({
            fields: expect.arrayContaining(["id", "name"]),
            geo_zones: expect.objectContaining({
              fields: expect.arrayContaining(["*"]),
            }),
          }),
        }),
      })
    )

    const adminStockLocationsResponse = await supertest(app)
      .get("/admin/stock-locations")
      .expect(200)

    expect(adminStockLocationsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      stock_locations: [
        {
          address: {
            address_1: "100 Worker Ave",
            address_2: null,
            city: "Worker City",
            country_code: "us",
            id: "sladdr_test",
            metadata: {},
            phone: null,
            postal_code: "10000",
            province: null,
          },
          id: "sloc_test",
          metadata: {},
          name: "Worker Warehouse",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          stock_locations: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "name",
              "metadata",
            ]),
            address: expect.objectContaining({
              fields: expect.arrayContaining([
                "id",
                "address_1",
                "country_code",
              ]),
            }),
          }),
        }),
      })
    )

    const adminShippingProfilesResponse = await supertest(app)
      .get("/admin/shipping-profiles")
      .expect(200)

    expect(adminShippingProfilesResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      shipping_profiles: [
        {
          id: "sp_test",
          metadata: {},
          name: "Default Shipping Profile",
          type: "default",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          shipping_profiles: expect.objectContaining({
            fields: expect.arrayContaining(["id", "name", "type", "metadata"]),
          }),
        }),
      })
    )

    const adminShippingOptionTypesResponse = await supertest(app)
      .get("/admin/shipping-option-types")
      .expect(200)

    expect(adminShippingOptionTypesResponse.body).toEqual({
      count: 1,
      limit: 10,
      offset: 0,
      shipping_option_types: [
        {
          code: "standard",
          description: "Standard shipping",
          id: "sotype_test",
          label: "Standard",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "shipping_option_type",
        fields: expect.arrayContaining([
          "id",
          "label",
          "code",
          "description",
        ]),
      })
    )

    const adminShippingOptionsResponse = await supertest(app)
      .post("/admin/shipping-options")
      .send({
        name: "Admin standard shipping",
        service_zone_id: "serzo_test",
        shipping_profile_id: "sp_test",
        data: {},
        price_type: "flat",
        provider_id: "fp_manual",
        type_id: "sotype_test",
        prices: [
          {
            currency_code: "usd",
            amount: 1000,
          },
        ],
      })
      .expect(200)

    expect(adminShippingOptionsResponse.body).toEqual({
      shipping_option: {
        id: "so_admin_test",
        name: "Admin standard shipping",
        price_type: "flat",
      },
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "create-shipping-options-workflow",
      expect.objectContaining({
        input: [
          expect.objectContaining({
            name: "Admin standard shipping",
            price_type: "flat",
            provider_id: "fp_manual",
            service_zone_id: "serzo_test",
            shipping_profile_id: "sp_test",
            type_id: "sotype_test",
          }),
        ],
      })
    )
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "shipping_option",
        filters: {
          id: "so_admin_test",
        },
        fields: expect.arrayContaining(["id", "name", "price_type"]),
      })
    )

    const adminTaxRegionsResponse = await supertest(app)
      .get("/admin/tax-regions")
      .expect(200)

    expect(adminTaxRegionsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      tax_regions: [
        {
          country_code: "us",
          id: "txreg_test",
          parent_id: null,
          provider_id: "tp_system_default",
          province_code: null,
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          tax_regions: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "country_code",
              "province_code",
              "provider_id",
            ]),
          }),
        }),
      })
    )

    const adminCollectionsResponse = await supertest(app)
      .get("/admin/collections")
      .expect(200)

    expect(adminCollectionsResponse.body).toEqual({
      collections: [
        {
          handle: "summer",
          id: "pcol_test",
          title: "Summer",
        },
      ],
      count: 1,
      limit: 10,
      offset: 0,
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          product_collection: expect.objectContaining({
            fields: expect.arrayContaining(["id", "title", "handle"]),
          }),
        }),
      })
    )

    const adminPricePreferencesResponse = await supertest(app)
      .get("/admin/price-preferences")
      .expect(200)

    expect(adminPricePreferencesResponse.body).toEqual({
      count: 1,
      limit: 300,
      offset: 0,
      price_preferences: [
        {
          attribute: "region_id",
          id: "ppref_test",
          is_tax_inclusive: true,
          value: "reg_test",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "price_preference",
        fields: expect.arrayContaining([
          "id",
          "attribute",
          "value",
          "is_tax_inclusive",
        ]),
      }),
      undefined
    )

    const adminRefundReasonsResponse = await supertest(app)
      .get("/admin/refund-reasons")
      .expect(200)

    expect(adminRefundReasonsResponse.body).toEqual({
      count: 1,
      limit: 15,
      offset: 0,
      refund_reasons: [
        {
          code: "damaged",
          description: "Item arrived damaged",
          id: "rr_test",
          label: "Damaged",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "refund_reasons",
        fields: expect.arrayContaining(["id", "label", "code", "description"]),
      }),
      undefined
    )

    const adminStoresResponse = await supertest(app)
      .get("/admin/stores")
      .expect(200)

    expect(adminStoresResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      stores: [
        {
          default_sales_channel_id: "sc_test",
          id: "store_test",
          name: "Worker Store",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          store: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "name",
              "default_sales_channel_id",
            ]),
          }),
        }),
      })
    )

    const adminApiKeysResponse = await supertest(app)
      .get("/admin/api-keys")
      .expect(200)

    expect(adminApiKeysResponse.body).toEqual({
      api_keys: [
        {
          created_by: "user_test",
          id: "apikey_test",
          last_used_at: null,
          redacted: "pk_...test",
          revoked_at: null,
          revoked_by: null,
          sales_channels: [
            {
              id: "sc_test",
              name: "Worker Sales Channel",
            },
          ],
          title: "Worker publishable key",
          token: "pk_worker_test",
          type: "publishable",
        },
      ],
      count: 1,
      limit: 20,
      offset: 0,
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          api_key: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "title",
              "token",
              "redacted",
              "type",
            ]),
            sales_channels: expect.objectContaining({
              fields: expect.arrayContaining(["id", "name"]),
            }),
          }),
        }),
      })
    )

    const adminInventoryItemsResponse = await supertest(app)
      .get("/admin/inventory-items")
      .expect(200)

    expect(adminInventoryItemsResponse.body).toEqual({
      count: 1,
      inventory_items: [
        {
          description: "Inventory for worker product",
          height: null,
          hs_code: null,
          id: "iitem_test",
          length: null,
          location_levels: [
            {
              available_quantity: 8,
              id: "ilev_test",
              incoming_quantity: 0,
              location_id: "sloc_test",
              reserved_quantity: 2,
              stocked_quantity: 10,
            },
          ],
          material: null,
          metadata: {},
          mid_code: null,
          origin_country: null,
          requires_shipping: true,
          reserved_quantity: 2,
          sku: "worker-sku",
          stocked_quantity: 10,
          thumbnail: null,
          title: "Worker Inventory Item",
          weight: null,
          width: null,
        },
      ],
      limit: 20,
      offset: 0,
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          inventory_items: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "sku",
              "title",
              "reserved_quantity",
              "stocked_quantity",
            ]),
            location_levels: expect.objectContaining({
              fields: expect.arrayContaining(["*"]),
            }),
          }),
        }),
      })
    )

    const adminReservationsResponse = await supertest(app)
      .get("/admin/reservations")
      .expect(200)

    expect(adminReservationsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      reservations: [
        {
          description: "Worker reservation",
          id: "resv_test",
          inventory_item: {
            id: "iitem_test",
            sku: "worker-sku",
            title: "Worker Inventory Item",
          },
          inventory_item_id: "iitem_test",
          line_item_id: null,
          location_id: "sloc_test",
          metadata: {},
          quantity: 2,
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          reservation: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "location_id",
              "inventory_item_id",
              "quantity",
            ]),
            inventory_item: expect.objectContaining({
              fields: expect.arrayContaining(["id", "sku", "title"]),
            }),
          }),
        }),
      })
    )

    const adminProductTagsResponse = await supertest(app)
      .get("/admin/product-tags")
      .expect(200)

    expect(adminProductTagsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      product_tags: [
        {
          id: "ptag_test",
          value: "summer",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_tag",
        fields: expect.arrayContaining(["id", "value"]),
      }),
      undefined
    )

    const adminProductTypesResponse = await supertest(app)
      .get("/admin/product-types")
      .expect(200)

    expect(adminProductTypesResponse.body).toEqual({
      count: 1,
      limit: 10,
      offset: 0,
      product_types: [
        {
          id: "ptyp_test",
          value: "shirt",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          product_type: expect.objectContaining({
            fields: expect.arrayContaining(["id", "value"]),
          }),
        }),
      })
    )

    const adminProductCategoriesResponse = await supertest(app)
      .get("/admin/product-categories")
      .expect(200)

    expect(adminProductCategoriesResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      product_categories: [
        {
          description: "Worker category",
          handle: "worker-category",
          id: "pcat_test",
          is_active: true,
          is_internal: false,
          name: "Worker Category",
          parent_category_id: null,
          rank: 0,
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_category",
        fields: expect.arrayContaining([
          "id",
          "name",
          "description",
          "handle",
          "is_active",
          "is_internal",
          "rank",
          "parent_category_id",
        ]),
      }),
      undefined
    )

    const adminRegionsResponse = await supertest(app)
      .get("/admin/regions")
      .expect(200)

    expect(adminRegionsResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      regions: [
        {
          currency_code: "usd",
          id: "reg_test",
          name: "United States",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          region: expect.objectContaining({
            fields: expect.arrayContaining(["id", "name", "currency_code"]),
          }),
        }),
      })
    )

    const adminSalesChannelsResponse = await supertest(app)
      .get("/admin/sales-channels")
      .expect(200)

    expect(adminSalesChannelsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      sales_channels: [
        {
          description: "Worker sales channel",
          id: "sc_test",
          is_disabled: false,
          name: "Worker Sales Channel",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          sales_channels: expect.objectContaining({
            fields: expect.arrayContaining([
              "id",
              "name",
              "description",
              "is_disabled",
            ]),
          }),
        }),
      })
    )

    const response = await supertest(app)
      .get("/store/currencies")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(response.body).toEqual({
      count: 1,
      currencies: [
        {
          code: "usd",
          decimal_digits: 2,
          name: "US Dollar",
          rounding: 0,
          symbol: "$",
          symbol_native: "$",
        },
      ],
      limit: 50,
      offset: 0,
    })
    expect(query.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "api_key",
      }),
      expect.objectContaining({
        cache: { enable: true },
      })
    )
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          currency: expect.objectContaining({
            fields: expect.arrayContaining(["code", "name"]),
          }),
        }),
      })
    )

    const productTagResponse = await supertest(app)
      .get("/store/product-tags")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(productTagResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      product_tags: [
        {
          id: "ptag_test",
          value: "summer",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_tag",
        fields: expect.arrayContaining(["id", "value"]),
      }),
      expect.objectContaining({
        locale: undefined,
      })
    )

    const productTypeResponse = await supertest(app)
      .get("/store/product-types")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(productTypeResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      product_types: [
        {
          id: "ptyp_test",
          value: "shirt",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_type",
        fields: expect.arrayContaining(["id", "value"]),
      }),
      expect.objectContaining({
        locale: undefined,
      })
    )

    const collectionsResponse = await supertest(app)
      .get("/store/collections")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(collectionsResponse.body).toEqual({
      collections: [
        {
          handle: "summer",
          id: "pcol_test",
          title: "Summer",
        },
      ],
      count: 1,
      limit: 10,
      offset: 0,
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product_collection",
        fields: expect.arrayContaining(["id", "title", "handle"]),
      }),
      expect.objectContaining({
        locale: undefined,
      })
    )

    const regionsResponse = await supertest(app)
      .get("/store/regions")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(regionsResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      regions: [
        {
          currency_code: "usd",
          id: "reg_test",
          name: "United States",
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          region: expect.objectContaining({
            fields: expect.arrayContaining(["id", "name", "currency_code"]),
          }),
        }),
      })
    )

    const paymentProvidersResponse = await supertest(app)
      .get("/store/payment-providers")
      .query({ region_id: "reg_test" })
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(paymentProvidersResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      payment_providers: [
        {
          id: "pp_system_default",
          is_enabled: true,
        },
      ],
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          region_payment_provider: expect.objectContaining({
            payment_provider: expect.objectContaining({
              fields: expect.arrayContaining(["id", "is_enabled"]),
            }),
          }),
        }),
      })
    )

    const productsResponse = await supertest(app)
      .get("/store/products")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(productsResponse.body).toEqual({
      count: 1,
      limit: 50,
      offset: 0,
      products: [
        {
          handle: "worker-product",
          id: "prod_test",
          title: "Worker Product",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        fields: expect.arrayContaining(["id", "title", "handle"]),
        filters: expect.objectContaining({
          status: "published",
        }),
      }),
      expect.objectContaining({
        cache: { enable: true },
        locale: undefined,
      })
    )

    const productVariantsResponse = await supertest(app)
      .get("/store/product-variants")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(productVariantsResponse.body).toEqual({
      count: 1,
      limit: 20,
      offset: 0,
      variants: [
        {
          id: "variant_test",
          product_id: "prod_test",
          sku: "worker-variant",
          title: "Worker Variant",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "variant",
        fields: expect.arrayContaining(["id", "title", "sku", "product_id"]),
        filters: expect.objectContaining({
          product: expect.objectContaining({
            status: "published",
          }),
        }),
      }),
      expect.objectContaining({
        cache: { enable: true },
        locale: undefined,
      })
    )

    const localesResponse = await supertest(app)
      .get("/store/locales")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(localesResponse.body).toEqual({
      locales: [
        {
          code: "en",
          name: "English",
        },
      ],
    })
    expect(queryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "store",
        fields: expect.arrayContaining([
          "supported_locales.*",
          "supported_locales.locale.*",
        ]),
        pagination: {
          take: 1,
        },
      })
    )

    const shippingOptionsResponse = await supertest(app)
      .get("/store/shipping-options")
      .query({ cart_id: "cart_test" })
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(shippingOptionsResponse.body).toEqual({
      shipping_options: [
        {
          id: "so_test",
          name: "Standard shipping",
          price_type: "flat",
        },
      ],
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "list-shipping-options-for-cart",
      {
        input: expect.objectContaining({
          cart_id: "cart_test",
          is_return: false,
          fields: [],
        }),
      }
    )

    const createCartResponse = await supertest(app)
      .post("/store/carts")
      .set("x-publishable-api-key", "pk_test")
      .send({
        currency_code: "usd",
        email: "cart@example.com",
      })
      .expect(200)

    expect(createCartResponse.body).toEqual({
      cart: {
        currency_code: "usd",
        email: "cart@example.com",
        id: "cart_test",
        sales_channel_id: "sc_test",
      },
    })
    expect(workflowEngineRun).toHaveBeenCalledWith(
      "create-cart",
      expect.objectContaining({
        input: expect.objectContaining({
          currency_code: "usd",
          email: "cart@example.com",
        }),
      })
    )
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          cart: expect.objectContaining({
            __args: expect.objectContaining({
              filters: {
                id: "cart_test",
              },
            }),
            fields: expect.arrayContaining([
              "id",
              "currency_code",
              "email",
              "sales_channel_id",
            ]),
          }),
        }),
      })
    )

    const storeCustomerResponse = await supertest(app)
      .get("/store/customers/me")
      .set("x-publishable-api-key", "pk_test")
      .expect(200)

    expect(storeCustomerResponse.body).toEqual({
      customer: {
        addresses: [],
        company_name: null,
        created_at: "2026-01-01T00:00:00.000Z",
        deleted_at: null,
        email: "customer@example.com",
        first_name: "Store",
        has_account: true,
        id: "cus_test",
        last_name: "Customer",
        metadata: {},
        phone: null,
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    })
    expect(remoteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        __value: expect.objectContaining({
          customer: expect.objectContaining({
            __args: expect.objectContaining({
              filters: {
                id: "cus_test",
              },
            }),
            fields: expect.arrayContaining([
              "id",
              "email",
              "first_name",
              "last_name",
            ]),
          }),
        }),
      })
    )

    const authResponse = await supertest(app)
      .get("/auth/customer/emailpass")
      .query({
        callback_url: "https://store.example.test/auth/callback",
      })
      .expect(200)

    expect(authResponse.body).toEqual({
      location: "https://auth.example.test/start",
    })
    expect(authServiceAuthenticate).toHaveBeenCalledWith(
      "emailpass",
      expect.objectContaining({
        query: expect.objectContaining({
          callback_url: "https://store.example.test/auth/callback",
        }),
        url: expect.stringContaining("/auth/customer/emailpass"),
      })
    )
  })
})
