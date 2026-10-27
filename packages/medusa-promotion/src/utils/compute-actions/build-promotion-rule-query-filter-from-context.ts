import type { Context, DAL, PromotionTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils/portable"

/** The native SQL prefilter requires a MikroORM manager. This bounded read
 * profile exposes no promotion computation or database-manager capability. */
export async function buildPromotionRuleQueryFilterFromContext(
  _context: PromotionTypes.ComputeActionContext, _sharedContext: Context
): Promise<DAL.FilterQuery<unknown> | null> {
  throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Promotion SQL prefilter is outside the checkout read profile")
}
