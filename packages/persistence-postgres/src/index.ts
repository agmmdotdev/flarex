import type { SQLWrapper } from "drizzle-orm";
import type {
  DeploymentPackageMetadataRecord,
  InsertDeploymentPackageMetadataInput,
} from "./deploymentPackages";
import type {
  DeploymentMetadataRecord,
  InsertDeploymentMetadataInput,
  UpdateDeploymentMetadataActivationInput,
} from "./deployments";
import type {
  DocumentRevisionRecord,
  InsertDocumentRevisionInput,
} from "./documents";
import type {
  FinishInvokeSessionMetadataInput,
  InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataRecord,
} from "./invokeSessions";
import type {
  InsertInvokeSessionDocumentReadInput,
  InvokeSessionDocumentReadRecord,
} from "./invokeSessionReads";
import type {
  InsertInvokeSessionDocumentWriteInput,
  InvokeSessionDocumentWriteRecord,
} from "./invokeSessionWrites";
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
  insertDocumentRevision(
    input: InsertDocumentRevisionInput,
  ): Promise<DocumentRevisionRecord>;
  getDocumentRevisionAtTs(
    deploymentId: string,
    id: string,
    ts: number,
  ): Promise<DocumentRevisionRecord | null>;
  insertInvokeSessionDocumentRead(
    input: InsertInvokeSessionDocumentReadInput,
  ): Promise<InvokeSessionDocumentReadRecord>;
  listInvokeSessionDocumentReads(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentReadRecord[]>;
  insertInvokeSessionDocumentWrite(
    input: InsertInvokeSessionDocumentWriteInput,
  ): Promise<InvokeSessionDocumentWriteRecord>;
  listInvokeSessionDocumentWrites(
    deploymentId: string,
    sessionId: string,
  ): Promise<InvokeSessionDocumentWriteRecord[]>;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export * from "./deploymentPackages";
export * from "./deployments";
export * from "./documents";
export * from "./invokeSessions";
export * from "./invokeSessionReads";
export * from "./invokeSessionWrites";
export { flarexSchema } from "./schema";
export * from "./schema";
