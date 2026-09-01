import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { BatchMethodRequest, HttpTypes } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  defineFileConfig,
  FeatureFlag,
  Modules,
} from "@medusajs/framework/utils"
import TranslationFeatureFlag from "../../../../feature-flags/translation"
import { defaultAdminTranslationFields } from "../query-config"
import {
  AdminCreateTranslationType,
  AdminUpdateTranslationType,
} from "../validators"

const batchTranslationsWorkflowId = "batch-translations"

type TranslationBatchWorkflowResult = {
  created: Array<{ id: string }>
  updated: Array<{ id: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTranslationReference(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string"
}

function isTranslationBatchWorkflowResult(
  value: unknown
): value is TranslationBatchWorkflowResult {
  if (!isRecord(value)) {
    return false
  }

  const created = value.created
  const updated = value.updated

  return (
    Array.isArray(created) &&
    Array.isArray(updated) &&
    created.every(isTranslationReference) &&
    updated.every(isTranslationReference)
  )
}

/**
 * @since 2.12.3
 * @featureFlag translation
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<
    BatchMethodRequest<AdminCreateTranslationType, AdminUpdateTranslationType>
  >,
  res: MedusaResponse<HttpTypes.AdminTranslationsBatchResponse>
) => {
  const { create = [], update = [], delete: deleteIds = [] } = req.validatedBody

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const { result: workflowResult } = await workflowEngine.run(
    batchTranslationsWorkflowId,
    {
      input: {
        create,
        update,
        delete: deleteIds,
      },
    }
  )

  if (!isTranslationBatchWorkflowResult(workflowResult)) {
    throw new Error(
      `Unexpected workflow result for ${batchTranslationsWorkflowId}`
    )
  }

  const result = workflowResult

  const ids = Array.from(
    new Set([
      ...result.created.map((t) => t.id),
      ...result.updated.map((t) => t.id),
    ])
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: translations } = await query.graph({
    entity: "translation",
    fields: defaultAdminTranslationFields,
    filters: {
      id: ids,
    },
  })

  const created = translations.filter((t) =>
    result.created.some((r) => r.id === t.id)
  )
  const updated = translations.filter((t) =>
    result.updated.some((r) => r.id === t.id)
  )

  return res.status(200).json({
    created,
    updated,
    deleted: {
      ids: deleteIds,
      object: "translation",
      deleted: true,
    },
  })
}

defineFileConfig({
  isDisabled: () => !FeatureFlag.isFeatureEnabled(TranslationFeatureFlag.key),
})
