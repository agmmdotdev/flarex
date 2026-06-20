import {
  DeploymentPackageMetadataAlreadyExistsError,
  type CommitInvokeSessionInsertsInput,
  type CommitInvokeSessionInsertsResult,
  type DeploymentPackageMetadataRecord,
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type DocumentRevisionRecord,
  type FinishInvokeSessionMetadataInput,
  type InsertDeploymentPackageMetadataInput,
  type InsertDeploymentMetadataInput,
  type InsertInvokeSessionDocumentReadInput,
  type InsertInvokeSessionDocumentWriteInput,
  type InvokeSessionDocumentReadRecord,
  InvokeSessionDocumentWriteAlreadyExistsError,
  type InvokeSessionDocumentWriteRecord,
  InvokeSessionOccConflictError,
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
  initialDocumentReads: InvokeSessionDocumentReadRecord[] = [],
  initialDocumentWrites: InvokeSessionDocumentWriteRecord[] = [],
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
  const documentReads = new Map<string, InvokeSessionDocumentReadRecord>(
    initialDocumentReads.map((read) => [
      documentReadKey(
        read.deploymentId,
        read.sessionId,
        read.tableId,
        read.documentId,
      ),
      read,
    ]),
  );
  const documentWrites = new Map<string, InvokeSessionDocumentWriteRecord>(
    initialDocumentWrites.map((write) => [
      documentWriteKey(
        write.deploymentId,
        write.sessionId,
        write.tableId,
        write.documentId,
      ),
      write,
    ]),
  );
  const committedDocuments: DocumentRevisionRecord[] = [];
  const commits: Array<{ deploymentId: string; ts: number }> = [];

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
    async finishInvokeSessionMetadata(input: FinishInvokeSessionMetadataInput) {
      const session = invokeSessions.get(
        sessionKey(input.deploymentId, input.sessionId),
      );
      if (session === undefined) return null;
      const updated: InvokeSessionMetadataRecord = {
        ...session,
        state: "finished",
        finishedAt: input.finishedAt,
      };
      invokeSessions.set(sessionKey(input.deploymentId, input.sessionId), updated);
      return updated;
    },
    async getDocumentRevisionAtTs(deploymentId: string, id: string, ts: number) {
      return (
        [...documentRevisions, ...committedDocuments]
          .filter(
            (document) =>
              document.deploymentId === deploymentId &&
              document.id === id &&
              document.ts <= ts,
          )
          .sort((left, right) => right.ts - left.ts)[0] ?? null
      );
    },
    async insertInvokeSessionDocumentRead(
      input: InsertInvokeSessionDocumentReadInput,
    ) {
      const key = documentReadKey(
        input.deploymentId,
        input.sessionId,
        input.tableId,
        input.documentId,
      );
      const existing = documentReads.get(key);
      if (existing !== undefined) return existing;
      const read: InvokeSessionDocumentReadRecord = {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        observedTs: input.observedTs ?? null,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
      documentReads.set(key, read);
      return read;
    },
    async listInvokeSessionDocumentReads(deploymentId: string, sessionId: string) {
      return Array.from(documentReads.values())
        .filter(
          (read) =>
            read.deploymentId === deploymentId && read.sessionId === sessionId,
        )
        .sort(
          (left, right) =>
            left.tableId - right.tableId ||
            left.documentId.localeCompare(right.documentId),
        );
    },
    async insertInvokeSessionDocumentWrite(
      input: InsertInvokeSessionDocumentWriteInput,
    ) {
      const key = documentWriteKey(
        input.deploymentId,
        input.sessionId,
        input.tableId,
        input.documentId,
      );
      if (documentWrites.has(key)) {
        throw new InvokeSessionDocumentWriteAlreadyExistsError(
          input.deploymentId,
          input.sessionId,
          input.documentId,
        );
      }
      const write: InvokeSessionDocumentWriteRecord = {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        op: input.op,
        valueJson: input.valueJson ?? null,
        stagedAt: new Date("2026-06-19T00:00:00.000Z"),
      };
      documentWrites.set(key, write);
      return write;
    },
    async listInvokeSessionDocumentWrites(deploymentId: string, sessionId: string) {
      return Array.from(documentWrites.values())
        .filter(
          (write) =>
            write.deploymentId === deploymentId &&
            write.sessionId === sessionId,
        )
        .sort(
          (left, right) =>
            left.stagedAt.getTime() - right.stagedAt.getTime() ||
            left.tableId - right.tableId ||
            left.documentId.localeCompare(right.documentId),
        );
    },
    async commitInvokeSessionInserts(input: CommitInvokeSessionInsertsInput) {
      const writes = Array.from(documentWrites.values()).filter(
        (write) =>
          write.deploymentId === input.deploymentId &&
          write.sessionId === input.sessionId,
      );
      const latestCommitTs = commits
        .filter((commit) => commit.deploymentId === input.deploymentId)
        .reduce((latest, commit) => Math.max(latest, commit.ts), 0);
      const latestDocumentTs = [...documentRevisions, ...committedDocuments]
        .filter((document) => document.deploymentId === input.deploymentId)
        .reduce((latest, document) => Math.max(latest, document.ts), 0);
      const committedTs =
        Math.max(latestCommitTs, latestDocumentTs, input.minimumTs) + 1;
      const committedWrites: CommitInvokeSessionInsertsResult["writes"] = [];
      for (const read of documentReads.values()) {
        if (
          read.deploymentId !== input.deploymentId ||
          read.sessionId !== input.sessionId
        ) {
          continue;
        }
        const current =
          [...documentRevisions, ...committedDocuments]
            .filter(
              (document) =>
                document.deploymentId === input.deploymentId &&
                document.id === read.documentId &&
                document.ts <= committedTs,
            )
            .sort((left, right) => right.ts - left.ts)[0] ?? null;
        const currentTs = current?.ts ?? null;
        if (currentTs !== read.observedTs) {
          throw new InvokeSessionOccConflictError(
            input.deploymentId,
            read.documentId,
            read.observedTs,
            currentTs,
          );
        }
      }
      for (const write of writes) {
        const existing = [...documentRevisions, ...committedDocuments].find(
          (document) =>
            document.deploymentId === input.deploymentId &&
            document.id === write.documentId &&
            document.ts <= committedTs,
        );
        if (existing !== undefined) {
          throw new Error(`Cannot insert existing document ${write.documentId}.`);
        }
        const value = write.valueJson as DocumentRevisionRecord["value"];
        committedDocuments.push({
          deploymentId: input.deploymentId,
          id: write.documentId,
          tableId: write.tableId,
          documentId: write.documentId.slice(`${write.tableId}:`.length),
          ts: committedTs,
          value,
          deleted: false,
          prevTs: null,
        });
        committedWrites.push({
          tableId: write.tableId,
          id: write.documentId,
          prevTs: null,
          ts: committedTs,
          value,
        });
      }
      commits.push({ deploymentId: input.deploymentId, ts: committedTs });
      const session = invokeSessions.get(
        sessionKey(input.deploymentId, input.sessionId),
      );
      if (session !== undefined) {
        invokeSessions.set(sessionKey(input.deploymentId, input.sessionId), {
          ...session,
          state: "finished",
          finishedAt: input.finishedAt,
        });
      }
      return {
        committedTs,
        writes: committedWrites,
      };
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

function documentReadKey(
  deploymentId: string,
  sessionId: string,
  tableId: number,
  documentId: string,
): string {
  return `${deploymentId}/${sessionId}/${tableId}/${documentId}`;
}

function documentWriteKey(
  deploymentId: string,
  sessionId: string,
  tableId: number,
  documentId: string,
): string {
  return `${deploymentId}/${sessionId}/${tableId}/${documentId}`;
}
