import type { Context, DAL, PromotionTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils/portable"
import { buildPromotionPrefilterPlan, promotionContextAttributes, type PromotionPrefilterPersistence, type PromotionScalarPredicate } from "./prefilter-plan"

const all: PromotionScalarPredicate = { kind: "and", children: [] }

/** Native Promotion owns candidate policy. The injected persistence seam has no
 * manager/SQL/settlement capability and returns only checked genuine cohorts. */
export async function portablePromotionRuleQueryFilter(
  context: PromotionTypes.ComputeActionContext,
  sharedContext: Context,
  persistence?: PromotionPrefilterPersistence
): Promise<DAL.FilterQuery<unknown> | null> {
  if (persistence === undefined)
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Promotion SQL prefilter is outside the checkout read profile")
  const attributes = promotionContextAttributes(context)
  if (attributes.size > 10) {
    const available = new Set((await persistence.rules({ kind: "isNull", column: "deleted_at" }, sharedContext)).map(rule => rule.attribute))
    for (const attribute of attributes.keys()) if (!available.has(attribute)) attributes.delete(attribute)
  }
  const plan = buildPromotionPrefilterPlan(attributes)
  if (plan.tooLarge) return null
  const roots = await persistence.promotions({ kind: "and", children: [
    { kind: "in", column: "is_automatic", values: [true] }, { kind: "isNull", column: "deleted_at" },
  ] }, sharedContext)
  if (!roots.length) return { id: { $in: [] } }

  // This explicit historical evaluation cohort replaces plan-dependent cast
  // suppression. Keep the complete lexical/cast Boolean program in PostgreSQL.
  const unsatisfied = new Set(attributes.size
    ? (await persistence.evaluateRules(plan.predicate, sharedContext)).map(rule => rule.id) : [])
  if (attributes.size) {
    for (const rule of await persistence.rules(all, sharedContext))
      if (!attributes.has(rule.attribute)) unsatisfied.add(rule.id)
  }
  const global = await persistence.globalRules(all, sharedContext)
  const target = await persistence.targetRules(all, sharedContext)
  const buy = await persistence.buyRules(all, sharedContext)
  const methods = await persistence.applicationMethods(all, sharedContext)
  const excluded = new Set<string>()
  for (const link of global)
    if (!attributes.size || unsatisfied.has(link.promotion_rule_id)) excluded.add(link.promotion_id)
  const methodPromotions = new Map(methods.map(method => [method.id, method.promotion_id]))
  for (const link of [...target, ...buy]) {
    if (attributes.size && !unsatisfied.has(link.promotion_rule_id)) continue
    const promotion = methodPromotions.get(link.application_method_id)
    if (promotion !== undefined) excluded.add(promotion)
  }
  return { id: { $in: roots.filter(root => !excluded.has(root.id)).map(root => root.id) } }
}

export { buildPromotionPrefilterPlan, promotionContextAttributes } from "./prefilter-plan"
export type { PromotionPrefilterPersistence, PromotionRelatedPredicate, PromotionScalarPredicate } from "./prefilter-plan"
