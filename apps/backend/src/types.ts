export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ValidatorJson =
  | { type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { type: "id"; tableName: string }
  | { type: "literal"; value: string | number | boolean }
  | { type: "array"; value: ValidatorJson }
  | { type: "object"; value: Record<string, { fieldType: ValidatorJson; optional: boolean }> }
  | { type: "record"; keys: ValidatorJson; values: ValidatorJson }
  | { type: "union"; value: ValidatorJson[] };

export type Env = {
  REGISTRY: DurableObjectNamespace;
  DEPLOYMENTS: DurableObjectNamespace;
  PARTITIONS: DurableObjectNamespace;
  CONNECTIONS: DurableObjectNamespace;
  SCHEDULERS: DurableObjectNamespace;
};

export type TablePlacement =
  | { kind: "partitionBy"; field: string }
  | { kind: "colocateWith"; table: string; field: string }
  | { kind: "global" };

export type SchemaTable = {
  tableId: number;
  name: string;
  state?: "active" | "hidden" | "deleted";
  validator?: ValidatorJson | null;
  placement: TablePlacement;
};

export type SchemaIndex = {
  indexId: number;
  tableId: number;
  name: string;
  fields: string[];
  state?: "enabled" | "staged" | "disabled";
};

export type DeploymentSchema = {
  version: number;
  tables: SchemaTable[];
  indexes: SchemaIndex[];
};

export type DeploymentRecord = {
  deploymentId: string;
  slug?: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
};

export type DocumentRead = {
  tableId: number;
  id: string;
};

export type TableRead = {
  tableId: number;
};

export type IndexRead = {
  indexId: number;
  lower?: string;
  upper?: string;
};

export type ReadSet = {
  documents?: DocumentRead[];
  tables?: TableRead[];
  indexes?: IndexRead[];
};

export type DocumentWrite = {
  tableId: number;
  id?: string;
  value: Json | null;
};

export type CommitRequest = {
  beginTs: number;
  schemaVersion?: number;
  source?: string;
  idempotencyKey?: string;
  readSet?: ReadSet;
  writes: DocumentWrite[];
};

export type CommittedWrite = {
  tableId: number;
  id: string;
  prevTs: number | null;
  ts: number;
  value: Json | null;
};

export type IndexWrite = {
  indexId: number;
  key: string;
  documentId: string;
  deleted: boolean;
};

export type CommitResponse = {
  committedTs: number;
  writes: CommittedWrite[];
  replayed?: boolean;
};

export type BackendFunctionKind = "query" | "mutation";
export type DeploymentFunctionKind =
  | BackendFunctionKind
  | "action"
  | "workflowMutation";
export type FunctionVisibility = "public" | "internal";

export type DeploymentFunctionMetadata = {
  path: string;
  kind: DeploymentFunctionKind;
  visibility?: FunctionVisibility;
  args?: ValidatorJson | null;
  returns?: ValidatorJson | null;
};

export type DeploymentFunctions = {
  functions: DeploymentFunctionMetadata[];
};

export type InvokeRequest = {
  path: string;
  args: Json;
  partitionKey: string;
  kind?: BackendFunctionKind;
  idempotencyKey?: string;
};

export type InvokeResponse = {
  value: Json;
  readSet?: ReadSet;
  committedTs?: number;
  writes?: CommittedWrite[];
};

export type StoredDocument = {
  tableId: number;
  id: string;
  ts: number;
  value: Json;
};

export type BeginResponse = {
  beginTs: number;
  schemaVersion: number;
};

export type DocumentReadResponse = {
  document: StoredDocument | null;
  readSet: ReadSet;
};

export type IndexReadResponse = {
  entries: Array<{ key: string; document: StoredDocument }>;
  readSet: ReadSet;
  isDone: boolean;
  continueCursor: string;
};

export type OccConflict = {
  code: "OCC_CONFLICT";
  message: string;
  conflictingTs: number;
};
