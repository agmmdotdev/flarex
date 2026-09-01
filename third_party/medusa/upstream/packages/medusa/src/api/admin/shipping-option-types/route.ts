import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { refetchShippingOptionType } from "./helpers"
import { HttpTypes } from "@medusajs/framework/types"

const createShippingOptionTypesWorkflowId = "create-shipping-option-types"

/**
 * @since 2.10.0
 */
export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminShippingOptionTypeListParams>,
  res: MedusaResponse<HttpTypes.AdminShippingOptionTypeListResponse>
) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: shippingOptionTypes, metadata } = await query.graph({
    entity: "shipping_option_type",
    fields: req.queryConfig.fields,
    filters: req.filterableFields,
    pagination: req.queryConfig.pagination,
  })

  res.json({
    shipping_option_types: shippingOptionTypes,
    count: metadata!.count,
    offset: metadata!.skip,
    limit: metadata!.take,
  })
}

/**
 * @since 2.10.0
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminCreateShippingOptionType,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminShippingOptionTypeResponse>
) => {
  const input = [req.validatedBody]
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { result } = await workflowEngine.run(
    createShippingOptionTypesWorkflowId,
    {
      input: { shipping_option_types: input },
    }
  )

  const shippingOptionType = await refetchShippingOptionType(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ shipping_option_type: shippingOptionType })
}
