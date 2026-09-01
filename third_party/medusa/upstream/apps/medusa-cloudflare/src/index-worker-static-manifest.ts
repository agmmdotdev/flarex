import { createSqliteIndexWorkerStaticManifest } from "@medusajs/index/worker-composition"
import {
  productSalesChannelIndexWorkerStaticManifest,
  productVariantPriceSetIndexWorkerStaticManifest,
} from "@medusajs/link-modules/index-worker-static-manifest"
import { pricingIndexWorkerStaticManifest } from "@medusajs/pricing/index-worker-static-manifest"
import { productIndexWorkerStaticManifest } from "@medusajs/product/index-worker-static-manifest"
import { salesChannelIndexWorkerStaticManifest } from "@medusajs/sales-channel/index-worker-static-manifest"

export const indexWorkerStaticManifest =
  createSqliteIndexWorkerStaticManifest({
    manifests: [
      productIndexWorkerStaticManifest,
      pricingIndexWorkerStaticManifest,
      salesChannelIndexWorkerStaticManifest,
      productVariantPriceSetIndexWorkerStaticManifest,
      productSalesChannelIndexWorkerStaticManifest,
    ],
  })
