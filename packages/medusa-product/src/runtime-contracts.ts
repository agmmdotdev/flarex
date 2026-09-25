import type { Context, DAL, InferEntityType, ProductTypes } from "@medusajs/framework/types";
import type { Product, ProductOption } from "./models";
/** Persistence contracts for the selected runtime closure. The specialized Category service
 * supplies the admitted portable tree behavior. Product deepUpdate remains an
 * unadmitted ORM-only dependency of the pinned Product service. */
export type ProductRepository = DAL.RepositoryService<typeof Product> & {
  deepUpdate(products: ({ id: string } & object)[], validate: (
    variants: ProductTypes.CreateProductVariantDTO[] | ProductTypes.UpdateProductVariantDTO[],
    options: InferEntityType<typeof ProductOption>[],
  ) => void, context?: unknown): Promise<InferEntityType<typeof Product>[]>;
};
/** The native Collection service decides replacement meaning; the selected
 * persistence profile owns complete selection and atomic application. */
export interface ProductCollectionMembershipReplacement {
  replace(selections: readonly Readonly<{ id: string; productIds: readonly string[] }>[],
    context: Context): Promise<void>;
}
export type { default as ProductCategoryService } from "./services/product-category";
