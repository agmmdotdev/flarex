import {
  normalizeRuntimeContextPart,
  type TenantRuntimeContext,
} from "./tenant-context"

export type ProjectionDatabaseAddressInput = Readonly<{
  name: string
}>

export type ProjectionDatabaseAddress = Readonly<{
  tenantId: string
  deploymentId: string
  environment: string
  deploymentVersion: string
  name: string
  key: string
}>

export function createProjectionDatabaseAddress(
  context: TenantRuntimeContext,
  input: ProjectionDatabaseAddressInput
): ProjectionDatabaseAddress {
  const name = normalizeRuntimeContextPart(input.name, "projectionName")
  const parts = [
    "projection-db",
    context.tenantId,
    context.deploymentId,
    context.environment,
    context.deploymentVersion,
    name,
  ]

  return {
    ...context,
    name,
    key: parts.join(":"),
  }
}
