import { createWorkflow, transform, WorkflowData, WorkflowResponse } from "@medusajs/workflows-sdk"
import { removeApiKeyLinksStep } from "../steps/remove-api-key-links"
import { deleteApiKeysStep } from "../steps/delete-api-keys"

/**
 * The data to delete API keys.
 */
export type DeleteApiKeysWorkflowInput = {
  /**
   * The IDs of the API keys to delete.
   */
  ids: string[]
}

export const deleteApiKeysWorkflowId = "delete-api-keys"
/**
 * This workflow deletes one or more secret or publishable API keys. It's used by the
 * [Delete API Key Admin API Route](https://docs.medusajs.com/api/admin#api-keys_deleteapikeysid).
 *
 * You can use this workflow within your customizations or your own custom workflows, allowing you to
 * delete API keys within your custom flows.
 *
 * @example
 * const { result } = await deleteApiKeysWorkflow(container)
 * .run({
 *   input: {
 *     ids: ["apk_123"]
 *   }
 * })
 *
 * @summary
 *
 * Delete secret or publishable API keys.
 */
export const deleteApiKeysWorkflow = createWorkflow(
  deleteApiKeysWorkflowId,
  (input: WorkflowData<DeleteApiKeysWorkflowInput>) => {
    const deleted = deleteApiKeysStep(input.ids).config({ noCompensation: true })

    // Please note, the ids here should be publishable key IDs
    const ids = transform({ input, deleted }, ({ input }) => input.ids)
    removeApiKeyLinksStep(ids).config({ noCompensation: true })
    return new WorkflowResponse(void 0)
  }
)
