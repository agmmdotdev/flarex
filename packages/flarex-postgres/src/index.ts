import type { SQLWrapper } from "drizzle-orm";
import type {
  CreateDeploymentInput,
  DeploymentRecord,
} from "./deployments";
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
  createDeployment(input: CreateDeploymentInput): Promise<DeploymentRecord>;
  getDeployment(deploymentId: string): Promise<DeploymentRecord | null>;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}

export interface FlarexPersistenceCheck {
  status: "ok";
}

export * from "./deployments";
export { flarexSchema } from "./schema";
export * from "./schema";
