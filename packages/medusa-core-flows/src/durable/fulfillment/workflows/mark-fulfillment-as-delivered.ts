import type { FulfillmentDTO } from "@medusajs/types/fulfillment/index"
import { MedusaError } from "@medusajs/framework/utils/portable"
import {
  StepResponse,
  WorkflowData,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
} from "@medusajs/workflows-sdk/durable"
import { useRemoteQueryStep } from "../../common/steps/use-remote-query.js"
import { updateFulfillmentWorkflow } from "./update-fulfillment.js"
import { acquireLockStep } from "../../locking/steps/acquire-lock.js"
import { releaseLockStep } from "../../locking/steps/release-lock.js"

export const validateFulfillmentDeliverabilityStepId =
  "validate-fulfillment-deliverability"
/**
 * This step validates that a fulfillment can be marked delivered.
 * If the fulfillment has already been canceled or delivered, the step will throw an error.
 *
 * :::note
 *
 * You can retrieve a fulfillment's details using [Query](https://docs.medusajs.com/learn/fundamentals/module-links/query),
 * or [useQueryGraphStep](https://docs.medusajs.com/resources/references/medusa-workflows/steps/useQueryGraphStep).
 *
 * :::
 *
 * @example
 * const data = validateFulfillmentDeliverabilityStep({
 *   id: "ful_123",
 *   // other fulfillment data...
 * })
 */
export const validateFulfillmentDeliverabilityStep = createStep(
  validateFulfillmentDeliverabilityStepId,
  async (fulfillment: FulfillmentDTO) => {
    if (fulfillment.canceled_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Cannot deliver an already canceled fulfillment"
      )
    }

    if (fulfillment.delivered_at) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Fulfillment has already been marked delivered"
      )
    }

    return new StepResponse(void 0)
  }
)

/**
 * The data to mark a fulfillment as delivered.
 */
export type MarkFulfillmentAsDeliveredInput = {
  /**
   * The fulfillment's ID.
   */
  id: string
}

export const markFulfillmentAsDeliveredWorkflowId =
  "mark-fulfillment-as-delivered-workflow"
/**
 * This workflow marks a fulfillment as delivered. It's used by the {@link markOrderFulfillmentAsDeliveredWorkflow}.
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you
 * to mark a fulfillment as delivered in your custom flows.
 *
 * @example
 * const { result } = await markFulfillmentAsDeliveredWorkflow(container)
 * .run({
 *   input: {
 *     id: "ful_123",
 *   }
 * })
 *
 * @summary
 *
 * Mark a fulfillment as delivered.
 */
export const markFulfillmentAsDeliveredWorkflow = createWorkflow(
  { name: markFulfillmentAsDeliveredWorkflowId, store: true, storeExecution: true },
  ({ id }: WorkflowData<MarkFulfillmentAsDeliveredInput>) => {
    const ownerId = transform({ id }, (_input, context) => {
      const transactionId = context.context?.transactionId
      if (typeof transactionId !== "string" || transactionId.length === 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Fulfillment delivery lock requires the native transaction context"
        )
      }
      return `fulfillment-delivery:${transactionId}`
    })

    acquireLockStep({
      key: id,
      ownerId,
      timeout: 2,
      ttl: 10,
    })

    const fulfillment = useRemoteQueryStep({
      entry_point: "fulfillment",
      fields: ["id", "delivered_at", "canceled_at"],
      variables: { id },
      throw_if_key_not_found: true,
      list: false,
    })

    validateFulfillmentDeliverabilityStep(fulfillment)

    const updateInput = transform({ id }, ({ id }) => ({
      id,
      delivered_at: new Date(),
    }))

    const updatedFulfillment = updateFulfillmentWorkflow.runAsStep({
      input: updateInput,
    })

    releaseLockStep({
      key: id,
      ownerId,
    })
    return new WorkflowResponse(updatedFulfillment)
  }
)
