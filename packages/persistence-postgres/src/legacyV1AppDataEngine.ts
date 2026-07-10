import {
  LegacyV1StorageGenerationSchema,
  type LegacyV1StorageGeneration,
} from "flarex-protocol/storage-authority";

import type {
  CommitInvokeSessionWritesInput,
  CommitInvokeSessionWritesResult,
} from "./commits";
import type { DocumentRevisionRecord } from "./documents";
import type {
  IndexedDocumentPage,
  ListDocumentsInIndexAtTsInput,
} from "./indexEntries";
import type {
  InsertInvokeSessionDocumentReadInput,
  InvokeSessionDocumentReadRecord,
} from "./invokeSessionReads";
import type {
  InsertInvokeSessionIndexReadInput,
  InvokeSessionIndexReadRecord,
} from "./invokeSessionIndexReads";
import type {
  InsertInvokeSessionTableReadInput,
  InvokeSessionTableReadRecord,
} from "./invokeSessionTableReads";
import type {
  InvokeSessionDocumentWriteRecord,
  StageInvokeSessionDocumentWriteInput,
} from "./invokeSessionWrites";

export interface LegacyV1AppDataStore {
  getDocumentRevisionAtTs(
    deploymentId: string,
    id: string,
    ts: number,
  ): Promise<DocumentRevisionRecord | null>;
  listDocumentsInTableAtTs(
    deploymentId: string,
    tableId: number,
    ts: number,
    limit?: number,
  ): Promise<DocumentRevisionRecord[]>;
  listDocumentsInIndexAtTs(
    input: ListDocumentsInIndexAtTsInput,
  ): Promise<IndexedDocumentPage>;
  insertInvokeSessionDocumentRead(
    input: InsertInvokeSessionDocumentReadInput,
  ): Promise<InvokeSessionDocumentReadRecord>;
  listInvokeSessionDocumentReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentReadRecord[]>;
  insertInvokeSessionTableRead(
    input: InsertInvokeSessionTableReadInput,
  ): Promise<InvokeSessionTableReadRecord>;
  listInvokeSessionTableReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionTableReadRecord[]>;
  insertInvokeSessionIndexRead(
    input: InsertInvokeSessionIndexReadInput,
  ): Promise<InvokeSessionIndexReadRecord>;
  listInvokeSessionIndexReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionIndexReadRecord[]>;
  stageInvokeSessionDocumentWrite(
    input: StageInvokeSessionDocumentWriteInput,
  ): Promise<InvokeSessionDocumentWriteRecord>;
  listInvokeSessionDocumentWrites(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentWriteRecord[]>;
  commitInvokeSessionWrites(
    input: CommitInvokeSessionWritesInput,
  ): Promise<CommitInvokeSessionWritesResult>;
}

export interface LegacyV1AppDataEngine extends LegacyV1AppDataStore {
  readonly storageGeneration: LegacyV1StorageGeneration;
}

const legacyV1StorageGeneration =
  LegacyV1StorageGenerationSchema.make("legacy_v1");

export function createLegacyV1AppDataEngine(
  store: LegacyV1AppDataStore,
): LegacyV1AppDataEngine {
  const engine = {
    storageGeneration: legacyV1StorageGeneration,
    getDocumentRevisionAtTs: (deploymentId, id, ts) =>
      store.getDocumentRevisionAtTs(deploymentId, id, ts),
    listDocumentsInTableAtTs: (deploymentId, tableId, ts, limit) =>
      store.listDocumentsInTableAtTs(deploymentId, tableId, ts, limit),
    listDocumentsInIndexAtTs: (input) => store.listDocumentsInIndexAtTs(input),
    insertInvokeSessionDocumentRead: (input) =>
      store.insertInvokeSessionDocumentRead(input),
    listInvokeSessionDocumentReads: (deploymentId, sessionId) =>
      store.listInvokeSessionDocumentReads(deploymentId, sessionId),
    insertInvokeSessionTableRead: (input) =>
      store.insertInvokeSessionTableRead(input),
    listInvokeSessionTableReads: (deploymentId, sessionId) =>
      store.listInvokeSessionTableReads(deploymentId, sessionId),
    insertInvokeSessionIndexRead: (input) =>
      store.insertInvokeSessionIndexRead(input),
    listInvokeSessionIndexReads: (deploymentId, sessionId) =>
      store.listInvokeSessionIndexReads(deploymentId, sessionId),
    stageInvokeSessionDocumentWrite: (input) =>
      store.stageInvokeSessionDocumentWrite(input),
    listInvokeSessionDocumentWrites: (deploymentId, sessionId) =>
      store.listInvokeSessionDocumentWrites(deploymentId, sessionId),
    commitInvokeSessionWrites: (input) => store.commitInvokeSessionWrites(input),
  } satisfies LegacyV1AppDataEngine;

  return engine;
}
