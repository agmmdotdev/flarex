import type { StoreProduct } from "../../product/store/entitites"
import type { BaseCollection } from "../common"

export interface StoreCollection extends Omit<BaseCollection, "products"> {
  /**
   * The collection's products.
   */
  products?: StoreProduct[]
}
