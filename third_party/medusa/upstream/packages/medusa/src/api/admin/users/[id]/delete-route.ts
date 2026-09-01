import { removeUserAccountWorkflow } from "@medusajs/core-flows/user/workflows/remove-user-account"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { HttpTypes } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/utils/common/errors"

// delete user
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<HttpTypes.AdminUserDeleteResponse>
) => {
  const { id } = req.params
  const { actor_id } = req.auth_context

  if (actor_id === id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "A user cannot delete itself"
    )
  }

  await removeUserAccountWorkflow().run({
    container: req.scope,
    input: { userId: id },
  })

  res.status(200).json({
    id,
    object: "user",
    deleted: true,
  })
}
