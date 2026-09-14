import {
  CreateShippingProfileDTO,
  IFulfillmentModuleService,
} from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The shipping profiles to create.
 */
export type CreateShippingProfilesStepInput = CreateShippingProfileDTO[]

export const createShippingProfilesStepId = "create-shipping-profiles"
/**
 * This step creates one or more shipping profiles.
 */
export const createShippingProfilesStep = createStep(
  { name: createShippingProfilesStepId, compensation: "transactionCovered" },
  async (input: CreateShippingProfilesStepInput, { container }) => {
    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const createdShippingProfiles = await service.createShippingProfiles(input)

    return new StepResponse(
      createdShippingProfiles,
      createdShippingProfiles.map((created) => created.id)
    )
  },
  async (createdShippingProfiles, { container }) => {
    if (!createdShippingProfiles?.length) {
      return
    }

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await service.deleteShippingProfiles(createdShippingProfiles)
  }
)
