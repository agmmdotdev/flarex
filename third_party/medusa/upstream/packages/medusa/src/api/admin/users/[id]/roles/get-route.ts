import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"

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
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const userId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links, metadata } = await query.graph({
    entity: "user_rbac_role",
    fields: req.queryConfig?.fields,
    filters: { ...req.filterableFields, user_id: userId },
    pagination: req.queryConfig?.pagination || {},
  })

  const roles = links
    .filter(isUserRbacRoleLink)
    .map((link) => link.rbac_role)

  res.status(200).json({
    roles,
    count: metadata?.count ?? 0,
    offset: metadata?.skip ?? 0,
    limit: metadata?.take ?? 0,
  })
}
