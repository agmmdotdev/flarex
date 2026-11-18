import type { Context, DAL, PromotionTypes } from "@medusajs/framework/types"
import { portablePromotionRuleQueryFilter, type PromotionPrefilterPersistence } from "./prefilter"

/** The native service retains its helper entry point. The optional finite
 * persistence seam supplies checked cohorts while native Promotion keeps
 * flattening, candidate exclusions, historical cast policy and final actions. */
export async function buildPromotionRuleQueryFilterFromContext(
  context: PromotionTypes.ComputeActionContext, sharedContext: Context,
  persistence?: PromotionPrefilterPersistence
): Promise<DAL.FilterQuery<unknown> | null> {
  return await portablePromotionRuleQueryFilter(context, sharedContext, persistence)
}
