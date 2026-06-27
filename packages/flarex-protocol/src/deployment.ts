import { Schema } from "effect";
const PushState = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("analyzed"),
  Schema.Literal("failed"),
  Schema.Literal("activated"),
  Schema.Literal("abandoned"),
  Schema.Literal("superseded"),
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

export class AbandonPushRequest extends Schema.Class<AbandonPushRequest>(
  "AbandonPushRequest",
)({
  reason: Schema.optional(Schema.String),
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
  analysis: Schema.optional(Schema.Unknown),
  codegenAnalysis: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  diagnostics: Schema.optional(Schema.Array(PushDiagnostic)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

const decodeAbandonPushRequest = Schema.decodeUnknownSync(AbandonPushRequest);
const decodeAnalyzedStartPushRequest = Schema.decodeUnknownSync(AnalyzedStartPushRequest);
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
