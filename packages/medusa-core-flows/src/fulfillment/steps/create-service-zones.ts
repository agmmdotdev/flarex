import {
  CreateServiceZoneDTO,
  IFulfillmentModuleService,
} from "@medusajs/types/fulfillment/index"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

/**
 * The service zones to create.
 */
export type CreateServiceZonesStepInput = CreateServiceZoneDTO[]

export const createServiceZonesStepId = "create-service-zones"
/**
 * This step creates one or more service zones.
 */
export const createServiceZonesStep = createStep(
  { name: createServiceZonesStepId, compensation: "transactionCovered" },
  async (input: CreateServiceZonesStepInput, { container }) => {
    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const createdServiceZones = await service.createServiceZones(input)

    return new StepResponse(
      createdServiceZones,
      createdServiceZones.map((createdZone) => createdZone.id)
    )
  },
  async (createdServiceZones, { container }) => {
    if (!createdServiceZones?.length) {
      return
    }

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    await service.deleteServiceZones(createdServiceZones)
  }
)
