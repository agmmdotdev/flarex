import type { z } from "@medusajs/framework/zod"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import type { ProductTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/utils/common/errors"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { refetchCollection } from "../helpers"
import type { AdminUpdateCollection } from "../validators"

const updateCollectionsWorkflowId = "update-collections"
const deleteCollectionsWorkflowId = "delete-collections"

export const GET = async (
  req: AuthenticatedMedusaRequest<Record<string, unknown>>,
  res: MedusaResponse<CollectionResponse>
) => {
  const collection = await refetchCollection(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ collection })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<
    AdminUpdateCollectionBody,
    Record<string, unknown>
  >,
  res: MedusaResponse<CollectionResponse>
) => {
  const existingCollection = await refetchCollection(req.params.id, req.scope, [
    "id",
  ])
  if (!existingCollection) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Collection with id "${req.params.id}" not found`
    )
  }

  const { additional_data, ...rest } = req.validatedBody
  const workflowEngine = req.scope.resolve<CollectionWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(updateCollectionsWorkflowId, {
    input: {
      selector: { id: req.params.id },
      update: rest,
      additional_data,
    },
  })

  const collection = await refetchCollection(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ collection })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<{ id: string; object: "collection"; deleted: true }>
) => {
  const id = req.params.id
  const workflowEngine = req.scope.resolve<CollectionWorkflowEngine>(Modules.WORKFLOW_ENGINE)

  await workflowEngine.run(deleteCollectionsWorkflowId, {
    input: { ids: [id] },
  })

  res.status(200).json({
    id,
    object: "collection",
    deleted: true,
  })
}

type CollectionResponse = { collection: ProductTypes.ProductCollectionDTO | undefined }

type AdminUpdateCollectionBody = z.infer<ReturnType<typeof AdminUpdateCollection>>
type CollectionWorkflowEngine = {
  run(id: typeof updateCollectionsWorkflowId, options: { input: { selector: { id: string }; update: Omit<AdminUpdateCollectionBody, "additional_data">; additional_data: AdminUpdateCollectionBody["additional_data"] } }): Promise<unknown>
  run(id: typeof deleteCollectionsWorkflowId, options: { input: { ids: string[] } }): Promise<unknown>
}
