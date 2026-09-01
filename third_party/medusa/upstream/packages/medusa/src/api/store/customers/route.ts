import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { HttpTypes } from "@medusajs/framework/types"
import { refetchCustomer } from "./helpers"

const createCustomerAccountWorkflowId = "create-customer-account"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.StoreCreateCustomer,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.StoreCustomerResponse>
) => {
  // If `actor_id` is present, the request carries authentication for an existing customer
  if (req.auth_context.actor_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Request already authenticated as a customer."
    )
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const customerData = req.validatedBody

  const { result } = await workflowEngine.run(createCustomerAccountWorkflowId, {
    input: { customerData, authIdentityId: req.auth_context.auth_identity_id },
  })

  const customer = await refetchCustomer(
    result.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ customer })
}
