import type { BatchWorkflowInput, BatchWorkflowOutput } from "@medusajs/types"
import type {
  CreateShippingOptionRuleDTO,
  ShippingOptionRuleDTO,
  UpdateShippingOptionRuleDTO,
} from "@medusajs/types/fulfillment/index"
import {
  createWorkflow,
  parallelize,
  transform,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { createShippingOptionRulesStep } from "../steps/create-shipping-option-rules"
import { deleteShippingOptionRulesStep } from "../steps/delete-shipping-option-rules"
import { updateShippingOptionRulesStep } from "../steps/update-shipping-option-rules"

/**
 * The data to manage the shipping option rules in bulk.
 *
 * @property create - The shipping option rules to create.
 * @property update - The shipping option rules to update.
 * @property delete - The IDs of the shipping option rules to delete.
 */
export interface BatchShippingOptionRulesInput extends BatchWorkflowInput<
  CreateShippingOptionRuleDTO,
  UpdateShippingOptionRuleDTO
> {}

/**
 * The result of managing the shipping option rules in bulk.
 *
 * @property created - The shipping option rules that were created.
 * @property updated - The shipping option rules that were updated.
 * @property deleted - The IDs of the shipping option rules that were deleted.
 */
export interface BatchShippingOptionRulesOutput extends BatchWorkflowOutput<ShippingOptionRuleDTO> {}

// The SDK-facing result retains native empty-branch absence without exposing
// private SDK brands or changing the exported native workflow DTOs.
type BatchShippingOptionRulesComposerResult = {
  created: BatchShippingOptionRulesOutput["created"]
  updated: BatchShippingOptionRulesOutput["updated"] | undefined
  deleted: BatchShippingOptionRulesOutput["deleted"] | undefined
}

export const batchShippingOptionRulesWorkflowId = "batch-shipping-option-rules"
/**
 * This workflow manages shipping option rules allowing you to create, update, or delete them. It's used by the
 * [Manage the Rules of Shipping Option Admin API Route](https://docs.medusajs.com/api/admin#shipping-options_postshippingoptionsidrulesbatch).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you to
 * manage shipping option rules within your custom flows.
 *
 * @example
 * const { result } = await batchShippingOptionRulesWorkflow(container)
 * .run({
 *   input: {
 *     create: [
 *       {
 *         attribute: "customer_group",
 *         value: "cusgrp_123",
 *         operator: "eq",
 *         shipping_option_id: "so_123"
 *       }
 *     ],
 *     update: [
 *       {
 *         id: "sor_123",
 *         operator: "in"
 *       }
 *     ],
 *     delete: ["sor_321"]
 *   }
 * })
 *
 * @summary
 *
 * Manage shipping option rules.
 */
export const batchShippingOptionRulesWorkflow = createWorkflow(
  batchShippingOptionRulesWorkflowId,
  (
    input: WorkflowData<BatchShippingOptionRulesInput>
  ): WorkflowResponse<BatchShippingOptionRulesComposerResult> => {
    const actionInputs = transform({ input }, (data) => {
      const { create, update, delete: del } = data.input
      return {
        createInput: { data: create ?? [] },
        updateInput: { data: update ?? [] },
        deleteInput: { ids: del ?? [] },
      }
    })

    const [created, updated, deleted] = parallelize(
      createShippingOptionRulesStep(actionInputs.createInput),
      updateShippingOptionRulesStep(actionInputs.updateInput),
      deleteShippingOptionRulesStep(actionInputs.deleteInput)
    )

    return new WorkflowResponse(
      transform({ created, deleted, updated }, (data) => data)
    )
  }
)
