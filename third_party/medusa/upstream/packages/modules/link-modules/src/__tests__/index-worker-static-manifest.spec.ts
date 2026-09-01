import { LINKS } from "@medusajs/framework/utils/portable"
import {
  linkModulesIndexWorkerStaticManifest,
  productSalesChannelIndexWorkerStaticManifest,
  productVariantPriceSetIndexWorkerStaticManifest,
} from "../index-worker-static-manifest"
import { ProductSalesChannel } from "../definitions/product-sales-channel"
import { ProductVariantPriceSet } from "../definitions/product-variant-price-set"

describe("Link modules Index Worker static manifest", () => {
  it("exposes ProductVariantPriceSet as a support joiner config", () => {
    expect(productVariantPriceSetIndexWorkerStaticManifest).toEqual({
      moduleDefinition: {
        key: LINKS.ProductVariantPriceSet,
      },
      resources: {
        joinerConfig: ProductVariantPriceSet,
      },
    })
    expect(
      linkModulesIndexWorkerStaticManifest.resources.joinerConfig.isLink
    ).toBe(true)
  })

  it("exposes ProductSalesChannel as a support joiner config", () => {
    expect(productSalesChannelIndexWorkerStaticManifest).toEqual({
      moduleDefinition: {
        key: LINKS.ProductSalesChannel,
      },
      resources: {
        joinerConfig: ProductSalesChannel,
      },
    })
    expect(
      productSalesChannelIndexWorkerStaticManifest.resources.joinerConfig
        .isLink
    ).toBe(true)
    expect(ProductSalesChannel.alias?.[0]?.entity).toBe(
      "LinkProductSalesChannel"
    )
  })
})
