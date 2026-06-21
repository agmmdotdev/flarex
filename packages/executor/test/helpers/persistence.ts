import {
  DeploymentPackageMetadataAlreadyExistsError,
  type CommitInvokeSessionWritesInput,
  type CommitInvokeSessionWritesResult,
  type DeploymentPackageMetadataRecord,
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type DocumentRevisionRecord,
  type AbortInvokeSessionMetadataInput,
  type AbortStaleInvokeSessionsMetadataInput,
  type FinishInvokeSessionMetadataInput,
  type InsertDeploymentPackageMetadataInput,
  type InsertDeploymentMetadataInput,
  type InsertInvokeSessionDocumentReadInput,
  type StageInvokeSessionDocumentWriteInput,
  type InsertInvokeSessionIndexReadInput,
  type InsertInvokeSessionTableReadInput,
  type InvokeSessionIndexReadRecord,
  type InvokeSessionDocumentReadRecord,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionDocumentWriteConflictError,
  type InvokeSessionDocumentWriteRecord,
  InvokeSessionDeleteTargetError,
  InvokeSessionInsertConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionReplaceTargetError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
  commitOutboxEvent,
  type InsertOutboxEventInput,
  type InvokeSessionTableReadRecord,
  type OutboxEventRecord,
  type ListDeploymentMetadataInput,
  type ListLiveQuerySubscriptionsInput,
  type ListUndeliveredLiveQueryDeliveriesInput,
  type ListUndeliveredLiveQueryDeliveriesResult,
  type ListOutboxEventsInput,
  type ListOutboxEventsResult,
  type ListUndeliveredOutboxEventsInput,
  type LiveQueryDeliveryRecord,
  type LiveQuerySubscriptionKey,
  type LiveQuerySubscriptionRecord,
  type MarkLiveQueryDeliveriesDeliveredInput,
  type MarkLiveQueryDeliveriesDeliveredResult,
  type MarkOutboxEventsDeliveredInput,
  type MarkOutboxEventsDeliveredResult,
  type RecordLiveQueryRerunResultInput,
  type RecordLiveQueryRerunResultResult,
  schemaTableValidatorsFromAnalysis,
  type InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataAlreadyExistsError,
  type InvokeSessionMetadataRecord,
  type UpsertLiveQuerySubscriptionInput,
  type UpdateDeploymentMetadataActivationInput,
  encodeIndexValues,
  schemaIndexesFromAnalysis,
  validateDocumentValue,
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
  initialTableReads: InvokeSessionTableReadRecord[] = [],
  initialIndexReads: InvokeSessionIndexReadRecord[] = [],
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
  const tableReads = new Map<string, InvokeSessionTableReadRecord>(
    initialTableReads.map((read) => [
      tableReadKey(read.deploymentId, read.sessionId, read.tableId),
      read,
    ]),
  );
  const indexReads = new Map<string, InvokeSessionIndexReadRecord>(
    initialIndexReads.map((read) => [
      indexReadKey(
        read.deploymentId,
        read.sessionId,
        read.indexId,
        read.lowerKey,
        read.upperKey,
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
  const outboxEvents: OutboxEventRecord[] = [];
  const liveQuerySubscriptions = new Map<string, LiveQuerySubscriptionRecord>();
  const liveQueryDeliveries: LiveQueryDeliveryRecord[] = [];

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
    async listDeploymentMetadata(input: ListDeploymentMetadataInput) {
      const sorted = Array.from(deployments.values())
        .filter(
          (deployment) =>
            input.cursor === undefined ||
            deployment.createdAt > input.cursor.createdAt ||
            (deployment.createdAt.getTime() === input.cursor.createdAt.getTime() &&
              deployment.deploymentId > input.cursor.deploymentId),
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.deploymentId.localeCompare(right.deploymentId),
        );
      const rows = sorted.slice(0, input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        deployments: page,
        nextCursor:
          hasMore && last !== undefined
            ? {
                createdAt: last.createdAt,
                deploymentId: last.deploymentId,
              }
            : null,
        hasMore,
      };
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
    async abortInvokeSessionMetadata(input: AbortInvokeSessionMetadataInput) {
      const session = invokeSessions.get(
        sessionKey(input.deploymentId, input.sessionId),
      );
      if (session === undefined) return null;
      const updated: InvokeSessionMetadataRecord = {
        ...session,
        state: "aborted",
        finishedAt: input.finishedAt,
      };
      invokeSessions.set(sessionKey(input.deploymentId, input.sessionId), updated);
      return updated;
    },
    async abortStaleInvokeSessionsMetadata(
      input: AbortStaleInvokeSessionsMetadataInput,
    ) {
      const stale = Array.from(invokeSessions.values())
        .filter(
          (session) =>
            session.deploymentId === input.deploymentId &&
            session.state === "active" &&
            session.createdAt < input.olderThan,
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.sessionId.localeCompare(right.sessionId),
        );
      const selected =
        input.limit === undefined ? stale : stale.slice(0, input.limit);
      const aborted: InvokeSessionMetadataRecord[] = [];
      for (const session of selected) {
        const updated: InvokeSessionMetadataRecord = {
          ...session,
          state: "aborted",
          finishedAt: input.finishedAt,
        };
        invokeSessions.set(sessionKey(session.deploymentId, session.sessionId), updated);
        aborted.push(updated);
      }
      return {
        sessions: aborted,
        hasMore: input.limit !== undefined && stale.length > input.limit,
      };
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
    async listDocumentsInTableAtTs(
      deploymentId: string,
      tableId: number,
      ts: number,
      limit?: number,
    ) {
      const latest = new Map<string, DocumentRevisionRecord>();
      for (const document of [...documentRevisions, ...committedDocuments]
        .filter(
          (candidate) =>
            candidate.deploymentId === deploymentId &&
            candidate.tableId === tableId &&
            candidate.ts <= ts,
        )
        .sort(
          (left, right) =>
            left.id.localeCompare(right.id) || right.ts - left.ts,
        )) {
        if (!latest.has(document.id)) latest.set(document.id, document);
      }
      const visible = Array.from(latest.values())
        .filter((document) => !document.deleted)
        .sort((left, right) => left.id.localeCompare(right.id));
      return limit === undefined ? visible : visible.slice(0, limit);
    },
    async listDocumentsInIndexAtTs(input) {
      const index = Array.from(packages.values())
        .filter(
          (deploymentPackage) =>
            deploymentPackage.deploymentId === input.deploymentId,
        )
        .flatMap((deploymentPackage) =>
          schemaIndexesFromAnalysis(deploymentPackage.analysisJson),
        )
        .find((candidate) => candidate.indexId === input.indexId);
      const documents =
        index === undefined
          ? []
          : (await this.listDocumentsInTableAtTs(
              input.deploymentId,
              index.tableId,
              input.ts,
            ))
              .map((document) => ({
                key: encodeIndexValues([
                  ...index.fields.map((field) =>
                    getField(document.value, field),
                  ),
                  document.id,
                ]),
                document,
              }))
              .filter(({ key }) => keyInRange(key, input.lower, input.upper))
              .filter(({ key }) => cursorAllows(key, input.cursor, input.order))
              .sort((left, right) =>
                input.order === "desc"
                  ? right.key.localeCompare(left.key)
                  : left.key.localeCompare(right.key),
              );
      const limit = input.limit ?? documents.length;
      const page = documents.slice(0, limit);
      return {
        documents: page,
        isDone: documents.length <= limit,
        continueCursor: page.at(-1)?.key ?? input.cursor ?? "",
      };
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
    async insertInvokeSessionTableRead(input: InsertInvokeSessionTableReadInput) {
      const key = tableReadKey(
        input.deploymentId,
        input.sessionId,
        input.tableId,
      );
      const existing = tableReads.get(key);
      if (existing !== undefined) return existing;
      const read: InvokeSessionTableReadRecord = {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        observedTs: input.observedTs,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
      tableReads.set(key, read);
      return read;
    },
    async listInvokeSessionTableReads(deploymentId: string, sessionId: string) {
      return Array.from(tableReads.values())
        .filter(
          (read) =>
            read.deploymentId === deploymentId && read.sessionId === sessionId,
        )
        .sort((left, right) => left.tableId - right.tableId);
    },
    async insertInvokeSessionIndexRead(input: InsertInvokeSessionIndexReadInput) {
      const lowerKey = input.lowerKey ?? "";
      const upperKey = input.upperKey ?? "";
      const key = indexReadKey(
        input.deploymentId,
        input.sessionId,
        input.indexId,
        lowerKey,
        upperKey,
      );
      const existing = indexReads.get(key);
      if (existing !== undefined) return existing;
      const read: InvokeSessionIndexReadRecord = {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        indexId: input.indexId,
        lowerKey,
        upperKey,
        observedTs: input.observedTs,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
      indexReads.set(key, read);
      return read;
    },
    async listInvokeSessionIndexReads(deploymentId: string, sessionId: string) {
      return Array.from(indexReads.values())
        .filter(
          (read) =>
            read.deploymentId === deploymentId && read.sessionId === sessionId,
        )
        .sort(
          (left, right) =>
            left.indexId - right.indexId ||
            left.lowerKey.localeCompare(right.lowerKey) ||
            left.upperKey.localeCompare(right.upperKey),
        );
    },
    async stageInvokeSessionDocumentWrite(
      input: StageInvokeSessionDocumentWriteInput,
    ) {
      const key = documentWriteKey(
        input.deploymentId,
        input.sessionId,
        input.tableId,
        input.documentId,
      );
      if (documentWrites.has(key)) {
        const existing = documentWrites.get(key)!;
        const coalesced = coalesceDocumentWrite(existing, input);
        if (coalesced === null) {
          documentWrites.delete(key);
          return {
            ...existing,
            op: input.op,
            valueJson: input.valueJson ?? null,
          };
        }
        const updated = {
          ...existing,
          op: coalesced.op,
          valueJson: coalesced.valueJson,
        };
        documentWrites.set(key, updated);
        return updated;
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
    async commitInvokeSessionWrites(input: CommitInvokeSessionWritesInput) {
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
      const committedWrites: CommitInvokeSessionWritesResult["writes"] = [];
      const commitSession = invokeSessions.get(
        sessionKey(input.deploymentId, input.sessionId),
      );
      const deploymentPackage =
        commitSession === undefined
          ? undefined
          : packages.get(packageKey(input.deploymentId, commitSession.packageId));
      const tableValidators =
        deploymentPackage === undefined
          ? []
          : schemaTableValidatorsFromAnalysis(deploymentPackage.analysisJson);
      for (const read of documentReads.values()) {
        if (
          read.deploymentId !== input.deploymentId ||
          read.sessionId !== input.sessionId
        ) {
          continue;
        }
        const current = latestDocumentAt(
          [...documentRevisions, ...committedDocuments],
          input.deploymentId,
          read.documentId,
          committedTs,
        );
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
      for (const read of tableReads.values()) {
        if (
          read.deploymentId !== input.deploymentId ||
          read.sessionId !== input.sessionId
        ) {
          continue;
        }
        const changed = [...documentRevisions, ...committedDocuments].some(
          (document) =>
            document.deploymentId === input.deploymentId &&
            document.tableId === read.tableId &&
            document.ts > read.observedTs &&
            document.ts < committedTs,
        );
        if (changed) {
          throw new InvokeSessionTableOccConflictError(
            input.deploymentId,
            read.tableId,
            read.observedTs,
            committedTs - 1,
          );
        }
      }
      for (const write of writes) {
        if (write.op === "insert") {
          const existing = latestDocumentAt(
            [...documentRevisions, ...committedDocuments],
            input.deploymentId,
            write.documentId,
            committedTs,
          );
          if (existing !== null) {
            throw new InvokeSessionInsertConflictError(
              input.deploymentId,
              write.documentId,
            );
          }
          const value = write.valueJson as DocumentRevisionRecord["value"];
          validateDocumentValue(
            tableValidators,
            write.tableId,
            write.documentId,
            value,
          );
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
          continue;
        }

        if (write.op === "patch") {
          const current = latestDocumentAt(
            [...documentRevisions, ...committedDocuments],
            input.deploymentId,
            write.documentId,
            committedTs,
          );
          if (current === null || current.deleted) {
            throw new InvokeSessionPatchTargetError(
              input.deploymentId,
              write.documentId,
              "document does not exist",
            );
          }
          if (!isJsonObject(current.value)) {
            throw new InvokeSessionPatchTargetError(
              input.deploymentId,
              write.documentId,
              "current document value is not an object",
            );
          }
          if (!isJsonObject(write.valueJson)) {
            throw new InvokeSessionPatchTargetError(
              input.deploymentId,
              write.documentId,
              "patch value is not an object",
            );
          }
          const value = { ...current.value, ...write.valueJson };
          validateDocumentValue(
            tableValidators,
            write.tableId,
            write.documentId,
            value,
          );
          committedDocuments.push({
            deploymentId: input.deploymentId,
            id: write.documentId,
            tableId: write.tableId,
            documentId: write.documentId.slice(`${write.tableId}:`.length),
            ts: committedTs,
            value,
            deleted: false,
            prevTs: current.ts,
          });
          committedWrites.push({
            tableId: write.tableId,
            id: write.documentId,
            prevTs: current.ts,
            ts: committedTs,
            value,
          });
          continue;
        }

        if (write.op === "replace") {
          const current = latestDocumentAt(
            [...documentRevisions, ...committedDocuments],
            input.deploymentId,
            write.documentId,
            committedTs,
          );
          if (current === null || current.deleted) {
            throw new InvokeSessionReplaceTargetError(
              input.deploymentId,
              write.documentId,
              "document does not exist",
            );
          }
          const value = write.valueJson as DocumentRevisionRecord["value"];
          validateDocumentValue(
            tableValidators,
            write.tableId,
            write.documentId,
            value,
          );
          committedDocuments.push({
            deploymentId: input.deploymentId,
            id: write.documentId,
            tableId: write.tableId,
            documentId: write.documentId.slice(`${write.tableId}:`.length),
            ts: committedTs,
            value,
            deleted: false,
            prevTs: current.ts,
          });
          committedWrites.push({
            tableId: write.tableId,
            id: write.documentId,
            prevTs: current.ts,
            ts: committedTs,
            value,
          });
          continue;
        }

        if (write.op === "delete") {
          const current = latestDocumentAt(
            [...documentRevisions, ...committedDocuments],
            input.deploymentId,
            write.documentId,
            committedTs,
          );
          if (current === null || current.deleted) {
            throw new InvokeSessionDeleteTargetError(
              input.deploymentId,
              write.documentId,
              "document does not exist",
            );
          }
          committedDocuments.push({
            deploymentId: input.deploymentId,
            id: write.documentId,
            tableId: write.tableId,
            documentId: write.documentId.slice(`${write.tableId}:`.length),
            ts: committedTs,
            value: null,
            deleted: true,
            prevTs: current.ts,
          });
          committedWrites.push({
            tableId: write.tableId,
            id: write.documentId,
            prevTs: current.ts,
            ts: committedTs,
            value: null,
          });
          continue;
        }

        throw new InvokeSessionUnsupportedStagedWriteError(write.op);
      }
      commits.push({ deploymentId: input.deploymentId, ts: committedTs });
      outboxEvents.push({
        deploymentId: input.deploymentId,
        ts: committedTs,
        sequence: 0,
        event: commitOutboxEvent({
          deploymentId: input.deploymentId,
          commitTs: committedTs,
          source: input.source,
          writes: committedWrites,
        }),
        deliveredAt: null,
      });
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
    async insertOutboxEvent(input: InsertOutboxEventInput) {
      const event: OutboxEventRecord = {
        deploymentId: input.deploymentId,
        ts: input.ts,
        sequence: input.sequence,
        event: input.event,
        deliveredAt: null,
      };
      outboxEvents.push(event);
      return event;
    },
    async listOutboxEvents(
      input: ListOutboxEventsInput,
    ): Promise<ListOutboxEventsResult> {
      return listOutboxEventsInternal(outboxEvents, input, false);
    },
    async listUndeliveredOutboxEvents(
      input: ListUndeliveredOutboxEventsInput,
    ): Promise<ListOutboxEventsResult> {
      return listOutboxEventsInternal(outboxEvents, input, true);
    },
    async markOutboxEventsDelivered(
      input: MarkOutboxEventsDeliveredInput,
    ): Promise<MarkOutboxEventsDeliveredResult> {
      const eventKeys = new Set(
        input.events.map((event) => `${event.ts}:${event.sequence}`),
      );
      let delivered = 0;
      for (let index = 0; index < outboxEvents.length; index += 1) {
        const event = outboxEvents[index]!;
        if (
          event.deploymentId === input.deploymentId &&
          event.deliveredAt === null &&
          eventKeys.has(`${event.ts}:${event.sequence}`)
        ) {
          outboxEvents[index] = {
            ...event,
            deliveredAt: input.deliveredAt,
          };
          delivered += 1;
        }
      }
      return { delivered };
    },
    async upsertLiveQuerySubscription(
      input: UpsertLiveQuerySubscriptionInput,
    ): Promise<LiveQuerySubscriptionRecord> {
      const key = liveQuerySubscriptionKey(input);
      const existing = liveQuerySubscriptions.get(key);
      const now = input.updatedAt ?? new Date("2026-06-20T00:00:00.000Z");
      const subscription: LiveQuerySubscriptionRecord = {
        deploymentId: input.deploymentId,
        connectionId: input.connectionId,
        queryId: input.queryId,
        functionPath: input.functionPath,
        argsJson: input.argsJson,
        partitionKey: input.partitionKey ?? null,
        beginTs: input.beginTs,
        readSetJson: input.readSetJson,
        resultJson: input.resultJson,
        resultHash: input.resultHash,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      liveQuerySubscriptions.set(key, subscription);
      return subscription;
    },
    async recordLiveQueryRerunResult(
      input: RecordLiveQueryRerunResultInput,
    ): Promise<RecordLiveQueryRerunResultResult> {
      const subscription = await this.upsertLiveQuerySubscription(input);
      const delivery =
        input.delivery === undefined
          ? null
          : liveQueryDelivery(input.delivery);
      if (delivery !== null) {
        liveQueryDeliveries.push(delivery);
      }
      return {
        subscription,
        delivery,
      };
    },
    async deleteLiveQuerySubscription(
      input: LiveQuerySubscriptionKey,
    ): Promise<{ deleted: number }> {
      const deleted = liveQuerySubscriptions.delete(
        liveQuerySubscriptionKey(input),
      );
      return { deleted: deleted ? 1 : 0 };
    },
    async listLiveQuerySubscriptions(
      input: ListLiveQuerySubscriptionsInput,
    ): Promise<LiveQuerySubscriptionRecord[]> {
      return Array.from(liveQuerySubscriptions.values())
        .filter(
          (subscription) =>
            subscription.deploymentId === input.deploymentId &&
            (input.connectionId === undefined ||
              subscription.connectionId === input.connectionId),
        )
        .sort(
          (left, right) =>
            left.connectionId.localeCompare(right.connectionId) ||
            left.queryId - right.queryId,
        );
    },
    async listUndeliveredLiveQueryDeliveries(
      input: ListUndeliveredLiveQueryDeliveriesInput,
    ): Promise<ListUndeliveredLiveQueryDeliveriesResult> {
      const sorted = liveQueryDeliveries
        .filter(
          (delivery) =>
            delivery.deploymentId === input.deploymentId &&
            delivery.deliveredAt === null &&
            (input.cursor === undefined ||
              delivery.createdAt > input.cursor.createdAt ||
              (delivery.createdAt.getTime() ===
                input.cursor.createdAt.getTime() &&
                delivery.deliveryId > input.cursor.deliveryId)),
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.deliveryId.localeCompare(right.deliveryId),
        );
      const rows = sorted.slice(0, input.limit + 1);
      const deliveries = rows.slice(0, input.limit);
      const hasMore = rows.length > input.limit;
      const last = deliveries.at(-1);
      return {
        deliveries,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? {
                createdAt: last.createdAt,
                deliveryId: last.deliveryId,
              }
            : null,
      };
    },
    async markLiveQueryDeliveriesDelivered(
      input: MarkLiveQueryDeliveriesDeliveredInput,
    ): Promise<MarkLiveQueryDeliveriesDeliveredResult> {
      const deliveryIds = new Set(input.deliveryIds);
      let delivered = 0;
      for (let index = 0; index < liveQueryDeliveries.length; index += 1) {
        const delivery = liveQueryDeliveries[index]!;
        if (
          delivery.deploymentId === input.deploymentId &&
          delivery.deliveredAt === null &&
          deliveryIds.has(delivery.deliveryId)
        ) {
          liveQueryDeliveries[index] = {
            ...delivery,
            deliveredAt: input.deliveredAt,
          };
          delivered += 1;
        }
      }
      return { delivered };
    },
  };
}

function listOutboxEventsInternal(
  outboxEvents: OutboxEventRecord[],
  input: ListOutboxEventsInput | ListUndeliveredOutboxEventsInput,
  undeliveredOnly: boolean,
): ListOutboxEventsResult {
  const sorted = outboxEvents
    .filter(
      (event) =>
        event.deploymentId === input.deploymentId &&
        (!undeliveredOnly || event.deliveredAt === null) &&
        (input.cursor === undefined ||
          event.ts > input.cursor.ts ||
          (event.ts === input.cursor.ts &&
            event.sequence > input.cursor.sequence)),
    )
    .sort(
      (left, right) => left.ts - right.ts || left.sequence - right.sequence,
    );
  const rows = sorted.slice(0, input.limit + 1);
  const events = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;
  const last = events.at(-1);
  return {
    events,
    hasMore,
    nextCursor:
      hasMore && last !== undefined
        ? {
            ts: last.ts,
            sequence: last.sequence,
          }
        : null,
  };
}

function liveQuerySubscriptionKey(input: {
  deploymentId: string;
  connectionId: string;
  queryId: number;
}): string {
  return `${input.deploymentId}:${input.connectionId}:${input.queryId}`;
}

function liveQueryDelivery(input: {
  deploymentId: string;
  deliveryId: string;
  connectionId: string;
  queryId: number;
  payloadJson: unknown;
  createdAt?: Date;
}): LiveQueryDeliveryRecord {
  return {
    deploymentId: input.deploymentId,
    deliveryId: input.deliveryId,
    connectionId: input.connectionId,
    queryId: input.queryId,
    payloadJson: input.payloadJson,
    deliveredAt: null,
    createdAt: input.createdAt ?? new Date("2026-06-20T00:00:00.000Z"),
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

function tableReadKey(
  deploymentId: string,
  sessionId: string,
  tableId: number,
): string {
  return `${deploymentId}/${sessionId}/${tableId}`;
}

function indexReadKey(
  deploymentId: string,
  sessionId: string,
  indexId: number,
  lowerKey: string,
  upperKey: string,
): string {
  return `${deploymentId}/${sessionId}/${indexId}/${lowerKey}/${upperKey}`;
}

function documentWriteKey(
  deploymentId: string,
  sessionId: string,
  tableId: number,
  documentId: string,
): string {
  return `${deploymentId}/${sessionId}/${tableId}/${documentId}`;
}

function latestDocumentAt(
  documents: DocumentRevisionRecord[],
  deploymentId: string,
  id: string,
  ts: number,
): DocumentRevisionRecord | null {
  return (
    documents
      .filter(
        (document) =>
          document.deploymentId === deploymentId &&
          document.id === id &&
          document.ts <= ts,
      )
      .sort((left, right) => right.ts - left.ts)[0] ?? null
  );
}

function coalesceDocumentWrite(
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
): { op: InvokeSessionDocumentWriteRecord["op"]; valueJson: unknown } | null {
  if (existing.op === "insert") {
    if (input.op === "patch") {
      return {
        op: "insert",
        valueJson: mergeJsonObjects(existing.valueJson, input.valueJson, existing, input),
      };
    }
    if (input.op === "replace") {
      return { op: "insert", valueJson: input.valueJson ?? null };
    }
    if (input.op === "delete") {
      return null;
    }
    if (input.op === "insert") {
      throw new InvokeSessionDocumentWriteAlreadyExistsError(
        input.deploymentId,
        input.sessionId,
        input.documentId,
      );
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "patch") {
    if (input.op === "patch") {
      return {
        op: "patch",
        valueJson: mergeJsonObjects(existing.valueJson, input.valueJson, existing, input),
      };
    }
    if (input.op === "replace") {
      return { op: "replace", valueJson: input.valueJson ?? null };
    }
    if (input.op === "delete") {
      return { op: "delete", valueJson: null };
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "replace") {
    if (input.op === "patch") {
      return {
        op: "replace",
        valueJson: mergeJsonObjects(existing.valueJson, input.valueJson, existing, input),
      };
    }
    if (input.op === "replace") {
      return { op: "replace", valueJson: input.valueJson ?? null };
    }
    if (input.op === "delete") {
      return { op: "delete", valueJson: null };
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "delete") {
    throw writeConflict(existing, input);
  }

  throw writeConflict(existing, input);
}

function mergeJsonObjects(
  left: unknown,
  right: unknown,
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
) {
  if (!isJsonObject(left) || !isJsonObject(right)) {
    throw writeConflict(existing, input);
  }
  return { ...left, ...right };
}

function writeConflict(
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
) {
  return new InvokeSessionDocumentWriteConflictError(
    input.deploymentId,
    input.sessionId,
    input.documentId,
    existing.op,
    input.op,
  );
}

function getField(
  value: DocumentRevisionRecord["value"],
  field: string,
): DocumentRevisionRecord["value"] | undefined {
  if (!isJsonObject(value)) return undefined;
  let cursor: DocumentRevisionRecord["value"] | undefined = value;
  for (const segment of field.split(".")) {
    if (!isJsonObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function keyInRange(key: string, lower?: string, upper?: string): boolean {
  return (lower === undefined || key >= lower) && (upper === undefined || key < upper);
}

function cursorAllows(
  key: string,
  cursor: string | undefined,
  order: "asc" | "desc" | undefined,
): boolean {
  if (cursor === undefined) return true;
  return order === "desc" ? key < cursor : key > cursor;
}

function isJsonObject(
  value: unknown,
): value is Record<string, DocumentRevisionRecord["value"]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
