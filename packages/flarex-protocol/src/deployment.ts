import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { AuthConfigSchema } from "./auth";
import { ValidatorJson } from "./validator-json";

export { ValidatorJson } from "./validator-json";

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
  finishPush: `${DeploymentRoute.push}/:pushId/${DeploymentPushAction.finish}`,
  abandonPush: `${DeploymentRoute.push}/:pushId/${DeploymentPushAction.abandon}`,
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

export class DeploymentErrorResponse extends Schema.Class<DeploymentErrorResponse>(
  "DeploymentErrorResponse",
)({
  error: Schema.String,
}) {}

export class DeploymentBadRequestErrorResponse extends Schema.Class<DeploymentBadRequestErrorResponse>(
  "DeploymentBadRequestErrorResponse",
)({
  error: Schema.String,
}) {}

export class DeploymentNotFoundErrorResponse extends Schema.Class<DeploymentNotFoundErrorResponse>(
  "DeploymentNotFoundErrorResponse",
)({
  error: Schema.String,
}) {}

export class DeploymentConflictErrorResponse extends Schema.Class<DeploymentConflictErrorResponse>(
  "DeploymentConflictErrorResponse",
)({
  error: Schema.String,
}) {}

export class DeploymentStorageErrorResponse extends Schema.Class<DeploymentStorageErrorResponse>(
  "DeploymentStorageErrorResponse",
)({
  error: Schema.String,
}) {}

export const DeploymentBadRequestError = DeploymentBadRequestErrorResponse.pipe(HttpApiSchema.status(400));
export const DeploymentNotFoundError = DeploymentNotFoundErrorResponse.pipe(HttpApiSchema.status(404));
export const DeploymentConflictError = DeploymentConflictErrorResponse.pipe(HttpApiSchema.status(409));
export const DeploymentStorageError = DeploymentStorageErrorResponse.pipe(HttpApiSchema.status(500));

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

export const SOURCE_MODULE_DIGEST_FORMAT_V1 = "sha256-framed-v1" as const;

export class PushSourcePackage extends Schema.Class<PushSourcePackage>(
  "PushSourcePackage",
)({
  modules: Schema.Array(PushSourceModule),
  functions: Schema.Array(Schema.String),
  sourceModuleDigestFormat: Schema.optional(
    Schema.Literal(SOURCE_MODULE_DIGEST_FORMAT_V1),
  ),
  schema: Schema.optional(Schema.String),
  authConfig: Schema.optional(AuthConfigSchema),
  authConfigModule: Schema.optional(Schema.String),
  execution: Schema.String,
}) {}

