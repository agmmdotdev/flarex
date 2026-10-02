import { ProductStatus } from "@medusajs/framework/utils/portable";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import type { LogicalReadMetadataScale } from "../../../../persistence-postgres/test/logicalReadMetadataScalingTestSupport";

export const nativeRetrievalMetadataVariants: readonly LogicalReadMetadataScale[] =
  (["tables", "indexes", "relations", "otherSourceDefinitions"] as const)
    .flatMap(axis => ([1, 100] as const).map(count => ({ axis, count })));

export const nativeRetrievalRelevantCounts = [1, 10, 100] as const;

/** Both public native seed owners receive these exact rows. One list request
 * returns the selected count, including distinct collection retrievals. */
export function nativeRetrievalRelevantDemand(count: typeof nativeRetrievalRelevantCounts[number],
  demand: "scalar" | "collection") {
  const collections = Array.from({ length: count }, (_, index) => ({
    id: `pcol_relevant_${String(index).padStart(3, "0")}`,
    title: `Relevant Collection ${index}`, handle: `relevant-collection-${index}`,
  }));
  const products = collections.map((collection, index) => ({
    id: `prod_relevant_${String(index).padStart(3, "0")}`,
    title: `Relevant Product ${index}`, handle: `relevant-product-${index}`,
    status: ProductStatus.PUBLISHED, discountable: true, is_giftcard: false, collection_id: collection.id,
  }));
  const config: FindConfig<ProductTypes.ProductDTO> = {
    select: demand === "scalar" ? ["id", "title", "handle", "status", "discountable", "is_giftcard"]
      : ["id", "title", "handle", "collection.id", "collection.title"],
    relations: demand === "scalar" ? [] : ["collection"],
    order: { id: "ASC" }, take: count,
  };
  const expected = products.map(product => {
    if (demand === "scalar") return { id: product.id, title: product.title, handle: product.handle,
      status: product.status, discountable: product.discountable, is_giftcard: product.is_giftcard };
    const collection = collections.find(current => current.id === product.collection_id);
    if (collection === undefined) throw new Error("Missing relevant collection seed");
    return { id: product.id, title: product.title, handle: product.handle, collection_id: product.collection_id,
      collection: { id: collection.id, title: collection.title } };
  });
  return { count, demand, collections, products, filters: { id: products.map(product => product.id) }, config, expected };
}
