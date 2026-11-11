import type { PaginatedResponse } from "../../common"
import type { StoreRegion } from "./entities"

export type StoreRegionResponse = {
  /**
   * The region's details.
   */
  region: StoreRegion
}

export type StoreRegionListResponse = PaginatedResponse<{
  /**
   * The paginated list of regions.
   */
  regions: StoreRegion[]
}>
