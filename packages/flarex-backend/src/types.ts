import type { ExecutionArtifactRef } from "flarex/artifacts";
export type { ExecutionArtifactRef } from "flarex/artifacts";

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
  EXECUTIONS: DurableObjectNamespace;
  CONNECTIONS: DurableObjectNamespace;
  SCHEDULERS: DurableObjectNamespace;
  FLAREX_ANALYZER?: Fetcher;
  FLAREX_ARTIFACT_RUNTIME?: Fetcher;
  FLAREX_ARTIFACT_RUNTIME_TOKEN?: string;
  FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE?: string;
  ARTIFACTS?: R2Bucket;
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
export type FunctionRoutePolicy = { type: "args"; field: string };
export type FunctionPartitionPolicy = {
  type: "partition";
  table: string;
  selector: string;
  partitionField: string;
  argField: string;
};

export type FunctionExecutionScope =
  {
    kind: "partition";
    table: string;
    selector: string;
    partitionField: string;
    argField: string;
    partitionKey: string;
  };

export type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};

export type DeploymentFunctionMetadata = {
  path: string;
  kind: DeploymentFunctionKind;
  visibility?: FunctionVisibility;
  args?: ValidatorJson | null;
  returns?: ValidatorJson | null;
  route?: FunctionRoutePolicy | null;
  partition?: FunctionPartitionPolicy | null;
  position?: AnalyzedSourcePosition;
};

export type DeploymentFunctions = {
  functions: DeploymentFunctionMetadata[];
};

export type PushSourceModule = {
  path: string;
  environment: "isolate";
  sha256: string;
  source?: string;
  sourceMap?: string;
};

export type PushSourcePackage = {
  modules: PushSourceModule[];
  functions: string[];
  schema?: string;
  execution: string;
};

export type DeploymentAnalysis = {
  schema: DeploymentSchema;
  functions: DeploymentFunctions;
};

export type PushDiagnostic = {
  level: "log" | "warn" | "error";
  message: string;
};

export type DeploymentCodegenFunction = {
  moduleName: string;
  exportName: string;
  kind: DeploymentFunctionKind;
  visibility: FunctionVisibility;
  args: ValidatorJson;
  returns: ValidatorJson | null;
  route?: FunctionRoutePolicy | null;
  partition?: FunctionPartitionPolicy | null;
  position?: AnalyzedSourcePosition;
};

export type DeploymentCodegenModule = {
  moduleName: string;
  functions: DeploymentCodegenFunction[];
};

export type DeploymentCodegenAnalysis = {
  schema: DeploymentSchema;
  functions: DeploymentCodegenModule[];
};

export type PushState =
  | "pending"
  | "analyzed"
  | "failed"
  | "activated"
  | "superseded";

export type StartPushRequest = {
  sourcePackage: PushSourcePackage;
};

export type AnalyzedStartPushRequest = StartPushRequest &
  (
    | { analysis: DeploymentAnalysis; error?: never; diagnostics?: PushDiagnostic[] }
    | { analysis?: never; error: string; diagnostics?: PushDiagnostic[] }
  );

export type AnalyzeSourcePackageRequest = {
  deploymentId: string;
  sourcePackage: PushSourcePackage;
};

export type AnalyzeSourcePackageResponse =
  | { analysis: DeploymentAnalysis; error?: never; diagnostics?: PushDiagnostic[] }
  | { analysis?: never; error: string; diagnostics?: PushDiagnostic[] };

export type PushStatus = {
  pushId: string;
  state: PushState;
  sourcePackage: PushSourcePackage;
  analysis?: DeploymentAnalysis;
  codegenAnalysis?: DeploymentCodegenAnalysis;
  error?: string;
  diagnostics?: PushDiagnostic[];
  createdAt: number;
  updatedAt: number;
};

export type StartPushResponse = PushStatus;

export type ActiveDeploymentStatus = {
  activePushId: string;
  activatedAt: number;
  schemaVersion: number;
  executionArtifactRef: ExecutionArtifactRef;
  sourcePackage: PushSourcePackage;
  analysis: DeploymentAnalysis;
  codegenAnalysis: DeploymentCodegenAnalysis;
};

export type FinishPushRequest = {
  activate?: boolean;
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
  readTs?: number;
  committedTs?: number;
  writes?: CommittedWrite[];
};

export type ExecutionStartRequest = InvokeRequest & {
  deploymentId: string;
};

export type ExecutionStartResponse = {
  beginTs: number;
  schemaVersion: number;
  kind: BackendFunctionKind;
};

export type ExecutionSyscallRequest =
  | { op: "get"; id: string }
  | {
      op: "query";
      request: {
        table: string;
        index?: string;
        range?: {
          expressions: Array<{
            op: "eq" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value: Json;
          }>;
        };
        limit?: number;
        cursor?: string;
        order?: "asc" | "desc";
      };
    }
  | { op: "insert"; table: string; value: Json; id?: string }
  | { op: "patch"; id: string; value: { [key: string]: Json } }
  | { op: "delete"; id: string };

export type ExecutionFinishRequest = {
  value: Json;
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
