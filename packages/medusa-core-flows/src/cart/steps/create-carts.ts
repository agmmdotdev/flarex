import type { CreateCartDTO } from "@medusajs/types/cart/mutations"
import type { CartCreationHandle, CartCreationResult, ICartCreationOwnershipService } from "@medusajs/types/cart/creation"
import { Modules } from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/** The details of the carts to create. */
export type CreateCartsStepInput = CreateCartDTO[]

export const createCartsStepId = "create-carts"
/** Native creation returns its original Cart DTOs. The approved ownership
 * capability retains the exact Cart/Address generation for the inverse. */
export const createCartsStep = createStep<CreateCartsStepInput, CartCreationResult["carts"], CartCreationHandle | null>(
  { name: createCartsStepId, compensation: "transactionCovered" },
  async (data, { container }) => {
    const service = container.resolve<ICartCreationOwnershipService>(Modules.CART)
    const created = await service.createCartsWithOwnership(data)
    return new StepResponse(created.carts, created.receipt ?? null)
  },
  async (receipt, { container }) => {
    if (receipt == null) return
    const service = container.resolve<ICartCreationOwnershipService>(Modules.CART)
    await service.compensateCartsCreation(receipt)
  }
)
