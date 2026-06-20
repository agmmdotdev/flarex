import type { SQLWrapper } from "drizzle-orm";
import type {
  CommitInvokeSessionWritesInput,
  CommitInvokeSessionWritesResult,
} from "./commits";
import type {
  DeploymentPackageMetadataRecord,
  InsertDeploymentPackageMetadataInput,
} from "./deploymentPackages";
import type {
  ListDeploymentMetadataInput,
  ListDeploymentMetadataResult,
  DeploymentMetadataRecord,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "./deployments";
import type {
  DocumentRevisionRecord,
  InsertDocumentRevisionInput,
} from "./documents";
import type {
  AbortInvokeSessionMetadataInput,
  AbortStaleInvokeSessionsMetadataInput,
  AbortStaleInvokeSessionsMetadataResult,
  FinishInvokeSessionMetadataInput,
  InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataRecord,
} from "./invokeSessions";
import type {
  InsertInvokeSessionDocumentReadInput,
  InvokeSessionDocumentReadRecord,
} from "./invokeSessionReads";
import type {
  InsertInvokeSessionTableReadInput,
  InvokeSessionTableReadRecord,
} from "./invokeSessionTableReads";
import type {
  InsertInvokeSessionIndexReadInput,
  InvokeSessionIndexReadRecord,
} from "./invokeSessionIndexReads";
import type {
  InsertInvokeSessionDocumentWriteInput,
  InvokeSessionDocumentWriteRecord,
} from "./invokeSessionWrites";
import type {
  IndexedDocumentPage,
  ListDocumentsInIndexAtTsInput,
} from "./indexEntries";
export { sql } from "drizzle-orm";

export interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface FlarexSqlClient {
  execute<Row extends Record<string, unknown> = Record<string, unknown>>(
    query: SQLWrapper | string,
  ): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface FlarexPersistenceTx extends FlarexSqlClient {}

export interface FlarexPersistence extends FlarexSqlClient {
  check(): Promise<FlarexPersistenceCheck>;
  insertDeploymentPackageMetadata(
    input: InsertDeploymentPackageMetadataInput,
  ): Promise<DeploymentPackageMetadataRecord>;
  getDeploymentPackageMetadata(
    deploymentId: string,
    packageId: string,
  ): Promise<DeploymentPackageMetadataRecord | null>;
  insertDeploymentMetadata(
    input: InsertDeploymentMetadataInput,
  ): Promise<DeploymentMetadataRecord>;
  getDeploymentMetadata(
    deploymentId: string,
  ): Promise<DeploymentMetadataRecord | null>;
  listDeploymentMetadata(
    input: ListDeploymentMetadataInput,
  ): Promise<ListDeploymentMetadataResult>;
  updateDeploymentMetadataActivation(
    input: UpdateDeploymentMetadataActivationInput,
  ): Promise<DeploymentMetadataRecord | null>;
  insertInvokeSessionMetadata(
    input: InsertInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord>;
  getInvokeSessionMetadata(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionMetadataRecord | null>;
  finishInvokeSessionMetadata(
    input: FinishInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord | null>;
  abortInvokeSessionMetadata(
    input: AbortInvokeSessionMetadataInput,
  ): Promise<InvokeSessionMetadataRecord | null>;
  abortStaleInvokeSessionsMetadata(
    input: AbortStaleInvokeSessionsMetadataInput,
  ): Promise<AbortStaleInvokeSessionsMetadataResult>;
  insertDocumentRevision(
    input: InsertDocumentRevisionInput,
  ): Promise<DocumentRevisionRecord>;
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
  insertInvokeSessionDocumentWrite(
    input: InsertInvokeSessionDocumentWriteInput,
  ): Promise<InvokeSessionDocumentWriteRecord>;
  listInvokeSessionDocumentWrites(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentWriteRecord[]>;
  commitInvokeSessionWrites(
    input: CommitInvokeSessionWritesInput,
  ): Promise<CommitInvokeSessionWritesResult>;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export * from "./deploymentPackages";
export * from "./deployments";
export * from "./documents";
export * from "./commits";
export * from "./indexEntries";
export * from "./invokeSessions";
export * from "./invokeSessionReads";
export * from "./invokeSessionTableReads";
export * from "./invokeSessionIndexReads";
export * from "./invokeSessionWrites";
export * from "./validation";
export { flarexSchema } from "./schema";
export * from "./schema";
