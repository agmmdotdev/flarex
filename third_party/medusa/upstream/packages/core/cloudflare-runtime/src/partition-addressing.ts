import {
  normalizeRuntimeContextPart,
  type TenantRuntimeContext,
} from "./tenant-context"

export type PartitionAddressInput = Readonly<{
  family: string
  key: string
}>

export type PartitionAddress = Readonly<{
  tenantId: string
  deploymentId: string
  environment: string
  deploymentVersion: string
  family: string
  key: string
  name: string
}>

export function createPartitionAddress(
  context: TenantRuntimeContext,
  input: PartitionAddressInput
): PartitionAddress {
  const family = normalizeRuntimeContextPart(input.family, "partitionFamily")
  const key = normalizeRuntimeContextPart(input.key, "partitionKey")
  const parts = [
    "partition",
    context.tenantId,
    context.deploymentId,
    context.environment,
    context.deploymentVersion,
    family,
    key,
  ]

  return {
    ...context,
    family,
    key,
    name: parts.join(":"),
  }
}