export class StartPushRequest extends Schema.Class<StartPushRequest>(
  "StartPushRequest",
)({
  sourcePackage: PushSourcePackage,
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

export const RejectedFinishPushSuccess = RejectedFinishPushResponse.pipe(HttpApiSchema.status(409));

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

export class DeploymentApiGroup extends HttpApiGroup.make("deployment", { topLevel: true }).add(
  HttpApiEndpoint.get("health", DeploymentRoute.health, {
    success: DeploymentHealthResponse,
  }),
  HttpApiEndpoint.get("getActiveDeployment", DeploymentRoute.activeDeployment, {
    success: ActiveDeploymentStatus,
    error: [
      DeploymentNotFoundError,
      DeploymentStorageError,
    ],
  }),
  HttpApiEndpoint.get("getPush", DeploymentApiPath.pushStatus, {
    params: DeploymentPushParams,
    success: PushStatus,
    error: [
      DeploymentNotFoundError,
      DeploymentStorageError,
    ],
  }),
  HttpApiEndpoint.post("startAnalyzedPush", DeploymentRoute.startAnalyzedPush, {
    payload: AnalyzedStartPushRequest,
    success: PushStatus,
    error: [
      DeploymentBadRequestError,
      DeploymentStorageError,
    ],
  }),
  HttpApiEndpoint.post("finishPush", DeploymentApiPath.finishPush, {
    params: DeploymentPushParams,
    payload: FinishPushRequest,
    success: [
      ActivatedFinishPushResponse,
      RejectedFinishPushSuccess,
    ],
    error: [
      DeploymentBadRequestError,
      DeploymentNotFoundError,
      DeploymentStorageError,
    ],
  }),
  HttpApiEndpoint.post("abandonPush", DeploymentApiPath.abandonPush, {
    params: DeploymentPushParams,
    payload: AbandonPushRequest,
    success: PushStatus,
    error: [
      DeploymentNotFoundError,
      DeploymentConflictError,
      DeploymentStorageError,
    ],
  }),
) {}

export class DeploymentApi extends HttpApi.make("flarex-deployment").add(DeploymentApiGroup) {}

const decodeUnknownAbandonPushRequest = Schema.decodeUnknownEffect(AbandonPushRequest);
const decodeUnknownAnalyzedStartPushRequest = Schema.decodeUnknownEffect(AnalyzedStartPushRequest);
const decodeUnknownActiveDeploymentStatus = Schema.decodeUnknownEffect(ActiveDeploymentStatus);
const decodeUnknownDeploymentErrorResponse = Schema.decodeUnknownEffect(DeploymentErrorResponse);
const decodeUnknownDeploymentHealthResponse = Schema.decodeUnknownEffect(DeploymentHealthResponse);
const decodeUnknownDeploymentAnalysis = Schema.decodeUnknownEffect(DeploymentAnalysis);
const decodeUnknownDeploymentCodegenAnalysis = Schema.decodeUnknownEffect(DeploymentCodegenAnalysis);
const decodeUnknownFinishPushRequest = Schema.decodeUnknownEffect(FinishPushRequest);
const decodeUnknownFinishPushResponse = Schema.decodeUnknownEffect(FinishPushResponse);
const decodeUnknownPushSourcePackage = Schema.decodeUnknownEffect(PushSourcePackage);
const decodeUnknownStartPushRequest = Schema.decodeUnknownEffect(StartPushRequest);
const decodeUnknownPushStatus = Schema.decodeUnknownEffect(PushStatus);

export const decodeAbandonPushRequestEffect = Effect.fn(
  "DeploymentProtocol.decodeAbandonPushRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<AbandonPushRequest, DeploymentProtocolValidationError> {
  if (!isNonArrayRecord(value)) {
    return yield* deploymentProtocolValidationFailure(
      "AbandonPushRequest",
      "Abandon push request must be an object.",
      value,
    );
  }
  if ("reason" in value && value.reason !== undefined && typeof value.reason !== "string") {
    return yield* deploymentProtocolValidationFailure(
      "AbandonPushRequest",
      "Abandon push reason must be a string.",
      value.reason,
    );
  }
  return yield* decodeUnknownAbandonPushRequest(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "AbandonPushRequest",
        message: "Abandon push request must include an optional string reason field.",
        cause,
      })
    ),
  );
});

export const decodeFinishPushRequestEffect = Effect.fn(
  "DeploymentProtocol.decodeFinishPushRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<FinishPushRequest, DeploymentProtocolValidationError> {
  if (!isNonArrayRecord(value)) {
    return yield* deploymentProtocolValidationFailure(
      "FinishPushRequest",
      "Finish push request must be an object.",
      value,
    );
  }
  if ("activate" in value && value.activate !== undefined && typeof value.activate !== "boolean") {
    return yield* deploymentProtocolValidationFailure(
      "FinishPushRequest",
      "Finish push activate flag must be a boolean.",
      value.activate,
    );
  }
  return yield* decodeUnknownFinishPushRequest(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "FinishPushRequest",
        message: "Finish push request must include an optional boolean activate field.",
        cause,
      })
    ),
  );
});

