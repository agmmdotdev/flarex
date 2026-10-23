import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * The details of archiving the orders.
 */
export type ArchiveOrdersStepInput = {
  /**
   * The IDs of the orders to archive.
   */
  orderIds: string[]
}

export const archiveOrdersStepId = "archive-orders"
/**
 * This step archives one or more orders.
 */
export const archiveOrdersStep = createStep(
  { name: archiveOrdersStepId, compensation: "transactionCovered" },
  async (data: ArchiveOrdersStepInput, { container }) => {
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)

    // Keep primitive preimages before archive mutates its returned Orders.
    const previousOrders = await service.listOrders(
      { id: data.orderIds },
      { select: ["id", "status"] }
    )
    const previousStatuses = previousOrders.map((order) => ({
      id: order.id,
      status: order.status,
    }))
    const archived = await service.archive(data.orderIds)
    return new StepResponse(archived, previousStatuses)
  },
  async (archived, { container }) => {
    if (!archived?.length) {
      return
    }

    const service = container.resolve<IOrderModuleService>(Modules.ORDER)

    await service.updateOrders(archived)
  }
)
