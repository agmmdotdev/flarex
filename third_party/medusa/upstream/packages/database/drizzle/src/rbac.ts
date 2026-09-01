import type { PortableEntity } from "@medusajs/dml"
import type { Context, ModulePersistenceModel } from "@medusajs/types"
import { and, inArray, isNull } from "drizzle-orm"
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core"
import { compileDmlSchema } from "./schema"
import { toDrizzleSqliteTable } from "./sqlite"

type DmlModel = PortableEntity & ModulePersistenceModel

type DrizzleRbacManager = {
  database: BaseSQLiteDatabase<"async", unknown>
  transactionMode: "atomic" | "statement"
  transaction<TResult>(
    task: (transactionManager: DrizzleRbacManager) => Promise<TResult>
  ): Promise<TResult>
  destroy(): Promise<void>
}

type DrizzleRepositoryInstance = {
  getActiveManager<TManager = unknown>(context?: Context): TManager
}

type DrizzleRepositoryConstructor = new (
  options: { manager: DrizzleRbacManager }
) => DrizzleRepositoryInstance

type RbacTables = {
  role: ReturnType<typeof toDrizzleSqliteTable>
  roleColumns: Record<string, SQLiteColumn>
  policy: ReturnType<typeof toDrizzleSqliteTable>
  policyColumns: Record<string, SQLiteColumn>
  rolePolicy: ReturnType<typeof toDrizzleSqliteTable>
  rolePolicyColumns: Record<string, SQLiteColumn>
  roleParent: ReturnType<typeof toDrizzleSqliteTable>
  roleParentColumns: Record<string, SQLiteColumn>
}

type RoleRow = {
  id: string
}

type RoleParentRow = {
  role_id: string
  parent_id: string
}

type RolePolicyRow = {
  role_id: string
  policy_id: string
}

type PolicyRow = {
  id: string
  key: string
  resource: string
  operation: string
  name: string | null
  description: string | null
  metadata: unknown
  created_at: Date | number | string | null
  updated_at: Date | number | string | null
}

type PolicyWithInheritance = PolicyRow & {
  inherited_from_role_id: string | null
}

export function createDrizzleRbacRepository(
  moduleModels: Record<string, ModulePersistenceModel>,
  BaseRepository: DrizzleRepositoryConstructor
) {
  const tables = createRbacTables(moduleModels)

  return class DrizzleRbacRepository extends BaseRepository {
    async listPoliciesForRole(
      roleId: string,
      sharedContext: Context = {}
    ): Promise<PolicyWithInheritance[]> {
      const policiesByRole = await this.listPoliciesForRoles(
        [roleId],
        sharedContext
      )
      return policiesByRole.get(roleId) ?? []
    }

    async listPoliciesForRoles(
      roleIds: string[],
      sharedContext: Context = {}
    ): Promise<Map<string, PolicyWithInheritance[]>> {
      if (!roleIds.length) {
        return new Map()
      }

      const manager = this.getActiveManager<DrizzleRbacManager>(sharedContext)
      const database = manager.database
      const [roles, roleParents] = await Promise.all([
        selectActiveRoles(database, tables, roleIds),
        selectActiveRoleParents(database, tables),
      ])
      const activeRequestedRoleIds = new Set(roles.map((role) => role.id))
      const hierarchyByRole = resolveHierarchyByRole(
        roleIds.filter((roleId) => activeRequestedRoleIds.has(roleId)),
        roleParents
      )
      const hierarchyRoleIds = uniqueStrings(
        [...hierarchyByRole.values()].flat()
      )
      const rolePolicies = await selectRolePolicies(
        database,
        tables,
        hierarchyRoleIds
      )
      const policies = await selectPolicies(
        database,
        tables,
        uniqueStrings(rolePolicies.map((row) => row.policy_id))
      )
      const policiesById = new Map(policies.map((policy) => [policy.id, policy]))
      const rolePoliciesByRoleId = groupBy(rolePolicies, "role_id")
      const policiesByOriginalRole = new Map<string, PolicyWithInheritance[]>()

      for (const originalRoleId of roleIds) {
        const policyRows: PolicyWithInheritance[] = []
        const seenPolicyIds = new Set<string>()

        for (const hierarchyRoleId of hierarchyByRole.get(originalRoleId) ?? []) {
          for (const rolePolicy of rolePoliciesByRoleId.get(hierarchyRoleId) ??
            []) {
            if (seenPolicyIds.has(rolePolicy.policy_id)) {
              continue
            }

            const policy = policiesById.get(rolePolicy.policy_id)
            if (!policy) {
              continue
            }

            seenPolicyIds.add(rolePolicy.policy_id)
            policyRows.push({
              ...policy,
              inherited_from_role_id:
                rolePolicy.role_id === originalRoleId ? null : rolePolicy.role_id,
            })
          }
        }

        policiesByOriginalRole.set(originalRoleId, sortPolicies(policyRows))
      }

      return policiesByOriginalRole
    }

    async checkForCycle(
      roleId: string,
      parentId: string,
      sharedContext: Context = {}
    ): Promise<boolean> {
      const manager = this.getActiveManager<DrizzleRbacManager>(sharedContext)
      const database = manager.database
      const [roles, roleParents] = await Promise.all([
        selectActiveRoles(database, tables, [roleId, parentId]),
        selectActiveRoleParents(database, tables),
      ])
      const activeRoleIds = new Set(roles.map((role) => role.id))

      if (!activeRoleIds.has(parentId)) {
        return false
      }

      return resolveAncestors(parentId, roleParents).includes(roleId)
    }
  }
}