export const decodeStartPushRequestEffect = Effect.fn(
  "DeploymentProtocol.decodeStartPushRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<StartPushRequest, DeploymentProtocolValidationError> {
  if (!isNonArrayRecord(value)) {
    return yield* deploymentProtocolValidationFailure(
      "StartPushRequest",
      "Start push request must be an object.",
      value,
    );
  }
  if (!("sourcePackage" in value)) {
    return yield* deploymentProtocolValidationFailure(
      "StartPushRequest",
      "Start push request must include sourcePackage.",
      value,
    );
  }
  const request = yield* decodeUnknownStartPushRequest(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "StartPushRequest",
        message: "Start push request must include a valid sourcePackage.",
        cause,
      })
    ),
  );
  const sourcePackage = yield* decodePushSourcePackageEffect(request.sourcePackage);
  return {
    ...request,
    sourcePackage,
  };
});

export const decodePushSourcePackageEffect = Effect.fn(
  "DeploymentProtocol.decodePushSourcePackage",
)(function* (
  value: unknown,
): Effect.fn.Return<PushSourcePackage, DeploymentProtocolValidationError> {
  const sourcePackage = yield* decodeUnknownPushSourcePackage(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "PushSourcePackage",
        message: "Source package must include modules, functions, and execution fields with valid module entries.",
        cause,
      })
    ),
  );
  yield* validatePushSourcePackageAuthConfig(sourcePackage);
  return sourcePackage;
});

export const decodeDeploymentAnalysisEffect = Effect.fn(
  "DeploymentProtocol.decodeDeploymentAnalysis",
)(function* (
  value: unknown,
): Effect.fn.Return<DeploymentAnalysis, DeploymentProtocolValidationError> {
  return yield* decodeUnknownDeploymentAnalysis(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "DeploymentAnalysis",
        message: "Deployment analysis did not match the deployment protocol.",
        cause,
      })
    ),
  );
});

export const decodeDeploymentCodegenAnalysisEffect = Effect.fn(
  "DeploymentProtocol.decodeDeploymentCodegenAnalysis",
)(function* (
  value: unknown,
): Effect.fn.Return<DeploymentCodegenAnalysis, DeploymentProtocolValidationError> {
  return yield* decodeUnknownDeploymentCodegenAnalysis(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "DeploymentCodegenAnalysis",
        message: "Deployment codegen analysis did not match the deployment protocol.",
        cause,
      })
    ),
  );
});

export const decodeDeploymentErrorResponseEffect = Effect.fn(
  "DeploymentProtocol.decodeDeploymentErrorResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<DeploymentErrorResponse, DeploymentProtocolValidationError> {
  return yield* decodeUnknownDeploymentErrorResponse(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "DeploymentErrorResponse",
        message: "Deployment error response did not match the deployment protocol.",
        cause,
      })
    ),
  );
});

export const decodeDeploymentHealthResponseEffect = Effect.fn(
  "DeploymentProtocol.decodeDeploymentHealthResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<DeploymentHealthResponse, DeploymentProtocolValidationError> {
  return yield* decodeUnknownDeploymentHealthResponse(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "DeploymentHealthResponse",
        message: "Deployment health response did not match the deployment protocol.",
        cause,
      })
    ),
  );
});

