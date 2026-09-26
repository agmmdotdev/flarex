import { isPresent, MathBN } from "@medusajs/framework/utils/portable"
import type { CalculatedPriceSetDTO } from "@medusajs/framework/types"

/** The row set supplied by a storage adapter is complete for the selected
 * PriceSet IDs, or the adapter must refuse before calling this function. */
export interface PricingSelectionRows {
  readonly prices: readonly (CalculatedPriceSetDTO & Readonly<{
    rules_count: number | null
    deleted_at: string | null
  }>)[]
  readonly lists: readonly Readonly<{
    id: string
    status: string
    type: string
    starts_at: string | null
    ends_at: string | null
    deleted_at: string | null
    rules_count: number | null
  }>[]
  readonly priceRules: readonly Readonly<{
    price_id: string
    attribute: string
    operator: string
    value: string
    deleted_at: string | null
  }>[]
  readonly listRules: readonly Readonly<{
    price_list_id: string
    attribute: string
    value: unknown
    deleted_at: string | null
  }>[]
}

type ContextValue = string | number | readonly (string | number)[]

/** PostgreSQL jsonb containment used by the pinned PriceListRule predicate.
 * The single scalar-in-array case is intentional PostgreSQL behavior. */
function containsJson(stored: unknown, requested: unknown): boolean {
  if (Array.isArray(stored)) {
    if (Array.isArray(requested)) return requested.every(member => stored.some(value => containsJson(value, member)))
    return stored.some(value => containsJson(value, requested))
  }
  if (Array.isArray(requested)) return false
  if (stored !== null && requested !== null && typeof stored === "object" && typeof requested === "object") {
    const source = stored as Record<string, unknown>
    return Object.entries(requested).every(([key, value]) => Object.prototype.hasOwnProperty.call(source, key) && containsJson(source[key], value))
  }
  return stored === requested
}

function matchesPriceRule(rule: PricingSelectionRows["priceRules"][number], context: Readonly<Record<string, ContextValue>>): boolean {
  const value = context[rule.attribute]
  if (value === undefined) return false
  if (typeof value === "number") {
    switch (rule.operator) {
      // The pinned SQL binds numeric equality as value.toString() against a
      // text column. Its range operators instead cast that column to numeric.
      case "eq": return value.toString() === rule.value
      case "gt": return MathBN.gt(value, rule.value)
      case "gte": return MathBN.gte(value, rule.value)
      case "lt": return MathBN.lt(value, rule.value)
      case "lte": return MathBN.lte(value, rule.value)
      default: return false
    }
  }
  const values = Array.isArray(value) ? value : [value]
  return values.some(member => String(member) === rule.value)
}

/** Medusa's repository eligibility and ordering over a finite indexed row set.
 * The native PricingModuleService still owns override/sale and tax decisions. */
export function selectCalculatedPriceRows(
  ids: readonly string[], currencyCode: string, quantity: string | number | undefined,
  context: Readonly<Record<string, ContextValue>>, now: Date, rows: PricingSelectionRows,
): CalculatedPriceSetDTO[] {
  const requested = new Set(ids)
  const lists = new Map(rows.lists.map(list => [list.id, list]))
  const presentContext = Object.fromEntries(Object.entries(context).filter(([, value]) =>
    Array.isArray(value) ? value.flat(1).length > 0 : isPresent(value)))
  const selected: Array<{ price: CalculatedPriceSetDTO; specificity: number }> = []
  for (const price of rows.prices) {
    if (!requested.has(price.price_set_id) || price.currency_code !== currencyCode || price.deleted_at !== null) continue
    if (quantity === undefined) {
      if (price.min_quantity !== null && MathBN.gt(price.min_quantity, 1)) continue
    } else if (price.min_quantity !== null && MathBN.gt(price.min_quantity, quantity) ||
      price.max_quantity !== null && MathBN.lt(price.max_quantity, quantity)) continue
    const candidate = price.price_list_id === null ? undefined : lists.get(price.price_list_id)
    const list = candidate?.status === "active" && candidate.deleted_at === null &&
      (candidate.starts_at === null || new Date(candidate.starts_at) <= now) &&
      (candidate.ends_at === null || new Date(candidate.ends_at) >= now) ? candidate : undefined
    if (price.price_list_id !== null && list === undefined) continue
    const priceMatches = rows.priceRules.filter(rule => rule.price_id === price.id && rule.deleted_at === null &&
      matchesPriceRule(rule, presentContext)).length
    const listMatches = list === undefined ? 0 : rows.listRules.filter(rule => {
      const value = presentContext[rule.attribute]
      return rule.price_list_id === list.id && rule.deleted_at === null && value !== undefined &&
        (Array.isArray(value) ? value.some(member => containsJson(rule.value, member)) : containsJson(rule.value, value))
    }).length
    if (priceMatches !== price.rules_count ||
      (list !== undefined && listMatches !== list.rules_count)) continue
    selected.push({ price: { id: price.id, price_set_id: price.price_set_id, amount: price.amount,
      raw_amount: price.raw_amount, currency_code: price.currency_code, min_quantity: price.min_quantity,
      max_quantity: price.max_quantity, price_list_id: price.price_list_id,
      price_list_type: list?.type ?? null }, specificity: price.rules_count! + (list?.rules_count ?? 0) })
  }
  selected.sort((left, right) => {
    if ((left.price.price_list_id !== null) !== (right.price.price_list_id !== null))
      return left.price.price_list_id !== null ? -1 : 1
    if (left.specificity !== right.specificity) return right.specificity - left.specificity
    if (left.price.amount === null || right.price.amount === null) return 0
    return MathBN.lt(left.price.amount, right.price.amount) ? -1 : MathBN.gt(left.price.amount, right.price.amount) ? 1 : 0
  })
  return selected.map(row => row.price)
}
