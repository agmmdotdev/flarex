import type { BigNumberRawValue } from "../totals"
import type { Context } from "../shared-context"
import type { PricingRuleOperatorValues } from "./common/price-rule"
import type { PriceDTO } from "./common/price"
import type { UpdatePriceListPricesDTO } from "./common/price-list"
import type { UpdatePriceListPriceWorkflowDTO } from "./workflows"

/** The pinned callback and normalizer also support omitted IDs. */
export type PriceListPriceUpdateWorkflowPrice = Omit<
  UpdatePriceListPriceWorkflowDTO, "id"
> & { id?: string }

export interface PriceListPriceUpdateWorkflowData {
  id: string
  prices: PriceListPriceUpdateWorkflowPrice[]
}

/** Private-fork retained data for the Price List Price update workflow only.
 * These values do not grant callers general managed-field replay authority. */
export interface PriceListPriceSnapshotRule {
  id: string
  price_id: string
  attribute: string
  value: string
  operator: PricingRuleOperatorValues
  priority: number
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

export interface PriceListPriceSnapshotPrice {
  id: string
  title: string | null
  currency_code: string
  amount: number | string
  raw_amount: BigNumberRawValue
  min_quantity: number | string | null
  raw_min_quantity: BigNumberRawValue | null
  max_quantity: number | string | null
  raw_max_quantity: BigNumberRawValue | null
  rules_count: number | null
  price_set_id: string
  price_list_id: string | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  price_rules: PriceListPriceSnapshotRule[]
}

export interface PriceListPriceUpdateSnapshot {
  prices: PriceListPriceSnapshotPrice[]
}

export interface PriceListPriceUpdateCompensation {
  before: PriceListPriceSnapshotPrice[]
  createdPriceIds: string[]
}

/** An explicit workflow resource view, deliberately separate from IPricingModuleService. */
export interface PriceListPriceUpdateModuleService {
  snapshotPriceListPricesForUpdate(
    data: UpdatePriceListPricesDTO[],
    sharedContext?: Context
  ): Promise<PriceListPriceUpdateSnapshot>
  updatePriceListPrices(
    data: UpdatePriceListPricesDTO[],
    sharedContext?: Context
  ): Promise<PriceDTO[]>
  restorePriceListPrices(
    data: PriceListPriceUpdateCompensation,
    sharedContext?: Context
  ): Promise<void>
}
