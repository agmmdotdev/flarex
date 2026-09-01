import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { HttpTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"

const updateTaxRegionsWorkflowId = "update-tax-regions"
const deleteTaxRegionsWorkflowId = "delete-tax-regions"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminTaxRegionParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRegionResponse>
) => {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const filters = { id: req.params.id }
  const [taxRegion] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_region",
      variables: { filters },
      fields: req.queryConfig.fields,
    })
  )

  res.status(200).json({ tax_region: taxRegion })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminUpdateTaxRegion,
    HttpTypes.AdminTaxRegionParams
  >,
  res: MedusaResponse<HttpTypes.AdminTaxRegionResponse>
) => {
  const { id } = req.params
  const query = req.scope.resolve<RemoteQueryFunction>(
    ContainerRegistrationKeys.QUERY
  )
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateTaxRegionsWorkflowId, {
    input: [
      {
        id,
        ...req.validatedBody,
      },
    ],
  })

  const {
    data: [tax_region],
  } = await query.graph(
    {
      entity: "tax_region",
      fields: req.queryConfig.fields,
      filters: { id },
    },
    { throwIfKeyNotFound: true }
  )

  return res.json({ tax_region })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminTaxRegionDeleteResponse>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteTaxRegionsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "tax_region",
    deleted: true,
  })
}
