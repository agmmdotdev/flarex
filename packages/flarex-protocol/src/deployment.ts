import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export const DeploymentRoute = {
  health: "/health",
  activeDeployment: "/deployment",
  startAnalyzedPush: "/push/start-analyzed",
  push: "/push",
} as const;

export type DeploymentRoutePath = typeof DeploymentRoute[keyof typeof DeploymentRoute];

export const DeploymentPushAction = {
  finish: "finish",
  abandon: "abandon",
} as const;

export type DeploymentPushAction = typeof DeploymentPushAction[keyof typeof DeploymentPushAction];

export const DeploymentApiPath = {
  pushStatus: `${DeploymentRoute.push}/:pushId`,
} as const;

export class DeploymentPushParams extends Schema.Class<DeploymentPushParams>(
  "DeploymentPushParams",
)({
  pushId: Schema.String,
}) {}

const PushState = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("analyzed"),
  Schema.Literal("failed"),
  Schema.Literal("activated"),
  Schema.Literal("abandoned"),
  Schema.Literal("superseded"),
]);
const TableState = Schema.Union([
  Schema.Literal("active"),
  Schema.Literal("hidden"),
  Schema.Literal("deleted"),
]);
const IndexState = Schema.Union([
  Schema.Literal("enabled"),
  Schema.Literal("staged"),
  Schema.Literal("disabled"),
]);
const DeploymentFunctionKind = Schema.Union([
  Schema.Literal("query"),
  Schema.Literal("mutation"),
  Schema.Literal("action"),
  Schema.Literal("workflowMutation"),
]);
const FunctionVisibility = Schema.Union([
  Schema.Literal("public"),
  Schema.Literal("internal"),
]);
const FinishPushRejectionCode = Schema.Union([
  Schema.Literal("invalid_state"),
  Schema.Literal("missing_analysis"),
  Schema.Literal("missing_artifact"),
]);

export type ValidatorJson =
  | { readonly type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: string | number | boolean }
  | { readonly type: "array"; readonly value: ValidatorJson }
  | {
      readonly type: "object";
      readonly value: Readonly<Record<string, { readonly fieldType: ValidatorJson; readonly optional: boolean }>>;
    }
  | { readonly type: "record"; readonly keys: ValidatorJson; readonly values: ValidatorJson }
  | { readonly type: "union"; readonly value: ReadonlyArray<ValidatorJson> };

export const ValidatorJson: Schema.Codec<ValidatorJson> = Schema.suspend(() =>
  Schema.Union([
    Schema.Struct({
      type: Schema.Union([
        Schema.Literal("null"),
        Schema.Literal("number"),
        Schema.Literal("bigint"),
        Schema.Literal("boolean"),
        Schema.Literal("string"),
        Schema.Literal("bytes"),
        Schema.Literal("any"),
      ]),
    }),
    Schema.Struct({
      type: Schema.Literal("id"),
      tableName: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal("literal"),
      value: Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
    }),
    Schema.Struct({
      type: Schema.Literal("array"),
      value: ValidatorJson,
    }),
    Schema.Struct({
      type: Schema.Literal("object"),
      value: Schema.Record(Schema.String, Schema.Struct({
        fieldType: ValidatorJson,
        optional: Schema.Boolean,
      })),
    }),
    Schema.Struct({
      type: Schema.Literal("record"),
      keys: ValidatorJson,
      values: ValidatorJson,
    }),
    Schema.Struct({
      type: Schema.Literal("union"),
      value: Schema.Array(ValidatorJson),
    }),
  ]),
);

export class PushSourceModule extends Schema.Class<PushSourceModule>(
  "PushSourceModule",
)({
  path: Schema.String,
  environment: Schema.Literal("isolate"),
  sha256: Schema.String,
  source: Schema.optional(Schema.String),
  sourceMap: Schema.optional(Schema.String),
}) {}

export class DeploymentProtocolValidationError
  extends Schema.TaggedErrorClass<DeploymentProtocolValidationError>()(
    "DeploymentProtocolValidationError",
    {
      schema: Schema.String,
      message: Schema.String,
      cause: Schema.Defect(),
    },
  ) {}

export class DeploymentHealthResponse extends Schema.Class<DeploymentHealthResponse>(
  "DeploymentHealthResponse",
)({
  service: Schema.Literal("flarex-deployment"),
  status: Schema.Literal("ok"),
}) {}

export class AbandonPushRequest extends Schema.Class<AbandonPushRequest>(
  "AbandonPushRequest",
)({
  reason: Schema.optional(Schema.String),
}) {}

export class FinishPushRequest extends Schema.Class<FinishPushRequest>(
  "FinishPushRequest",
)({
  activate: Schema.optional(Schema.Boolean),
}) {}

