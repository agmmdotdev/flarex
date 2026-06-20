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
  InsertInvokeSessionMetadataInput,
  InvokeSessionMetadataRecord,
} from "./invokeSessions";
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
  insertDocumentRevision(
    input: InsertDocumentRevisionInput,
  ): Promise<DocumentRevisionRecord>;
  getDocumentRevisionAtTs(
    deploymentId: string,
    id: string,
    ts: number,
  ): Promise<DocumentRevisionRecord | null>;
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
export { flarexSchema } from "./schema";
export * from "./schema";
