import {
  CommonEvents,
  moduleEventBuilderFactory,
  Modules,
} from "@medusajs/framework/utils"

export const eventBuilders = {
  createdProductCategory: moduleEventBuilderFactory({
    source: Modules.PRODUCT,
    action: CommonEvents.CREATED,
    object: "product_category",
    eventName: "product.product-category.created",
  }),
  updatedProductCategory: moduleEventBuilderFactory({
    source: Modules.PRODUCT,
    action: CommonEvents.UPDATED,
    object: "product_category",
    eventName: "product.product-category.updated",
  }),
  deletedProductCategory: moduleEventBuilderFactory({
    source: Modules.PRODUCT,
    action: CommonEvents.DELETED,
    object: "product_category",
    eventName: "product.product-category.deleted",
  }),
}
