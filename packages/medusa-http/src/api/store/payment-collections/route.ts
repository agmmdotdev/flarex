import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StoreCreatePaymentCollectionType, StoreGetPaymentCollectionParamsType } from "./validators"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

const createPaymentCollectionForCartWorkflowId = "create-payment-collection-for-cart"

export const POST = async (
  req: AuthenticatedMedusaRequest<StoreCreatePaymentCollectionType, StoreGetPaymentCollectionParamsType> & { body: StoreCreatePaymentCollectionType },
  res: MedusaResponse<unknown>
) => {
  const remoteQuery = req.scope.resolve<(query: unknown) => Promise<{ payment_collection?: unknown }[]>>(ContainerRegistrationKeys.REMOTE_QUERY)
  const { cart_id } = req.body

  // We can potentially refactor the workflow to behave more like an upsert and return an existing collection if there is one.
  const [cartCollectionRelation] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "cart_payment_collection",
      variables: { filters: { cart_id } },
      fields: req.queryConfig.fields.map((f) => `payment_collection.${f}`),
    })
  )
  let paymentCollection = cartCollectionRelation?.payment_collection

  if (!paymentCollection) {
    const we = req.scope.resolve<{ run(id: string, options: { input: unknown }): Promise<unknown> }>(Modules.WORKFLOW_ENGINE)
    await we.run(createPaymentCollectionForCartWorkflowId, {
      input: req.body,
    })

    const [cartCollectionRelation] = await remoteQuery(
      remoteQueryObjectFromString({
        entryPoint: "cart_payment_collection",
        variables: { filters: { cart_id } },
        fields: req.queryConfig.fields.map((f) => `payment_collection.${f}`),
      })
    )
    paymentCollection = cartCollectionRelation?.payment_collection
  }

  res.status(200).json({ payment_collection: paymentCollection })
}