export class PushSourcePackage extends Schema.Class<PushSourcePackage>(
  "PushSourcePackage",
)({
  modules: Schema.Array(PushSourceModule),
  functions: Schema.Array(Schema.String),
  schema: Schema.optional(Schema.String),
  execution: Schema.String,
}) {}

export class PushDiagnostic extends Schema.Class<PushDiagnostic>("PushDiagnostic")({
  level: Schema.Union([
    Schema.Literal("log"),
    Schema.Literal("warn"),
    Schema.Literal("error"),
  ]),
  message: Schema.String,
}) {}

export class TablePartitionPlacement extends Schema.Class<TablePartitionPlacement>(
  "TablePartitionPlacement",
)({
  kind: Schema.Literal("partitionBy"),
  field: Schema.String,
}) {}

export class TableColocationPlacement extends Schema.Class<TableColocationPlacement>(
  "TableColocationPlacement",
)({
  kind: Schema.Literal("colocateWith"),
  table: Schema.String,
  field: Schema.String,
}) {}

export class TableGlobalPlacement extends Schema.Class<TableGlobalPlacement>(
  "TableGlobalPlacement",
)({
  kind: Schema.Literal("global"),
}) {}

export const TablePlacement = Schema.Union([
  TablePartitionPlacement,
  TableColocationPlacement,
  TableGlobalPlacement,
]);

export class SchemaTable extends Schema.Class<SchemaTable>("SchemaTable")({
  tableId: Schema.Number,
  name: Schema.String,
  state: Schema.optional(TableState),
  validator: Schema.optional(Schema.Union([ValidatorJson, Schema.Null])),
  placement: TablePlacement,
}) {}

export class SchemaIndex extends Schema.Class<SchemaIndex>("SchemaIndex")({
  indexId: Schema.Number,
  tableId: Schema.Number,
  name: Schema.String,
  fields: Schema.Array(Schema.String),
  state: Schema.optional(IndexState),
}) {}

export class DeploymentSchema extends Schema.Class<DeploymentSchema>("DeploymentSchema")({
  version: Schema.Number,
  tables: Schema.Array(SchemaTable),
  indexes: Schema.Array(SchemaIndex),
}) {}

export class AnalyzedSourcePosition extends Schema.Class<AnalyzedSourcePosition>(
  "AnalyzedSourcePosition",
)({
  path: Schema.String,
  startLine: Schema.Number,
  startColumn: Schema.Number,
}) {}

export class FunctionRoutePolicy extends Schema.Class<FunctionRoutePolicy>(
  "FunctionRoutePolicy",
)({
  type: Schema.Literal("args"),
  field: Schema.String,
}) {}

export class FunctionPartitionPolicy extends Schema.Class<FunctionPartitionPolicy>(
  "FunctionPartitionPolicy",
)({
  type: Schema.Literal("partition"),
  table: Schema.String,
  selector: Schema.String,
  partitionField: Schema.String,
  argField: Schema.String,
}) {}

export class FunctionPartitionCreateRootPolicy extends Schema.Class<FunctionPartitionCreateRootPolicy>(
  "FunctionPartitionCreateRootPolicy",
)({
  type: Schema.Literal("partitionCreateRoot"),
  table: Schema.String,
  partitionField: Schema.Literal("_id"),
}) {}

export const FunctionPartitionMetadata = Schema.Union([
  FunctionPartitionPolicy,
  FunctionPartitionCreateRootPolicy,
]);

export class DeploymentFunctionMetadata extends Schema.Class<DeploymentFunctionMetadata>(
  "DeploymentFunctionMetadata",
)({
  path: Schema.String,
  kind: DeploymentFunctionKind,
  visibility: Schema.optional(FunctionVisibility),
  args: Schema.optional(Schema.Union([ValidatorJson, Schema.Null])),
  returns: Schema.optional(Schema.Union([ValidatorJson, Schema.Null])),
  route: Schema.optional(Schema.Union([FunctionRoutePolicy, Schema.Null])),
  partition: Schema.optional(Schema.Union([FunctionPartitionMetadata, Schema.Null])),
  position: Schema.optional(AnalyzedSourcePosition),
}) {}

export class DeploymentFunctions extends Schema.Class<DeploymentFunctions>(
  "DeploymentFunctions",
)({
  functions: Schema.Array(DeploymentFunctionMetadata),
}) {}

export class DeploymentAnalysis extends Schema.Class<DeploymentAnalysis>(
  "DeploymentAnalysis",
)({
  schema: DeploymentSchema,
  functions: DeploymentFunctions,
}) {}

