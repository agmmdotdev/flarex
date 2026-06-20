import {
  DeploymentPackageMetadataAlreadyExistsError,
  type DeploymentPackageMetadataRecord,
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type DocumentRevisionRecord,
  type InsertDeploymentPackageMetadataInput,
  type InsertDeploymentMetadataInput,
  type InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataAlreadyExistsError,
  type InvokeSessionMetadataRecord,
  type UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";

import type { FlarexExecutorPersistence } from "../../src";

export function healthyPersistence(): FlarexExecutorPersistence {
  return memoryPersistence();
}

export function memoryPersistence(
  initialDeployments: DeploymentMetadataRecord[] = [],
  initialPackages: DeploymentPackageMetadataRecord[] = [],
  initialInvokeSessions: InvokeSessionMetadataRecord[] = [],
  initialDocuments: DocumentRevisionRecord[] = [],
): FlarexExecutorPersistence {
  const deployments = new Map<string, DeploymentMetadataRecord>(
    initialDeployments.map((deployment) => [
      deployment.deploymentId,
      deployment,
    ]),
  );
  const packages = new Map<string, DeploymentPackageMetadataRecord>(
    initialPackages.map((deploymentPackage) => [
      packageKey(deploymentPackage.deploymentId, deploymentPackage.packageId),
      deploymentPackage,
    ]),
  );
  const invokeSessions = new Map<string, InvokeSessionMetadataRecord>(
    initialInvokeSessions.map((session) => [
      sessionKey(session.deploymentId, session.sessionId),
      session,
    ]),
  );
  const documentRevisions = [...initialDocuments];

  return {
    async check() {
      return { status: "ok" as const };
    },
    async getDeploymentPackageMetadata(deploymentId: string, packageId: string) {
      return packages.get(packageKey(deploymentId, packageId)) ?? null;
    },
    async insertDeploymentPackageMetadata(
      input: InsertDeploymentPackageMetadataInput,
    ) {
      const key = packageKey(input.deploymentId, input.packageId);
      if (packages.has(key)) {
        throw new DeploymentPackageMetadataAlreadyExistsError(
          input.deploymentId,
          input.packageId,
        );
      }
      const deploymentPackage = deploymentPackageMetadata(input);
      packages.set(key, deploymentPackage);
      return deploymentPackage;
    },
    async getDeploymentMetadata(deploymentId: string) {
      return deployments.get(deploymentId) ?? null;
    },
    async insertDeploymentMetadata(input: InsertDeploymentMetadataInput) {
      if (deployments.has(input.deploymentId)) {
        throw new DeploymentMetadataAlreadyExistsError(input.deploymentId);
      }
      const deployment = deploymentMetadata(input);
      deployments.set(deployment.deploymentId, deployment);
      return deployment;
    },
    async updateDeploymentMetadataActivation(
      input: UpdateDeploymentMetadataActivationInput,
    ) {
      const deployment = deployments.get(input.deploymentId);
      if (deployment === undefined) {
        return null;
      }

      const updated = {
        ...deployment,
        activePackageId: input.activePackageId,
        activeSchemaVersion: input.activeSchemaVersion,
      };
      deployments.set(updated.deploymentId, updated);
      return updated;
    },
    async insertInvokeSessionMetadata(input: InsertInvokeSessionMetadataInput) {
      const key = sessionKey(input.deploymentId, input.sessionId);
      if (invokeSessions.has(key)) {
        throw new InvokeSessionMetadataAlreadyExistsError(
          input.deploymentId,
          input.sessionId,
        );
      }
      const session = invokeSessionMetadata(input);
      invokeSessions.set(key, session);
      return session;
    },
    async getInvokeSessionMetadata(deploymentId: string, sessionId: string) {
      return invokeSessions.get(sessionKey(deploymentId, sessionId)) ?? null;
    },
    async getDocumentRevisionAtTs(deploymentId: string, id: string, ts: number) {
      return (
        documentRevisions
          .filter(
            (document) =>
              document.deploymentId === deploymentId &&
              document.id === id &&
              document.ts <= ts,
          )
          .sort((left, right) => right.ts - left.ts)[0] ?? null
      );
    },
  };
}

export function deploymentPackageMetadata(
  input: InsertDeploymentPackageMetadataInput,
): DeploymentPackageMetadataRecord {
  return {
    deploymentId: input.deploymentId,
    packageId: input.packageId,
    sourcePackageHash: input.sourcePackageHash,
    executionModule: input.executionModule,
    sourcePackageJson: input.sourcePackageJson,
    analysisJson: input.analysisJson ?? null,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

export function deploymentMetadata(
  input: InsertDeploymentMetadataInput,
): DeploymentMetadataRecord {
  return {
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    activePackageId: input.activePackageId ?? null,
    activeSchemaVersion: input.activeSchemaVersion ?? 0,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

export function invokeSessionMetadata(
  input: InsertInvokeSessionMetadataInput,
): InvokeSessionMetadataRecord {
  return {
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: input.projectId,
    packageId: input.packageId,
    functionPath: input.functionPath,
    functionKind: input.functionKind,
    partitionKey: input.partitionKey,
    scopeJson: input.scopeJson,
    argsJson: input.argsJson,
    idempotencyKey: input.idempotencyKey ?? null,
    state: input.state ?? "active",
    beginTs: input.beginTs,
    schemaVersion: input.schemaVersion,
    executionModule: input.executionModule,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
    finishedAt: null,
  };
}

function packageKey(deploymentId: string, packageId: string): string {
  return `${deploymentId}/${packageId}`;
}

function sessionKey(deploymentId: string, sessionId: string): string {
  return `${deploymentId}/${sessionId}`;
}
