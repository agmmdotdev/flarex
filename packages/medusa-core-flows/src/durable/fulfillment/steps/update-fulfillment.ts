import {
  FulfillmentWorkflow,
  IFulfillmentModuleService,
} from "@medusajs/framework/types"
import {
  Modules,
  getSelectsAndRelationsFromObjectArray,
} from "@medusajs/framework/utils/portable"
import { StepResponse, createStep } from "@medusajs/workflows-sdk/durable"

export const updateFulfillmentStepId = "update-fulfillment"
/**
 * This step updates a fulfillment.
 *
 * @example
 * const data = updateFulfillmentStep({
 *   id: "ful_123",
 *   delivered_at: new Date(),
 * })
 */
export const updateFulfillmentStep = createStep(
  updateFulfillmentStepId,
  async (
    input: FulfillmentWorkflow.UpdateFulfillmentWorkflowInput,
    { container }
  ) => {
    const { id, ...data } = input

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )

    const { selects, relations } = getSelectsAndRelationsFromObjectArray([data], {
      objectFields: ["data", "metadata"],
    })
    if (Object.prototype.hasOwnProperty.call(data, "labels")) {
      const scalarSelects = selects.filter(
        (field) => field !== "labels" && !field.startsWith("labels.")
      )
      selects.splice(0, selects.length, ...scalarSelects, "labels.*")
      if (!relations.includes("labels")) {
        relations.push("labels")
      }
    }
    const fulfillment = await service.retrieveFulfillment(id, {
      select: selects,
      relations,
    })

    const updated = await service.updateFulfillment(id, data)

    return new StepResponse(updated, fulfillment)
  },
  async (fulfillment, { container }) => {
    if (!fulfillment) {
      return
    }

    const service = container.resolve<IFulfillmentModuleService>(
      Modules.FULFILLMENT
    )
    const { id, ...data } = fulfillment

    // TODO: this does not revert the relationships that are created in invoke step
    // There should be a consistent way to handle across workflows
    await service.updateFulfillment(id, data)
  }
)