export const decodeAnalyzedStartPushRequestEffect = Effect.fn(
  "DeploymentProtocol.decodeAnalyzedStartPushRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<AnalyzedStartPushRequest, DeploymentProtocolValidationError> {
  if (!isNonArrayRecord(value)) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "Analyzed start push request must be an object.",
      value,
    );
  }
  if (!("sourcePackage" in value)) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "Analyzed start push request must include sourcePackage.",
      value,
    );
  }
  if ("diagnostics" in value && value.diagnostics !== undefined && !Array.isArray(value.diagnostics)) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "Push diagnostics must be an array.",
      value.diagnostics,
    );
  }
  const request = yield* decodeUnknownAnalyzedStartPushRequest(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "AnalyzedStartPushRequest",
        message: "Analyzed start push request must include a valid sourcePackage and optional analysis, codegenAnalysis, error, and diagnostics fields.",
        cause,
      })
    ),
  );
  if (request.analysis === undefined && !isNonEmptyString(request.error)) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "A push without analysis must include an error message.",
      value,
    );
  }
  if (request.analysis === undefined && request.codegenAnalysis !== undefined) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "A push without analysis must not include codegenAnalysis.",
      value,
    );
  }
  if (request.analysis !== undefined && request.error !== undefined) {
    return yield* deploymentProtocolValidationFailure(
      "AnalyzedStartPushRequest",
      "A push with analysis must not include error.",
      value,
    );
  }
  const sourcePackage = yield* decodePushSourcePackageEffect(request.sourcePackage);
  return {
    ...request,
    sourcePackage,
  };
});

export const decodeActiveDeploymentStatusEffect = Effect.fn(
  "DeploymentProtocol.decodeActiveDeploymentStatus",
)(function* (
  value: unknown,
): Effect.fn.Return<ActiveDeploymentStatus, DeploymentProtocolValidationError> {
  const status = yield* decodeUnknownActiveDeploymentStatus(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "ActiveDeploymentStatus",
        message: "Active deployment response did not match the deployment protocol.",
        cause,
      })
    ),
  );
  yield* validatePushSourcePackageAuthConfig(status.sourcePackage);
  return status;
});

export const decodePushStatusEffect = Effect.fn(
  "DeploymentProtocol.decodePushStatus",
)(function* (
  value: unknown,
): Effect.fn.Return<PushStatus, DeploymentProtocolValidationError> {
  const status = yield* decodeUnknownPushStatus(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "PushStatus",
        message: "Deployment push response did not match the deployment protocol.",
        cause,
      })
    ),
  );
  yield* validatePushSourcePackageAuthConfig(status.sourcePackage);
  return status;
});

export const decodeFinishPushResponseEffect = Effect.fn(
  "DeploymentProtocol.decodeFinishPushResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ActivatedFinishPushResponse | RejectedFinishPushResponse,
  DeploymentProtocolValidationError
> {
  const response = yield* decodeUnknownFinishPushResponse(value).pipe(
    Effect.mapError(cause =>
      new DeploymentProtocolValidationError({
        schema: "FinishPushResponse",
        message: "Finish push response did not match the deployment protocol.",
        cause,
      })
    ),
  );
  yield* validatePushSourcePackageAuthConfig(response.push.sourcePackage);
  return response;
});

function validatePushSourcePackageAuthConfig(
  sourcePackage: PushSourcePackage,
): Effect.Effect<void, DeploymentProtocolValidationError> {
  if (
    sourcePackage.authConfig !== undefined &&
    !isNonEmptyString(sourcePackage.authConfigModule)
  ) {
    return deploymentProtocolValidationFailure(
      "PushSourcePackage",
      "Source package auth config module is required when authConfig is present.",
      sourcePackage,
    );
  }
  if (sourcePackage.authConfigModule !== undefined && sourcePackage.authConfig === undefined) {
    return deploymentProtocolValidationFailure(
      "PushSourcePackage",
      "Source package authConfig is required when auth config module is present.",
      sourcePackage,
    );
  }
  if (
    sourcePackage.authConfigModule !== undefined &&
    !sourcePackage.modules.some(module => module.path === sourcePackage.authConfigModule)
  ) {
    return deploymentProtocolValidationFailure(
      "PushSourcePackage",
      `Source package auth config module ${sourcePackage.authConfigModule} is missing.`,
      sourcePackage,
    );
  }
  return Effect.void;
}

function deploymentProtocolValidationFailure(
  schema: string,
  message: string,
  cause: unknown,
): Effect.Effect<never, DeploymentProtocolValidationError> {
  return Effect.fail(new DeploymentProtocolValidationError({
    schema,
    message,
    cause,
  }));
}
