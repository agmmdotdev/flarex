import type { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import type { ICurrencyModuleService, IEventBusModuleService, ProductTypes, ModulesSdkTypes } from "@medusajs/framework/types";
export { default as MockEventBusService } from "@medusajs/test-utils/mock-event-bus-service";
export interface CurrencyRunnerOptions {
  moduleName: "currency";
  testSuite: (context: { service: Pick<ICurrencyModuleService, "listCurrencies" | "listAndCountCurrencies" | "retrieveCurrency"> }) => void;
}
export type ProductTestService = Pick<ProductModuleService,
  "retrieveProduct" | "listProducts" | "listAndCountProducts" | "updateProductTags" | "updateProductTypes" | "upsertProductTags" | "upsertProductTypes" | "createProductVariants" | "createProductCategories" | "upsertProductOptions" | "upsertProductCollections" | "upsertProductCategories" | "addImageToVariant" | "updateProductOptions" | "updateProductVariants" | "updateProductOptionValues" | "updateProductCollections" | "updateProductCategories" | "updateProducts" | "upsertProducts" | "upsertProductVariants" | "deleteProducts" | "deleteProductTags" | "deleteProductTypes" | "deleteProductCategories" | "deleteProductCollections" | "softDeleteProducts" | "restoreProducts" | "listProductTypes" | "listAndCountProductTypes" | "retrieveProductType" | "listProductTags" | "listAndCountProductTags" | "retrieveProductTag" | "listProductCollections" | "listAndCountProductCollections" | "retrieveProductCollection" | "listProductOptions" | "listAndCountProductOptions" | "retrieveProductOption" | "deleteProductOptions" | "removeImageFromVariant" | "softDeleteProductVariants" | "listProductVariants" | "listAndCountProductVariants" | "retrieveProductVariant" | "retrieveProductCategory" | "listProductCategories" | "listAndCountProductCategories"
> & ProductFixtureCreates & {
  productService_: Pick<ModulesSdkTypes.IMedusaInternalService<ProductTypes.ProductDTO>, "list" | "retrieve" | "create" | "update" | "softDelete" | "restore">;
  productCategoryService_: Pick<ProductCategoryService, "list" | "listAndCount" | "retrieve" | "create" | "update" | "delete">;
};
export interface ProductRunnerOptions {
  moduleName: "product";
  injectedDependencies?: { event_bus: IEventBusModuleService };
  testSuite: (context: { service: ProductTestService }) => void;
}
/** Source-test compiler boundary; the implementation checks these same overloads. */
export declare function moduleIntegrationTestRunner(options: CurrencyRunnerOptions): void;
export declare function moduleIntegrationTestRunner(options: ProductRunnerOptions): void;

/** Source-proven explicit IDs and nested tag references in the private test profile. */
interface ProductFixtureCreates {
  createProducts(input: (ProductFixtureInput)[]): Promise<ProductTypes.ProductDTO[]>;
  createProducts(input: ProductFixtureInput): Promise<ProductTypes.ProductDTO>;
  createProductTags(input: (ProductTypes.CreateProductTagDTO & { id?: string })[]): Promise<ProductTypes.ProductTagDTO[]>;
  createProductTags(input: ProductTypes.CreateProductTagDTO & { id?: string }): Promise<ProductTypes.ProductTagDTO>;
  createProductTypes(input: (ProductTypes.CreateProductTypeDTO & { id?: string })[]): Promise<ProductTypes.ProductTypeDTO[]>;
  createProductTypes(input: ProductTypes.CreateProductTypeDTO & { id?: string }): Promise<ProductTypes.ProductTypeDTO>;
  createProductOptions(input: (Omit<ProductTypes.CreateProductOptionDTO, "values"> & { id?: string; values?: string[] })[]): Promise<ProductTypes.ProductOptionDTO[]>;
  createProductOptions(input: Omit<ProductTypes.CreateProductOptionDTO, "values"> & { id?: string; values?: string[] }): Promise<ProductTypes.ProductOptionDTO>;
  createProductCollections(input: (ProductTypes.CreateProductCollectionDTO & { id?: string })[]): Promise<ProductTypes.ProductCollectionDTO[]>;
  createProductCollections(input: ProductTypes.CreateProductCollectionDTO & { id?: string }): Promise<ProductTypes.ProductCollectionDTO>;
  createProductImages(input: { id?: string; url: string; product_id: string; rank?: number }[]): Promise<ProductTypes.ProductImageDTO[]>;
}

type ProductFixtureInput = Omit<ProductTypes.CreateProductDTO, "type_id" | "tag_ids" | "collection_id"> & {
  id?: string; tags?: { id: string }[];
  type_id?: ProductTypes.CreateProductDTO["type_id"];
  tag_ids?: ProductTypes.CreateProductDTO["tag_ids"];
  collection_id?: ProductTypes.CreateProductDTO["collection_id"];
};
