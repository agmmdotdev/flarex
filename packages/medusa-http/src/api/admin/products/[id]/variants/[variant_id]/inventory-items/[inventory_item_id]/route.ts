import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { refetchVariant } from "../../../../../helpers"
import type { AdminUpdateVariantInventoryItemType } from "../../../../../validators"
import type { ProductVariantDTO, LinkDefinition } from "@medusajs/framework/types"

type InventoryLinkWorkflowEngine = {
  run(id: "create-product-variant-inventory-links" | "update-product-variant-inventory-links" | "dismiss-product-variant-inventory-links", options: { input: { product_id: string; links: LinkDefinition[] } }): Promise<{ result: unknown[] }>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminUpdateVariantInventoryItemType
  >,
  res: MedusaResponse<{ variant: ProductVariantDTO | null | undefined }>
) => {
  const variantId = req.params.variant_id
  const inventoryItemId = req.params.inventory_item_id

  await req.scope.resolve<InventoryLinkWorkflowEngine>(Modules.WORKFLOW_ENGINE).run("update-product-variant-inventory-links", {
    input: { product_id: req.params.id, links: [
      {
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
        data: { required_quantity: req.validatedBody.required_quantity },
      },
    ] },
  })

  const variant = await refetchVariant(
    variantId,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ variant })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: unknown; object: string; deleted: boolean; parent: ProductVariantDTO | null | undefined }>
) => {
  const variantId = req.params.variant_id
  const inventoryItemId = req.params.inventory_item_id

  const {
    result: [deleted],
  } = await req.scope.resolve<InventoryLinkWorkflowEngine>(Modules.WORKFLOW_ENGINE).run("dismiss-product-variant-inventory-links", {
    input: { product_id: req.params.id, links: [
      {
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
      },
    ] },
  })

  const parent = await refetchVariant(
    variantId,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({
    id: deleted,
    object: "variant-inventory-item-link",
    deleted: true,
    parent,
  })
}
