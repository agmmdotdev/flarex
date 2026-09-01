const ADDRESS_PART_PATTERN = /^[A-Za-z0-9._-]+$/

export class TenantRuntimeContextError extends Error {
  readonly field: TenantRuntimeContextField

  constructor(field: TenantRuntimeContextField, message: string) {
    super(message)
    this.name = "TenantRuntimeContextError"
    this.field = field
  }
}

export type TenantRuntimeContextField =
  | "tenantId"
  | "deploymentId"
  | "environment"
  | "deploymentVersion"
  | "partitionFamily"
  | "partitionKey"
  | "projectionName"

export type TenantRuntimeContext = Readonly<{
  tenantId: string
  deploymentId: string
  environment: string
  deploymentVersion: string
}>

export type TenantRuntimeContextInput = Partial<TenantRuntimeContext>

export const defaultTenantRuntimeContext = {
  tenantId: "local",
  deploymentId: "local",
  environment: "development",
  deploymentVersion: "dev",
} satisfies TenantRuntimeContext

export function createTenantRuntimeContext(
  input: TenantRuntimeContextInput = {}
): TenantRuntimeContext {
  return {
    tenantId: normalizeRuntimeContextPart(
      input.tenantId ?? defaultTenantRuntimeContext.tenantId,
      "tenantId"
    ),
    deploymentId: normalizeRuntimeContextPart(
      input.deploymentId ?? defaultTenantRuntimeContext.deploymentId,
      "deploymentId"
    ),
    environment: normalizeRuntimeContextPart(
      input.environment ?? defaultTenantRuntimeContext.environment,
      "environment"
    ),
    deploymentVersion: normalizeRuntimeContextPart(
      input.deploymentVersion ?? defaultTenantRuntimeContext.deploymentVersion,
      "deploymentVersion"
    ),
  }
}

export function normalizeRuntimeContextPart(
  value: string,
  field: TenantRuntimeContextField
): string {
  const normalized = value.trim()

  if (!normalized) {
    throw new TenantRuntimeContextError(
      field,
      `Tenant runtime context field "${field}" cannot be empty`
    )
  }

  if (!ADDRESS_PART_PATTERN.test(normalized)) {
    throw new TenantRuntimeContextError(
      field,
      `Tenant runtime context field "${field}" contains unsupported characters`
    )
  }

  return normalized
}