function createRbacTables(
  moduleModels: Record<string, ModulePersistenceModel>
): RbacTables {
  const models = Object.values(moduleModels).filter(isDmlModel)
  const schema = compileDmlSchema(models)
  const tableByModel = new Map(
    models.map((model, index) => [model.name, schema.tables[index]])
  )

  const role = toDrizzleSqliteTable(requiredTable(tableByModel, "RbacRole"))
  const policy = toDrizzleSqliteTable(requiredTable(tableByModel, "RbacPolicy"))
  const rolePolicy = toDrizzleSqliteTable(
    requiredTable(tableByModel, "RbacRolePolicy")
  )
  const roleParent = toDrizzleSqliteTable(
    requiredTable(tableByModel, "RbacRoleParent")
  )

  return {
    role,
    roleColumns: role as unknown as Record<string, SQLiteColumn>,
    policy,
    policyColumns: policy as unknown as Record<string, SQLiteColumn>,
    rolePolicy,
    rolePolicyColumns: rolePolicy as unknown as Record<string, SQLiteColumn>,
    roleParent,
    roleParentColumns: roleParent as unknown as Record<string, SQLiteColumn>,
  }
}

async function selectActiveRoles(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: RbacTables,
  roleIds: string[]
): Promise<RoleRow[]> {
  if (!roleIds.length) {
    return []
  }

  const rows = await database
    .select({ id: tables.roleColumns.id })
    .from(tables.role)
    .where(
      and(
        inArray(tables.roleColumns.id, uniqueStrings(roleIds)),
        isNull(tables.roleColumns.deleted_at)
      )
    )

  return rows.map((row) => ({
    id: String(row.id),
  }))
}

async function selectActiveRoleParents(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: RbacTables
): Promise<RoleParentRow[]> {
  const rows = await database
    .select({
      role_id: tables.roleParentColumns.role_id,
      parent_id: tables.roleParentColumns.parent_id,
    })
    .from(tables.roleParent)
    .where(isNull(tables.roleParentColumns.deleted_at))

  return rows.map((row) => ({
    role_id: String(row.role_id),
    parent_id: String(row.parent_id),
  }))
}

