import type { CreateLocationFulfillmentSetWorkflowInputDTO } from "@medusajs/types/workflows/stock-locations/mutations"
import {
  WorkflowData,
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { createFulfillmentSets } from "../../fulfillment/steps/create-fulfillment-set"
import { associateFulfillmentSetsWithLocationStep } from "../steps/associate-locations-with-fulfillment-sets"

export const createLocationFulfillmentSetWorkflowId =
  "create-location-fulfillment-set"
/**
 * This workflow adds a fulfillment set to a stock location. It's used by the
 * [Add Fulfillment Set to Stock Location Admin API Route](https://docs.medusajs.com/api/admin#stock-locations_poststocklocationsidfulfillmentsets).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you
 * to add fulfillment sets to a stock location in your custom flows.
 *
 * @example
 * const { result } = await createLocationFulfillmentSetWorkflow(container)
 * .run({
 *   input: {
 *     location_id: "sloc_123",
 *     fulfillment_set_data: {
 *       name: "Shipping",
 *       type: "shipping",
 *     }
 *   }
 * })
 *
 * @summary
 *
 * Add fulfillment set to a stock location.
 */
export const createLocationFulfillmentSetWorkflow = createWorkflow(
  createLocationFulfillmentSetWorkflowId,
  (input: WorkflowData<CreateLocationFulfillmentSetWorkflowInputDTO>) => {
    const fulfillmentSet = createFulfillmentSets([
      {
        name: input.fulfillment_set_data.name,
        type: input.fulfillment_set_data.type,
      },
    ])

    const data = transform({ input, fulfillmentSet }, (data) => [
      {
        location_id: data.input.location_id,
        // @ts-expect-error Native creation assumes a first Set; preserve its missing-first property-read failure.
        fulfillment_set_ids: [data.fulfillmentSet[0].id],
      },
    ])

    associateFulfillmentSetsWithLocationStep({
      input: data,
    })
    return new WorkflowResponse(void 0)
  }
)
