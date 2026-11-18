import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  type WorkflowDefinition,
} from "@medusajs/workflows-sdk"
import { deleteTaxRatesStep } from "../steps/delete-tax-rates"

/**
 * The data to delete tax rates.
 */
export type DeleteTaxRatesWorkflowInput = {
  /**
   * The IDs of the tax rates to delete.
   */
  ids: string[]
}

export const deleteTaxRatesWorkflowId = "delete-tax-rates"
/**
 * This workflow deletes one or more tax rates. It's used by the
 * [Delete Tax Rates Admin API Route](https://docs.medusajs.com/api/admin#tax-rates_deletetaxratesid).
 *
 * You can use this workflow within your own customizations or custom workflows, allowing you
 * to delete tax rates in your custom flows.
 *
 * @example
 * const { result } = await deleteTaxRatesWorkflow(container)
 * .run({
 *   input: {
 *     ids: ["txr_123"]
 *   }
 * })
 *
 * @summary
 *
 * Delete one or more tax rates.
 */
export const deleteTaxRatesWorkflow: WorkflowDefinition<
  DeleteTaxRatesWorkflowInput,
  WorkflowData<void>,
  readonly []
> = createWorkflow(
  deleteTaxRatesWorkflowId,
  (
    input: WorkflowData<DeleteTaxRatesWorkflowInput>
  ): WorkflowResponse<WorkflowData<void>> => {
    return new WorkflowResponse(deleteTaxRatesStep(input.ids))
  }
)
