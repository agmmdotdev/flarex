import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { refetchVariant } from "../../../../helpers"
import type { AdminCreateVariantInventoryItemType } from "../../../../validators"
import type { ProductVariantDTO, LinkDefinition } from "@medusajs/framework/types"

type InventoryLinkWorkflowEngine = {
  run(id: "create-product-variant-inventory-links" | "update-product-variant-inventory-links" | "dismiss-product-variant-inventory-links", options: { input: { product_id: string; links: LinkDefinition[] } }): Promise<{ result: unknown[] }>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminCreateVariantInventoryItemType
  >,
  res: MedusaResponse<{ variant: ProductVariantDTO | null | undefined }>
) => {
  const variantId = req.params.variant_id

  await req.scope.resolve<InventoryLinkWorkflowEngine>(Modules.WORKFLOW_ENGINE).run("create-product-variant-inventory-links", {
    input: { product_id: req.params.id, links: [
      {
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.INVENTORY]: {
          inventory_item_id: req.validatedBody.inventory_item_id,
        },
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