export class DeploymentCodegenFunction extends Schema.Class<DeploymentCodegenFunction>(
  "DeploymentCodegenFunction",
)({
  moduleName: Schema.String,
  exportName: Schema.String,
  kind: DeploymentFunctionKind,
  visibility: FunctionVisibility,
  args: ValidatorJson,
  returns: Schema.Union([ValidatorJson, Schema.Null]),
  partition: Schema.optional(Schema.Union([FunctionPartitionMetadata, Schema.Null])),
  position: Schema.optional(AnalyzedSourcePosition),
}) {}

export class DeploymentCodegenModule extends Schema.Class<DeploymentCodegenModule>(
  "DeploymentCodegenModule",
)({
  moduleName: Schema.String,
  functions: Schema.Array(DeploymentCodegenFunction),
}) {}

export class DeploymentCodegenAnalysis extends Schema.Class<DeploymentCodegenAnalysis>(
  "DeploymentCodegenAnalysis",
)({
  schema: DeploymentSchema,
  functions: Schema.Array(DeploymentCodegenModule),
}) {}

export class AnalyzedStartPushRequest extends Schema.Class<AnalyzedStartPushRequest>(
  "AnalyzedStartPushRequest",
)({
  sourcePackage: Schema.Unknown,
  analysis: Schema.optional(Schema.Unknown),
  codegenAnalysis: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  diagnostics: Schema.optional(Schema.Unknown),
}) {}

export class PushStatus extends Schema.Class<PushStatus>("PushStatus")({
  pushId: Schema.String,
  state: PushState,
  sourcePackage: PushSourcePackage,
  analysis: Schema.optional(DeploymentAnalysis),
  codegenAnalysis: Schema.optional(DeploymentCodegenAnalysis),
  error: Schema.optional(Schema.String),
  diagnostics: Schema.optional(Schema.Array(PushDiagnostic)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class ActivatedFinishPushResponse extends Schema.Class<ActivatedFinishPushResponse>(
  "ActivatedFinishPushResponse",
)({
  result: Schema.Literal("activated"),
  push: PushStatus,
}) {}

export class RejectedFinishPushResponse extends Schema.Class<RejectedFinishPushResponse>(
  "RejectedFinishPushResponse",
)({
  result: Schema.Literal("rejected"),
  push: PushStatus,
  code: FinishPushRejectionCode,
  error: Schema.String,
  diagnostics: Schema.optional(Schema.Array(PushDiagnostic)),
}) {}

export const FinishPushResponse = Schema.Union([
  ActivatedFinishPushResponse,
  RejectedFinishPushResponse,
]);

export class ActiveDeploymentStatus extends Schema.Class<ActiveDeploymentStatus>(
  "ActiveDeploymentStatus",
)({
  activePushId: Schema.String,
  activatedAt: Schema.Number,
  schemaVersion: Schema.Number,
  executionArtifactRef: Schema.Struct({
    runtime: Schema.Literal("dynamic-worker"),
    artifactId: Schema.String,
    sourcePackageHash: Schema.String,
    executionModule: Schema.String,
  }),
  sourcePackage: PushSourcePackage,
  analysis: DeploymentAnalysis,
  codegenAnalysis: DeploymentCodegenAnalysis,
}) {}

export class DeploymentApiReadGroup extends HttpApiGroup.make("deployment", { topLevel: true }).add(
  HttpApiEndpoint.get("health", DeploymentRoute.health, {
    success: DeploymentHealthResponse,
  }),
  HttpApiEndpoint.get("getActiveDeployment", DeploymentRoute.activeDeployment, {
    success: ActiveDeploymentStatus,
  }),
  HttpApiEndpoint.get("getPush", DeploymentApiPath.pushStatus, {
    params: DeploymentPushParams,
    success: PushStatus,
  }),
) {}

export class DeploymentApi extends HttpApi.make("flarex-deployment").add(DeploymentApiReadGroup) {}

const decodeAbandonPushRequest = Schema.decodeUnknownSync(AbandonPushRequest);
const decodeAnalyzedStartPushRequest = Schema.decodeUnknownSync(AnalyzedStartPushRequest);
const decodeActiveDeploymentStatus = Schema.decodeUnknownSync(ActiveDeploymentStatus);
const decodeDeploymentHealthResponse = Schema.decodeUnknownSync(DeploymentHealthResponse);
const decodeDeploymentAnalysis = Schema.decodeUnknownSync(DeploymentAnalysis);
const decodeDeploymentCodegenAnalysis = Schema.decodeUnknownSync(DeploymentCodegenAnalysis);
const decodeFinishPushRequest = Schema.decodeUnknownSync(FinishPushRequest);
const decodeFinishPushResponse = Schema.decodeUnknownSync(FinishPushResponse);
const decodePushSourcePackage = Schema.decodeUnknownSync(PushSourcePackage);
const decodePushStatus = Schema.decodeUnknownSync(PushStatus);

export function parseAbandonPushRequest(value: unknown): AbandonPushRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeploymentProtocolValidationError({
      schema: "AbandonPushRequest",
      message: "Abandon push request must be an object.",
      cause: value,
    });
  }
  if ("reason" in value && value.reason !== undefined && typeof value.reason !== "string") {
    throw new DeploymentProtocolValidationError({
      schema: "AbandonPushRequest",
      message: "Abandon push reason must be a string.",
      cause: value.reason,
    });
  }
  try {
    return decodeAbandonPushRequest(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "AbandonPushRequest",
      message: "Abandon push request must include an optional string reason field.",
      cause,
    });
  }
}

