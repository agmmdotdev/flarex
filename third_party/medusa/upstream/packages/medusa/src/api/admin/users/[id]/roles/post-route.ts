import { assignUserRolesWorkflow } from "@medusajs/core-flows/user/workflows/assign-user-roles"
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { MedusaError } from "@medusajs/utils/common/errors"
import { AdminAssignUserRolesType } from "../../validators"

type UserRbacRoleLink = {
  rbac_role: unknown
}

function isUserRbacRoleLink(value: unknown): value is UserRbacRoleLink {
  return Boolean(
    value &&
      typeof value === "object" &&
      "rbac_role" in value
  )
}

/**
 * @ignore
 * @featureFlag rbac
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<AdminAssignUserRolesType>,
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

  await assignUserRolesWorkflow().run({
    container: req.scope,
    input: {
      actor_id: req.auth_context.actor_id,
      actor: req.auth_context.actor_type,
      user_id: userId,
      role_ids: roles,
    },
  })

  const { data: links } = await query.graph({
    entity: "user_rbac_role",
    fields: ["rbac_role.*"],
    filters: { user_id: userId },
  })

  const userRoles = links
    .filter(isUserRbacRoleLink)
    .map((link) => link.rbac_role)

  res.status(200).json({ roles: userRoles })
}
