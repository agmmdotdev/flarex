import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";

export function deploymentObjectName(deploymentId: string): string {
  return `deployment:${deploymentId}`;
}

export function deploymentSyncObjectName(scopeUuid: ScopeUuidV1): string {
  return `deployment-sync:${scopeUuid}`;
}

export function partitionObjectName(deploymentId: string, partitionKey: string): string {
  return `partition:${deploymentId}:${partitionKey}`;
}

export function executionObjectName(deploymentId: string, sessionId: string): string {
  return `execution:${deploymentId}:${sessionId}`;
}

export function connectionObjectName(deploymentId: string, sessionId: string): string {
  return `connection:${deploymentId}:${sessionId}`;
}

export function deliveryObjectName(deploymentId: string): string {
  return `delivery:${deploymentId}`;
}

export function schedulerObjectName(deploymentId: string): string {
  return `scheduler:${deploymentId}`;
}
