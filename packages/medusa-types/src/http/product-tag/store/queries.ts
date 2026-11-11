import type { BaseFilterable } from "../../../dal"
import type { SelectParams } from "../../common"
import type { BaseProductTagListParams } from "../common"

export interface StoreProductTagListParams
  extends BaseProductTagListParams,
    BaseFilterable<StoreProductTagListParams> {}

export interface StoreProductTagParams extends SelectParams {}
