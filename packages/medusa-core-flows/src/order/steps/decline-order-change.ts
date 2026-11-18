import type {
  DeclineOrderChangeDTO,
  IOrderModuleService,
  RestoreOrderChangeDeclineDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export const declineOrderChangeStepId = "decline-order-change"
/** This step declines an order change and retains its decline preimage. */
export const declineOrderChangeStep = createStep(
  { name: declineOrderChangeStepId, compensation: "transactionCovered" },
  async (data: DeclineOrderChangeDTO, { container }) => {
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    const hasMetadata = Object.prototype.hasOwnProperty.call(data, "metadata")
    const previous = await service.retrieveOrderChange(data.id, {
      select: ["id", "status", "declined_at", "declined_by", ...(hasMetadata ? ["metadata"] : [])],
      relations: [],
    })
    const retained: RestoreOrderChangeDeclineDTO = {
      id: previous.id,
      status: previous.status,
      declined_at: previous.declined_at,
      declined_by: previous.declined_by,
    }
    if (hasMetadata) {
      retained.metadata = previous.metadata
    }
    const preimage = structuredClone(retained)
    await service.declineOrderChange(data)
    return new StepResponse(void 0, preimage)
  },
  async (rollbackData, { container }) => {
    if (!rollbackData) {
      return
    }
    const service = container.resolve<IOrderModuleService>(Modules.ORDER)
    await service.restoreOrderChangeDecline(structuredClone(rollbackData))
  }
)
