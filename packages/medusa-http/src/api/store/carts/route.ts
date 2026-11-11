import {
  AdditionalData,
  CreateCartWorkflowInputDTO,
} from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCart } from "./helpers"
import type { StoreCreateCartType } from "./validators"

const createCartWorkflowId = "create-cart"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    StoreCreateCartType & AdditionalData
  >,
  res: MedusaResponse
) => {
  const workflowInput = {
    ...req.validatedBody,
    customer_id: req.auth_context?.actor_id,
  }

  const workflowEngine = req.scope.resolve<{ run(id: string, options: { input: CreateCartWorkflowInputDTO }): Promise<{ result: { id: string } }> }>(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(createCartWorkflowId, {
    input: workflowInput as CreateCartWorkflowInputDTO,
  })

  const cart = await refetchCart(result.id, req.scope, req.queryConfig.fields)

  res.status(200).json({ cart })
}
