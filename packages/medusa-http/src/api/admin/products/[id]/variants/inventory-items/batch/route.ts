import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  type AuthenticatedMedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { buildBatchVariantInventoryData } from "../../../../helpers"
import type { AdminBatchVariantInventoryItemsType } from "../../../../validators"
import type { LinkDefinition } from "@medusajs/framework/types"

type InventoryLinkWorkflowEngine = {
  run(id: "batch-product-variant-inventory-links", options: { input: { product_id: string; create: LinkDefinition[]; update: LinkDefinition[]; delete: LinkDefinition[] } }): Promise<{ result: { created: unknown; updated: unknown; deleted: unknown } }>
}

export const POST = async (
  req: AuthenticatedMedusaRequest<AdminBatchVariantInventoryItemsType>,
  res: MedusaResponse<{ created: unknown; updated: unknown; deleted: unknown }>
) => {
  const { create = [], update = [], delete: toDelete = [] } = req.validatedBody

  const { result } = await req.scope.resolve<InventoryLinkWorkflowEngine>(Modules.WORKFLOW_ENGINE).run("batch-product-variant-inventory-links", {
    input: {
      product_id: req.params.id,
      create: buildBatchVariantInventoryData(create),
      update: buildBatchVariantInventoryData(update),
      delete: buildBatchVariantInventoryData(toDelete),
    },
  })

  res.status(200).json({
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
  })
}
