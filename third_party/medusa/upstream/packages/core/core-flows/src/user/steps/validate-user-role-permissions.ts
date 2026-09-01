import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/workflows-sdk"

/**
 * @ignore
 * @featureFlag rbac
 */
export type ValidateUserRolePermissionsStepInput = {
  actor_id: string
  actor?: string
  role_ids: string[]
}

type RolePolicy = {
  id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object")
}

function isRolePolicy(value: unknown): value is RolePolicy {
  return isRecord(value) && typeof value.id === "string"
}

function getRolePolicies(value: unknown): RolePolicy[] {
  if (!isRecord(value) || !Array.isArray(value.policies)) {
    return []
  }

  return value.policies.filter(isRolePolicy)
}

function getActorRoles(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.rbac_roles)) {
    return []
  }

  return value.rbac_roles
}

/**
 * @ignore
 * @featureFlag rbac
 */
export const validateUserRolePermissionsStepId =
  "validate-user-role-permissions"

/**
 * Validates that the actor has all the policies from the roles being assigned.
 * A user can only assign roles whose policies they themselves have.
 * @ignore
 * @featureFlag rbac
 */
export const validateUserRolePermissionsStep = createStep(
  validateUserRolePermissionsStepId,
  async (data: ValidateUserRolePermissionsStepInput, { container }) => {
    const { actor_id, actor, role_ids } = data

    if (!role_ids?.length) {
      return new StepResponse(void 0)
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const roleGraphResult = await query.graph({
      entity: "rbac_role",
      fields: ["id", "policies.id"],
      filters: { id: role_ids },
    })
    const roleRows: unknown = roleGraphResult.data
    const roles = Array.isArray(roleRows) ? roleRows : []

    const targetPolicyIds = new Set<string>()
    roles.forEach((role) => {
      getRolePolicies(role).forEach((policy) => {
        targetPolicyIds.add(policy.id)
      })
    })

    if (targetPolicyIds.size === 0) {
      return new StepResponse(void 0)
    }

    const actorGraphResult = await query.graph({
      entity: actor ?? "user",
      fields: ["rbac_roles.id", "rbac_roles.policies.id"],
      filters: { id: actor_id },
    })
    const actorRows: unknown = actorGraphResult.data
    const actors = Array.isArray(actorRows) ? actorRows : []
    const actorRoles = getActorRoles(actors[0])

    if (!actorRoles.length) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "You do not have permission to assign these roles"
      )
    }

    const actorPolicyIds = new Set<string>()
    actorRoles.forEach((role) => {
      getRolePolicies(role).forEach((policy) => {
        actorPolicyIds.add(policy.id)
      })
    })

    const missingPolicies: string[] = []
    targetPolicyIds.forEach((policyId) => {
      if (!actorPolicyIds.has(policyId)) {
        missingPolicies.push(policyId)
      }
    })

    if (missingPolicies.length > 0) {
      throw new MedusaError(
        MedusaError.Types.FORBIDDEN,
        "You do not have permission to assign these roles"
      )
    }

    return new StepResponse(void 0)
  }
)
