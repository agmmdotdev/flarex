import type {
  CancelOrderChangeDTO,
  IOrderModuleService,
  RestoreOrderChangeCancellationDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const cancelOrderChangeStepId = "cancel-order-change"
/** This step cancels an order change and retains its cancellation preimage. */
export const cancelOrderChangeStep = createStep(
  { name: cancelOrderChangeStepId, compensation: "transactionCovered" },
  async (data: CancelOrderChangeDTO, { container }) => {
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    const hasMetadata = Object.prototype.hasOwnProperty.call(data, "metadata")
    const previous = await service.retrieveOrderChange(data.id, {
      select: ["id", "status", "canceled_at", "canceled_by", ...(hasMetadata ? ["metadata"] : [])],
      relations: [],
    })
    const retained: RestoreOrderChangeCancellationDTO = {
      id: previous.id,
      status: previous.status,
      canceled_at: previous.canceled_at,
      canceled_by: previous.canceled_by,
    }
    if (hasMetadata) {
      retained.metadata = previous.metadata
    }
    const preimage = structuredClone(retained)
    await service.cancelOrderChange(data)
    return new StepResponse(void 0, preimage)
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) {
      return
    }
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    await service.restoreOrderChangeCancellation(structuredClone(rollbackData))
  }
)
