import { Modules } from "@medusajs/framework/utils"
import {
  rbacModuleDefinition,
  rbacModuleExports,
  rbacModuleModels,
  rbacStaticResources,
} from "../static-manifest"
import { RbacPolicy, RbacRole, RbacRoleParent, RbacRolePolicy } from "../models"
import { RbacModuleService } from "../services"

describe("RBAC static manifest", () => {
  it("matches the normal RBAC module export and explicit static resources", () => {
    expect(rbacModuleDefinition.key).toBe(Modules.RBAC)
    expect(rbacModuleExports.service).toBe(RbacModuleService)
    expect(rbacModuleModels).toEqual([
      RbacRole,
      RbacPolicy,
      RbacRoleParent,
      RbacRolePolicy,
    ])
    expect(rbacStaticResources.models).toBe(rbacModuleModels)
    expect(rbacStaticResources.services).toEqual([])
    expect(rbacStaticResources.repositories.map((entry) => entry.name)).toEqual(
      ["RbacRepository"]
    )
    expect(rbacStaticResources.loaders).toHaveLength(1)
    expect(rbacStaticResources.moduleService).toBe(RbacModuleService)
    expect(rbacStaticResources.joinerConfig?.serviceName).toBe(Modules.RBAC)
    expect(rbacStaticResources.joinerConfig?.linkableKeys).toMatchObject({
      rbac_role_id: "RbacRole",
      rbac_policy_id: "RbacPolicy",
      rbac_role_parent_id: "RbacRoleParent",
      rbac_role_policy_id: "RbacRolePolicy",
    })
  })
})
