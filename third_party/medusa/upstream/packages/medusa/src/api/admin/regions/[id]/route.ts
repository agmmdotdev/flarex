import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchRegion } from "../helpers"
import { HttpTypes } from "@medusajs/framework/types"

const updateRegionsWorkflowId = "update-regions"
const deleteRegionsWorkflowId = "delete-regions"

export const GET = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminRegionResponse>
) => {
  const region = await refetchRegion(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  if (!region) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Region with id: ${req.params.id} not found`
    )
  }

  res.status(200).json({ region })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminUpdateRegion,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminRegionResponse>
) => {
  const existingRegion = await refetchRegion(req.params.id, req.scope, ["id"])
  if (!existingRegion) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Region with id "${req.params.id}" not found`
    )
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(updateRegionsWorkflowId, {
    input: {
      selector: { id: req.params.id },
      update: req.validatedBody,
    },
  })

  const region = await refetchRegion(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ region })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminRegionDeleteResponse>
) => {
  const id = req.params.id

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(deleteRegionsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "region",
    deleted: true,
  })
}
