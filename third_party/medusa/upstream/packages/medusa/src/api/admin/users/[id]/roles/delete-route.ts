import { removeUserRolesWorkflow } from "@medusajs/core-flows/user/workflows/remove-user-roles"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { MedusaError } from "@medusajs/utils/common/errors"
import { AdminRemoveUserRolesType } from "../../validators"

/**
 * @ignore
 * @featureFlag rbac
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest<AdminRemoveUserRolesType>,
  res: MedusaResponse
) => {
  const userId = req.params.id
  const { roles } = req.validatedBody
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const {
    data: [user],
  } = await query.graph({
    entity: "user",
    fields: ["id"],
    filters: { id: userId },
  })

  if (!user) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `User with id "${userId}" not found`
    )
  }

  await removeUserRolesWorkflow().run({
    container: req.scope,
    input: {
      actor_id: req.auth_context.actor_id,
      actor: req.auth_context.actor_type,
      user_id: userId,
      role_ids: roles,
    },
  })

  res.status(200).json({
    ids: roles,
    object: "user_role",
    deleted: true,
  })
}
