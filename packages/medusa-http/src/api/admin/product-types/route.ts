import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import { refetchProductType } from "./helpers"
import type { ProductTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import type { AdminCreateProductTypeType } from "./validators"

const createProductTypesWorkflowId = "create-product-types"

type CreateProductTypesWorkflowEngine = {
  run(id: typeof createProductTypesWorkflowId, options: { input: { product_types: AdminCreateProductTypeType[] } }): Promise<{ result: { id: string }[] }>
}

export const GET = async (
  req: AuthenticatedMedusaRequest<unknown>,
  res: MedusaResponse<{ product_types: ProductTypes.ProductTypeDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "product_type",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: product_types, metadata } = await remoteQuery(queryObject)

  res.json({
    product_types: product_types,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminCreateProductTypeType,
    Record<string, unknown>
  >,
  res: MedusaResponse<{ product_type: ProductTypes.ProductTypeDTO | undefined }>
) => {
  const input = [req.validatedBody]

  const workflowEngine = req.scope.resolve<CreateProductTypesWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(createProductTypesWorkflowId, {
    input: { product_types: input },
  })

  const productType = await refetchProductType(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ product_type: productType })
}
