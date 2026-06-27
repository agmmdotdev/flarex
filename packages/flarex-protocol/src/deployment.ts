import { Schema } from "effect";
const PushState = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("analyzed"),
  Schema.Literal("failed"),
  Schema.Literal("activated"),
  Schema.Literal("abandoned"),
  Schema.Literal("superseded"),
]);

const PushSourceModule = Schema.Struct({
  path: Schema.String,
  environment: Schema.Literal("isolate"),
  sha256: Schema.String,
  source: Schema.optional(Schema.String),
  sourceMap: Schema.optional(Schema.String),
});

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

export class PushStatus extends Schema.Class<PushStatus>("PushStatus")({
  pushId: Schema.String,
  state: PushState,
  sourcePackage: Schema.Struct({
    modules: Schema.Array(PushSourceModule),
    functions: Schema.Array(Schema.String),
    schema: Schema.optional(Schema.String),
    execution: Schema.String,
  }),
  analysis: Schema.optional(Schema.Unknown),
  codegenAnalysis: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  diagnostics: Schema.optional(
    Schema.Array(
      Schema.Struct({
        level: Schema.Union([
          Schema.Literal("log"),
          Schema.Literal("warn"),
          Schema.Literal("error"),
        ]),
        message: Schema.String,
      }),
    ),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

const decodeAbandonPushRequest = Schema.decodeUnknownSync(AbandonPushRequest);
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
