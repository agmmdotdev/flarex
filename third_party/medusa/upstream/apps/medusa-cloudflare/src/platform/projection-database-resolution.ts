import {
  createProjectionDatabaseAddress,
  type ProjectionDatabaseAddress,
  type TenantRuntimeContext,
} from "@medusajs/cloudflare-runtime"

export class ProjectionDatabaseResolutionError extends Error {
  readonly address: ProjectionDatabaseAddress

  constructor(address: ProjectionDatabaseAddress) {
    super(`No D1 projection database binding is configured for ${address.key}`)
    this.name = "ProjectionDatabaseResolutionError"
    this.address = address
  }
}

export type ProjectionDatabaseBindings = Readonly<{
  INDEX_DB?: D1Database
  INDEX_DB_TENANT_A?: D1Database
  INDEX_DB_TENANT_B?: D1Database
}>

export type ProjectionDatabaseResolution = Readonly<{
  address: ProjectionDatabaseAddress
  bindingName: string
  database: D1Database
}>

export function resolveIndexProjectionDatabase(
  context: TenantRuntimeContext,
  bindings: ProjectionDatabaseBindings
): ProjectionDatabaseResolution {
  const address = createProjectionDatabaseAddress(context, {
    name: "index",
  })

  if (context.tenantId === "tenant_a" && bindings.INDEX_DB_TENANT_A) {
    return {
      address,
      bindingName: "INDEX_DB_TENANT_A",
      database: bindings.INDEX_DB_TENANT_A,
    }
  }

  if (context.tenantId === "tenant_b" && bindings.INDEX_DB_TENANT_B) {
    return {
      address,
      bindingName: "INDEX_DB_TENANT_B",
      database: bindings.INDEX_DB_TENANT_B,
    }
  }

  if (bindings.INDEX_DB) {
    return {
      address,
      bindingName: "INDEX_DB",
      database: bindings.INDEX_DB,
    }
  }

  throw new ProjectionDatabaseResolutionError(address)
}
