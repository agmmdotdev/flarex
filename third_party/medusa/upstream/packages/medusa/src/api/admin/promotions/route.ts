import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchPromotion } from "./helpers"
import { AdditionalData, HttpTypes } from "@medusajs/framework/types"

const createPromotionsWorkflowId = "create-promotions"

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminGetPromotionsParams>,
  res: MedusaResponse<HttpTypes.AdminPromotionListResponse>
) => {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)

  const queryObject = remoteQueryObjectFromString({
    entryPoint: "promotion",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: promotions, metadata } = await remoteQuery(queryObject)

  res.json({
    promotions,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminCreatePromotion & AdditionalData,
    HttpTypes.AdminGetPromotionParams
  >,
  res: MedusaResponse<HttpTypes.AdminPromotionResponse>
) => {
  const { additional_data, ...rest } = req.validatedBody
  const promotionsData: HttpTypes.AdminCreatePromotion[] = [rest]

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(createPromotionsWorkflowId, {
    input: { promotionsData, additional_data },
  })

  const promotion = await refetchPromotion(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ promotion })
}
