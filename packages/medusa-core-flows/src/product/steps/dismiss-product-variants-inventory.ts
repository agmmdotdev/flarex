import { createStep, StepResponse, WorkflowDefinitionError } from "@medusajs/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable"
import type { Link } from "@medusajs/modules-sdk/link"
import { LinkDefinition } from "@medusajs/types"
import { Result, Schema } from "effect"
import { queryWorkflowGraph, type WorkflowGraphResource } from "../../common/steps/use-query-graph"
const decodeLinks = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({ inventory_item_id: Schema.String, variant_id: Schema.String }))
  .check(Schema.isMaxLength(8), Schema.makeFilter(rows => {
    const counts = new Map<string, number>()
    for (const row of rows) { const count = (counts.get(row.variant_id) ?? 0) + 1; if (count > 2) return false; counts.set(row.variant_id, count) }
    return true
  })), { onExcessProperty: "error" })
type InventoryLink = Pick<Link, "dismiss" | "create">

export const dismissProductVariantsInventoryStepId =
  "dismiss-product-variants-inventory"

export type DismissProductVariantsInventoryStepInput = {
  variantIds: string[]
}

async function dismissVariantsInventory(
  variantIds: string[],
  query: WorkflowGraphResource,
  link: InventoryLink
): Promise<Record<string, string[]>> {
  const dismissedVariantInventoryItems: Record<string, string[]> = {}
  if (!variantIds.length) {
    return dismissedVariantInventoryItems
  }

  const result = await queryWorkflowGraph({
    entity: "product_variant_inventory_item",
    fields: ["inventory_item_id", "variant_id"],
    filters: {
      variant_id: variantIds,
    },
  }, query)
  const variantInventoryItems = Result.getOrThrow(decodeLinks(result.data).pipe(Result.mapError(() =>
    new WorkflowDefinitionError({ reason: "unsupportedProfile", detail: "Variant Inventory links exceed the admitted graph profile" }))))

  const variantInventoryItemsMap = new Map<string, string[]>()
  for (const item of variantInventoryItems) {
    variantInventoryItemsMap.set(item.variant_id, [
      ...(variantInventoryItemsMap.get(item.variant_id) ?? []),
      item.inventory_item_id,
    ])
  }

  const dismissLinks: LinkDefinition[] = []
  for (const variantId of variantIds) {
    if (!variantId) {
      continue
    }

    dismissedVariantInventoryItems[variantId] =
      variantInventoryItemsMap.get(variantId) ?? []

    for (const inventoryItemId of variantInventoryItemsMap.get(variantId) ??
      []) {
      dismissLinks.push({
        [Modules.PRODUCT]: { variant_id: variantId },
        [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
      })
    }
  }

  await link.dismiss(dismissLinks)

  return dismissedVariantInventoryItems
}

export const dismissProductVariantsInventoryStep = createStep(
  { name: dismissProductVariantsInventoryStepId, compensation: "transactionCovered" },
  async (data: DismissProductVariantsInventoryStepInput, { container }) => {
    const query = container.resolve<WorkflowGraphResource>(ContainerRegistrationKeys.QUERY)
    const link = container.resolve<InventoryLink>(ContainerRegistrationKeys.LINK)
    const variantIds = data.variantIds || []

    if (!variantIds.length) {
      return new StepResponse(void 0)
    }

    const dismissedVariantInventoryItems = await dismissVariantsInventory(
      variantIds,
      query,
      link
    )
    return new StepResponse(void 0, dismissedVariantInventoryItems)
  },
  async (dismissedVariantInventoryItems, { container }) => {
    if (!dismissedVariantInventoryItems) {
      return
    }

    const linksToCreate: LinkDefinition[] = []
    for (const [variantId, inventoryItemIds] of Object.entries(
      dismissedVariantInventoryItems
    )) {
      for (const inventoryItemId of inventoryItemIds) {
        linksToCreate.push({
          [Modules.PRODUCT]: { variant_id: variantId },
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
        })
      }
    }

    const link = container.resolve<InventoryLink>(ContainerRegistrationKeys.LINK)
    await link.create(linksToCreate)
  }
)