async function selectRolePolicies(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: RbacTables,
  roleIds: string[]
): Promise<RolePolicyRow[]> {
  if (!roleIds.length) {
    return []
  }

  const rows = await database
    .select({
      role_id: tables.rolePolicyColumns.role_id,
      policy_id: tables.rolePolicyColumns.policy_id,
    })
    .from(tables.rolePolicy)
    .where(
      and(
        inArray(tables.rolePolicyColumns.role_id, uniqueStrings(roleIds)),
        isNull(tables.rolePolicyColumns.deleted_at)
      )
    )

  return rows.map((row) => ({
    role_id: String(row.role_id),
    policy_id: String(row.policy_id),
  }))
}

async function selectPolicies(
  database: BaseSQLiteDatabase<"async", unknown>,
  tables: RbacTables,
  policyIds: string[]
): Promise<PolicyRow[]> {
  if (!policyIds.length) {
    return []
  }

  const rows = await database
    .select({
      id: tables.policyColumns.id,
      key: tables.policyColumns.key,
      resource: tables.policyColumns.resource,
      operation: tables.policyColumns.operation,
      name: tables.policyColumns.name,
      description: tables.policyColumns.description,
      metadata: tables.policyColumns.metadata,
      created_at: tables.policyColumns.created_at,
      updated_at: tables.policyColumns.updated_at,
    })
    .from(tables.policy)
    .where(
      and(
        inArray(tables.policyColumns.id, uniqueStrings(policyIds)),
        isNull(tables.policyColumns.deleted_at)
      )
    )

  return rows.map((row) => ({
    id: String(row.id),
    key: String(row.key),
    resource: String(row.resource),
    operation: String(row.operation),
    name: toNullableString(row.name),
    description: toNullableString(row.description),
    metadata: row.metadata,
    created_at: toNullableTemporal(row.created_at),
    updated_at: toNullableTemporal(row.updated_at),
  }))
}

function resolveHierarchyByRole(
  roleIds: string[],
  roleParents: RoleParentRow[]
): Map<string, string[]> {
  return new Map(
    roleIds.map((roleId) => [roleId, resolveAncestors(roleId, roleParents)])
  )
}

function resolveAncestors(
  roleId: string,
  roleParents: RoleParentRow[]
): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const queue = [roleId]

  while (queue.length) {
    const currentRoleId = queue.shift()
    if (!currentRoleId || visited.has(currentRoleId)) {
      continue
    }

    visited.add(currentRoleId)
    result.push(currentRoleId)

    for (const parent of roleParents) {
      if (parent.role_id === currentRoleId && !visited.has(parent.parent_id)) {
        queue.push(parent.parent_id)
      }
    }
  }

  return result
}

function sortPolicies(
  policies: PolicyWithInheritance[]
): PolicyWithInheritance[] {
  return [...policies].sort(
    (left, right) =>
      left.resource.localeCompare(right.resource) ||
      left.operation.localeCompare(right.operation) ||
      left.key.localeCompare(right.key)
  )
}

function groupBy<TKey extends string, TItem extends Record<TKey, string>>(
  values: TItem[],
  key: TKey
): Map<string, TItem[]> {
  const grouped = new Map<string, TItem[]>()

  for (const value of values) {
    const groupKey = value[key]
    const group = grouped.get(groupKey) ?? []
    group.push(value)
    grouped.set(groupKey, group)
  }

  return grouped
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toNullableTemporal(
  value: unknown
): Date | number | string | null {
  if (
    value instanceof Date ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value
  }

  return null
}

function isDmlModel(value: ModulePersistenceModel): value is DmlModel {
  return typeof value === "object" && value !== null && "parse" in value
}

function requiredTable(
  tableByModel: Map<string, ReturnType<typeof compileDmlSchema>["tables"][number]>,
  name: string
): ReturnType<typeof compileDmlSchema>["tables"][number] {
  const table = tableByModel.get(name)
  if (!table) {
    throw new Error(`RBAC Drizzle repository requires ${name} model`)
  }
  return table
}
