import type { BaseFilterable } from "../../../dal"
import type { SelectParams } from "../../common"
import type { BaseProductTypeListParams } from "../common"

export interface StoreProductTypeListParams
  extends BaseProductTypeListParams,
    BaseFilterable<StoreProductTypeListParams> {}

export interface StoreProductTypeParams extends SelectParams {}
