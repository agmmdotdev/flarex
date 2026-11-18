import type { LinkPreimageOperationRequest, LinkOperationPair, RemoteQueryFunction } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk/link"
import { Result, Schema } from "effect"
import { ContainerRegistrationKeys, PromotionActions } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"
import { queryWorkflowGraph, type WorkflowGraphResource } from "../../common/steps/use-query-graph"
import { applyCartPromotionLinkOperation } from "../utils/promotion-link-operation"

/** The details of the promotion codes to apply on a cart. */
export interface UpdateCartPromotionStepInput {
  id: string
  promo_codes?: string[]
  action?: PromotionActions.ADD | PromotionActions.REMOVE | PromotionActions.REPLACE
}

// These are the two genuine selected Query projections, not full module DTOs.
const decodeLinks = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({ cart_id: Schema.String, promotion_id: Schema.String })))
const decodePromotions = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({ id: Schema.String, code: Schema.String })))

export const updateCartPromotionsStepId = "update-cart-promotions"
/** Native selection and dismiss-before-create ordering; the approved inverse
 * retains the exact native Link preimage instead of synthetic created IDs. */
export const updateCartPromotionsStep = createStep(
  { name: updateCartPromotionsStepId, compensation: "transactionCovered" },
  async (data: UpdateCartPromotionStepInput, { container, idempotencyKey }) => {
    const { promo_codes = [], id, action = PromotionActions.ADD } = data
    const remoteLink = container.resolve<Pick<Link, "applyPreimageOperation">>(ContainerRegistrationKeys.LINK)
    const remoteQuery = container.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)
    const existingCartPromotionLinks = Result.getOrThrow(decodeLinks(await remoteQuery({
      entryPoint: "cart_promotion", fields: ["cart_id", "promotion_id"], variables: { cart_id: [id] },
    })))
    const promotionLinkMap = new Map(existingCartPromotionLinks.map(link => [link.promotion_id, link]))
    const linksToCreate: LinkOperationPair[] = []
    const linksToDismiss: LinkOperationPair[] = []
    if (promo_codes?.length) {
      const query = container.resolve<WorkflowGraphResource>(ContainerRegistrationKeys.QUERY)
      const result = await queryWorkflowGraph({ entity: "promotion", fields: ["id", "code"],
        filters: { code: promo_codes }, options: { cache: { enable: true } } }, query)
      const promotions = Result.getOrThrow(decodePromotions(result.data))
      for (const promotion of promotions) {
        const pair = { primary: id, foreign: promotion.id }
        if ([PromotionActions.ADD, PromotionActions.REPLACE].includes(action)) linksToCreate.push(pair)
        if (action === PromotionActions.REMOVE && promotionLinkMap.has(promotion.id)) linksToDismiss.push(pair)
      }
    }
    if (action === PromotionActions.REPLACE) {
      for (const link of existingCartPromotionLinks) linksToDismiss.push({ primary: link.cart_id, foreign: link.promotion_id })
    }
    const mutations: LinkPreimageOperationRequest["mutations"][number][] = []
    if (linksToDismiss.length) mutations.push({ action: "dismiss", pairs: linksToDismiss })
    if (linksToCreate.length) mutations.push({ action: "create", pairs: linksToCreate })
    if (!mutations.length) return new StepResponse(null)
    return await applyCartPromotionLinkOperation(remoteLink, mutations, idempotencyKey)
  },
  async (handle, { container }) => {
    if (handle === undefined || handle === null) return
    const remoteLink = container.resolve<Pick<Link, "compensatePreimageOperation">>(ContainerRegistrationKeys.LINK)
    await remoteLink.compensatePreimageOperation(handle)
  }
)
