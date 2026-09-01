import { HttpTypes } from "@medusajs/framework/types"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
  refetchEntity,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

const updatePricePreferencesWorkflowId = "update-price-preferences"
const deletePricePreferencesWorkflowId = "delete-price-preferences"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminPricePreferenceParams>,
  res: MedusaResponse<HttpTypes.AdminPricePreferenceResponse>
) => {
  const price_preference = await refetchEntity({
    entity: "price_preference",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ price_preference })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminUpdatePricePreference,
    HttpTypes.AdminPricePreferenceParams
  >,
  res: MedusaResponse<HttpTypes.AdminPricePreferenceResponse>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updatePricePreferencesWorkflowId, {
    input: { selector: { id: [id] }, update: req.body },
  })

  const price_preference = await refetchEntity({
    entity: "price_preference",
    idOrFilter: id,
    scope: req.scope,
    fields: req.queryConfig.fields,
  })

  res.status(200).json({ price_preference })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminPricePreferenceDeleteResponse>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deletePricePreferencesWorkflowId, {
    input: [id],
  })

  res.status(200).json({
    id,
    object: "price_preference",
    deleted: true,
  })
}
