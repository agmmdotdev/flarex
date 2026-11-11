import type { FindParams } from "../../common";
import type { BaseRegionCountryFilters, BaseRegionFilters } from "../common"

export interface StoreRegionFilters
  extends Omit<BaseRegionFilters, "created_at" | "updated_at">, FindParams {}
export interface StoreRegionCountryFilters extends BaseRegionCountryFilters {}
