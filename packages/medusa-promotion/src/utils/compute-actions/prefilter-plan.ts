import type { Context, PromotionTypes } from "@medusajs/framework/types"
import { flattenObjectToKeyValuePairs } from "@medusajs/utils/common/flatten-object-to-key-value-pairs"
import { MedusaError } from "@medusajs/framework/utils/portable"

/** Native Promotion's storage-independent predicate vocabulary. The persistence
 * owner validates these data against the genuine Rule and Value definitions. */
export type PromotionScalarPredicate =
  | { readonly kind: "and" | "or"; readonly children: readonly PromotionScalarPredicate[] }
  | { readonly kind: "in"; readonly column: string; readonly values: readonly (string | boolean | null)[] }
  | { readonly kind: "isNull"; readonly column: string }
  | { readonly kind: "postgresText"; readonly column: string; readonly operator: "notIn"; readonly values: readonly string[] }
  | { readonly kind: "postgresNumericCast"; readonly column: string; readonly operator: "gt" | "gte" | "lt" | "lte"; readonly value: number }

export type PromotionRelatedPredicate =
  | { readonly kind: "and" | "or"; readonly children: readonly PromotionRelatedPredicate[] }
  | { readonly kind: "parent" | "child" | "notInChild"; readonly predicate: PromotionScalarPredicate }

export interface PromotionPrefilterPersistence {
  promotions(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { id: string }[]>
  rules(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { id: string; attribute: string }[]>
  applicationMethods(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { id: string; promotion_id: string }[]>
  globalRules(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { promotion_id: string; promotion_rule_id: string }[]>
  targetRules(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { application_method_id: string; promotion_rule_id: string }[]>
  buyRules(predicate: PromotionScalarPredicate, context: Context): Promise<readonly { application_method_id: string; promotion_rule_id: string }[]>
  evaluateRules(predicate: PromotionRelatedPredicate, context: Context): Promise<readonly { id: string }[]>
}

type ContextValue = string | number | boolean
const member = (column: string, values: readonly (string | boolean | null)[]): PromotionScalarPredicate => ({ kind: "in", column, values })
const parent = (predicate: PromotionScalarPredicate): PromotionRelatedPredicate => ({ kind: "parent", predicate })
const conjunction = (...children: PromotionRelatedPredicate[]): PromotionRelatedPredicate => ({ kind: "and", children })
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'"

/** Preserve native flattening, insertion order and Set membership. This private
 * profile accepts JSON scalar leaves; it never invokes user serializers. */
export function promotionContextAttributes(context: PromotionTypes.ComputeActionContext): Map<string, Set<ContextValue>> {
  const { items = [], shipping_methods: shippingMethods = [], ...rest } = context
  const attributes = new Map<string, Set<ContextValue>>()
  const append = (input: Parameters<typeof flattenObjectToKeyValuePairs>[0], prefix: string) => {
    const flattened: Record<string, unknown> = flattenObjectToKeyValuePairs(input)
    for (const [key, value] of Object.entries(flattened)) {
      const name = prefix + key, values = attributes.get(name) ?? new Set<ContextValue>()
      attributes.set(name, values)
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean")
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "Promotion context requires scalar JSON values")
        values.add(item)
      }
    }
  }
  append(items, "items.")
  append(shippingMethods, "shipping_methods.")
  append(rest, "")
  return attributes
}

/** The retained SQL text measures the native query-size guard and authenticates
 * native probes. It is data only: portable persistence receives the tree. */
export function buildPromotionPrefilterPlan(attributes: ReadonlyMap<string, ReadonlySet<ContextValue>>) {
  const conditions: PromotionRelatedPredicate[] = [], sqlConditions: string[] = []
  for (const [attribute, valueSet] of attributes) {
    const values = Array.from(valueSet), lexical = values.map(value => value.toString())
    const stringValues = lexical.map(quote).join(","), escapedAttribute = quote(attribute)
    const numeric = values.map(Number).filter(Number.isFinite)
    const rule = (operators: readonly string[]) => parent({ kind: "and", children: [member("attribute", [attribute]), member("operator", operators)] })
    if (stringValues.length) {
      conditions.push(conjunction(rule(["in", "eq"]), { kind: "notInChild", predicate: member("value", lexical) }))
      sqlConditions.push(`(pr.attribute = ${escapedAttribute} AND pr.operator IN ('in', 'eq') AND pr.id NOT IN (
        SELECT DISTINCT prv_inner.promotion_rule_id
        FROM promotion_rule_value prv_inner
        WHERE prv_inner.value IN (${stringValues})
      ))`)
    }
    if (numeric.length) {
      const minimum = Math.min(...numeric), maximum = Math.max(...numeric)
      for (const [operator, comparison, threshold, lexicalGuard] of [
        ["gt", "gte", maximum, false], ["gte", "gt", maximum, true],
        ["lt", "lte", minimum, false], ["lte", "lt", minimum, true],
      ] as const) {
        const cast: PromotionScalarPredicate = { kind: "postgresNumericCast", column: "value", operator: comparison, value: threshold }
        conditions.push(conjunction(rule([operator]), { kind: "child", predicate: lexicalGuard
          ? { kind: "and", children: [{ kind: "postgresText", column: "value", operator: "notIn", values: lexical }, cast] } : cast }))
        const symbol = comparison === "gte" ? ">=" : comparison === "gt" ? ">" : comparison === "lte" ? "<=" : "<"
        sqlConditions.push(`(pr.attribute = ${escapedAttribute} AND pr.operator = '${operator}' AND ${lexicalGuard ? `prv.value NOT IN (${stringValues}) AND ` : ""}CAST(prv.value AS DECIMAL) ${symbol} ${threshold})`)
      }
    }
  }
  const sqlCondition = sqlConditions.join(" OR ") || "FALSE"
  return { attributes: Array.from(attributes.keys()), sqlCondition,
    tooLarge: sqlCondition.length > 2147483648 * 0.9,
    predicate: conjunction(parent(member("attribute", Array.from(attributes.keys()))), { kind: "or", children: conditions }) }
}