export function parseFinishPushRequest(value: unknown): FinishPushRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeploymentProtocolValidationError({
      schema: "FinishPushRequest",
      message: "Finish push request must be an object.",
      cause: value,
    });
  }
  if ("activate" in value && value.activate !== undefined && typeof value.activate !== "boolean") {
    throw new DeploymentProtocolValidationError({
      schema: "FinishPushRequest",
      message: "Finish push activate flag must be a boolean.",
      cause: value.activate,
    });
  }
  try {
    return decodeFinishPushRequest(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "FinishPushRequest",
      message: "Finish push request must include an optional boolean activate field.",
      cause,
    });
  }
}

export function parsePushSourcePackage(value: unknown): PushSourcePackage {
  try {
    return decodePushSourcePackage(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "PushSourcePackage",
      message: "Source package must include modules, functions, and execution fields with valid module entries.",
      cause,
    });
  }
}

export function parseDeploymentAnalysis(value: unknown): DeploymentAnalysis {
  try {
    return decodeDeploymentAnalysis(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "DeploymentAnalysis",
      message: "Deployment analysis did not match the deployment protocol.",
      cause,
    });
  }
}

export function parseDeploymentCodegenAnalysis(value: unknown): DeploymentCodegenAnalysis {
  try {
    return decodeDeploymentCodegenAnalysis(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "DeploymentCodegenAnalysis",
      message: "Deployment codegen analysis did not match the deployment protocol.",
      cause,
    });
  }
}

export function parseDeploymentHealthResponse(value: unknown): DeploymentHealthResponse {
  try {
    return decodeDeploymentHealthResponse(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "DeploymentHealthResponse",
      message: "Deployment health response did not match the deployment protocol.",
      cause,
    });
  }
}

export function parseAnalyzedStartPushRequest(value: unknown): AnalyzedStartPushRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeploymentProtocolValidationError({
      schema: "AnalyzedStartPushRequest",
      message: "Analyzed start push request must be an object.",
      cause: value,
    });
  }
  if (!("sourcePackage" in value)) {
    throw new DeploymentProtocolValidationError({
      schema: "AnalyzedStartPushRequest",
      message: "Analyzed start push request must include sourcePackage.",
      cause: value,
    });
  }
  if ("diagnostics" in value && value.diagnostics !== undefined && !Array.isArray(value.diagnostics)) {
    throw new DeploymentProtocolValidationError({
      schema: "AnalyzedStartPushRequest",
      message: "Push diagnostics must be an array.",
      cause: value.diagnostics,
    });
  }
  try {
    const request = decodeAnalyzedStartPushRequest(value);
    if (request.analysis === undefined && (typeof request.error !== "string" || request.error.length === 0)) {
      throw new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "A push without analysis must include an error message.",
        cause: value,
      });
    }
    if (request.analysis === undefined && request.codegenAnalysis !== undefined) {
      throw new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "A push without analysis must not include codegenAnalysis.",
        cause: value,
      });
    }
    if (request.analysis !== undefined && request.error !== undefined) {
      throw new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "A push with analysis must not include error.",
        cause: value,
      });
    }
    return request;
  } catch (cause) {
    if (cause instanceof DeploymentProtocolValidationError) throw cause;
    throw new DeploymentProtocolValidationError({
      schema: "AnalyzedStartPushRequest",
      message: "Analyzed start push request must include a valid sourcePackage and optional analysis, codegenAnalysis, error, and diagnostics fields.",
      cause,
    });
  }
}

export function parseActiveDeploymentStatus(value: unknown): ActiveDeploymentStatus {
  try {
    return decodeActiveDeploymentStatus(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "ActiveDeploymentStatus",
      message: "Active deployment status response did not match the deployment protocol.",
      cause,
    });
  }
}

export function parsePushStatus(value: unknown): PushStatus {
  try {
    return decodePushStatus(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "PushStatus",
      message: "Push status response did not match the deployment protocol.",
      cause,
    });
  }
}

export function parseFinishPushResponse(value: unknown) {
  try {
    return decodeFinishPushResponse(value);
  } catch (cause) {
    throw new DeploymentProtocolValidationError({
      schema: "FinishPushResponse",
      message: "Finish push response did not match the deployment protocol.",
      cause,
    });
  }
}
