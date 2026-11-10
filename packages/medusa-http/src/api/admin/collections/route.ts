import type { z } from "@medusajs/framework/zod"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { ProductTypes, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string"
import { refetchCollection } from "./helpers"
import type { AdminCreateCollection } from "./validators"

const createCollectionsWorkflowId = "create-collections"

export const GET = async (
  req: AuthenticatedMedusaRequest<unknown>,
  res: MedusaResponse<{ collections: ProductTypes.ProductCollectionDTO[]; count?: number; offset?: number; limit?: number }>
) => {
  const remoteQuery = req.scope.resolve<RemoteQueryFunction>(ContainerRegistrationKeys.REMOTE_QUERY)

  const query = remoteQueryObjectFromString({
    entryPoint: "product_collection",
    variables: {
      filters: req.filterableFields,
      ...req.queryConfig.pagination,
    },
    fields: req.queryConfig.fields,
  })

  const { rows: collections, metadata } = await remoteQuery(query)

  res.json({
    collections,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminCreateCollectionBody,
    Record<string, unknown>
  >,
  res: MedusaResponse<CollectionResponse>
) => {
  const { additional_data, ...rest } = req.validatedBody

  const workflowEngine = req.scope.resolve<CollectionWorkflowEngine>(Modules.WORKFLOW_ENGINE)
  const { result } = await workflowEngine.run(createCollectionsWorkflowId, {
    input: { collections: [rest], additional_data },
  })

  const collection = await refetchCollection(
    result[0].id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ collection })
}

type CollectionResponse = { collection: ProductTypes.ProductCollectionDTO | undefined }

type AdminCreateCollectionBody = z.infer<ReturnType<typeof AdminCreateCollection>>
type CollectionWorkflowEngine = {
  run(id: typeof createCollectionsWorkflowId, options: { input: { collections: Omit<AdminCreateCollectionBody, "additional_data">[]; additional_data: AdminCreateCollectionBody["additional_data"] } }): Promise<{ result: { id: string }[] }>
}
