import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StoreCreatePaymentSessionType, StoreGetPaymentCollectionParamsType } from "../../validators"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchPaymentCollection } from "../../helpers"

const createPaymentSessionsWorkflowId = "create-payment-sessions"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreCreatePaymentSessionType, StoreGetPaymentCollectionParamsType> & { body: StoreCreatePaymentSessionType },
  res: MedusaResponse<unknown>
) => {
  const collectionId = req.params.id
  const { provider_id, data } = req.body

  const workflowInput = {
    payment_collection_id: collectionId,
    provider_id: provider_id,
    customer_id: req.auth_context?.actor_id,
    data,
  }

  const workflowEngine = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(createPaymentSessionsWorkflowId, {
    input: workflowInput,
  })

  const paymentCollection = await refetchPaymentCollection(
    collectionId,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({
    payment_collection: paymentCollection,
  })
}
