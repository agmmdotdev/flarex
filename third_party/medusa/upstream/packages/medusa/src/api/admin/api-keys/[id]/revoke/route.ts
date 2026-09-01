import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { refetchApiKey } from "../../helpers"
import { HttpTypes } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const revokeApiKeysWorkflowId = "revoke-api-keys"

export const POST = async (
  req: AuthenticatedMedusaRequest<
    HttpTypes.AdminRevokeApiKey,
    HttpTypes.SelectParams
  >,
  res: MedusaResponse<HttpTypes.AdminApiKeyResponse>
) => {
  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  await workflowEngine.run(revokeApiKeysWorkflowId, {
    input: {
      selector: { id: req.params.id },
      revoke: {
        ...req.validatedBody,
        revoked_by: req.auth_context.actor_id,
      },
    },
  })

  const apiKey = await refetchApiKey(
    req.params.id,
    req.scope,
    req.queryConfig.fields
  )

  res.status(200).json({ api_key: apiKey })
}
