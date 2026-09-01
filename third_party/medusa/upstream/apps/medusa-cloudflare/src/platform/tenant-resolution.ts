import {
  createTenantRuntimeContext,
  defaultTenantRuntimeContext,
  type TenantRuntimeContext,
} from "@medusajs/cloudflare-runtime"

export type TenantRuntimeEnv = Readonly<{
  MEDUSA_TENANT_ID?: string
  MEDUSA_DEPLOYMENT_ID?: string
  MEDUSA_ENVIRONMENT?: string
  MEDUSA_DEPLOYMENT_VERSION?: string
}>

export function resolveTenantRuntimeContext(
  request: Request,
  env: TenantRuntimeEnv = {}
): TenantRuntimeContext {
  return createTenantRuntimeContext({
    tenantId:
      headerValue(request, "x-medusa-tenant-id") ??
      env.MEDUSA_TENANT_ID ??
      defaultTenantRuntimeContext.tenantId,
    deploymentId:
      headerValue(request, "x-medusa-deployment-id") ??
      env.MEDUSA_DEPLOYMENT_ID ??
      defaultTenantRuntimeContext.deploymentId,
    environment:
      headerValue(request, "x-medusa-environment") ??
      env.MEDUSA_ENVIRONMENT ??
      defaultTenantRuntimeContext.environment,
    deploymentVersion:
      headerValue(request, "x-medusa-deployment-version") ??
      env.MEDUSA_DEPLOYMENT_VERSION ??
      defaultTenantRuntimeContext.deploymentVersion,
  })
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)?.trim()

  return value ? value : undefined
}
