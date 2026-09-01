import {
  normalizeRuntimeContextPart,
  type TenantRuntimeContext,
} from "./tenant-context"

export type ProjectionScopeInput = Readonly<{
  name: string
}>

export type ProjectionScope = Readonly<{
  tenantId: string
  deploymentId: string
  environment: string
  deploymentVersion: string
  name: string
  key: string
}>

export function createProjectionScope(
  context: TenantRuntimeContext,
  input: ProjectionScopeInput
): ProjectionScope {
  const name = normalizeRuntimeContextPart(input.name, "projectionName")
  const parts = [
    "projection",
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
