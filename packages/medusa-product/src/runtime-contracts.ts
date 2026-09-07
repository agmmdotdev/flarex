import type { DAL, ModulesSdkTypes, InferEntityType, ProductTypes } from "@medusajs/framework/types";
import type { Product, ProductCategory, ProductOption } from "./models";
/** Persistence contracts for the selected runtime closure. Custom update and
 * category implementations remain unadmitted; their ORM classes are type-only
 * dependencies of the pinned Product service. */
export type ProductRepository = DAL.RepositoryService<typeof Product> & {
  deepUpdate(products: ({ id: string } & object)[], validate: (
    variants: ProductTypes.CreateProductVariantDTO[] | ProductTypes.UpdateProductVariantDTO[],
    options: InferEntityType<typeof ProductOption>[],
  ) => void, context?: unknown): Promise<InferEntityType<typeof Product>[]>;
};
export type ProductCategoryService = ModulesSdkTypes.IMedusaInternalService<typeof ProductCategory>;
