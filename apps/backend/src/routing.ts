export function deploymentObjectName(deploymentId: string): string {
  return `deployment:${deploymentId}`;
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

export function schedulerObjectName(deploymentId: string): string {
  return `scheduler:${deploymentId}`;
}
