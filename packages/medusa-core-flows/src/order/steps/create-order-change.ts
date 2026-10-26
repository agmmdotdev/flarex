import {
  CreateOrderChangeDTO,
  IOrderModuleService,
  OrderChangeDTO,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

type CreateOrderChangeStepInput = Omit<CreateOrderChangeDTO, "created_by"> & {
  created_by?: CreateOrderChangeDTO["created_by"] | undefined
}
type CreateOrderChangePorts = Pick<IOrderModuleService, "deleteOrderChanges"> & {
  createOrderChange(data: CreateOrderChangeStepInput): Promise<OrderChangeDTO>
}

export const createOrderChangeStepId = "create-order-change"
/**
 * This step creates an order change.
 */
export const createOrderChangeStep = createStep(
  { name: createOrderChangeStepId, compensation: "transactionCovered" },
  async (data: CreateOrderChangeStepInput, { container }) => {
    const service = container.resolve<CreateOrderChangePorts>(Modules.ORDER)

    const created = await service.createOrderChange(data)

    return new StepResponse(created, created.id)
  },
  async (id, { container }) => {
    if (!id) {
      return
    }

    const service = container.resolve<CreateOrderChangePorts>(Modules.ORDER)

    await service.deleteOrderChanges(id)
  }
)
