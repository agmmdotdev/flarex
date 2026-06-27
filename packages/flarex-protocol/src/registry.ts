import { Schema } from "effect";

export class ProtocolValidationError extends Schema.TaggedErrorClass<ProtocolValidationError>()(
  "ProtocolValidationError",
  {
    schema: Schema.String,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CreateDeploymentRequest extends Schema.Class<CreateDeploymentRequest>(
  "CreateDeploymentRequest",
)({
  deploymentId: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
}) {}

export class DeploymentRecord extends Schema.Class<DeploymentRecord>("DeploymentRecord")({
  deploymentId: Schema.String,
  slug: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  schemaVersion: Schema.Number,
}) {}

export class ListDeploymentsResponse extends Schema.Class<ListDeploymentsResponse>(
  "ListDeploymentsResponse",
)({
  deployments: Schema.Array(DeploymentRecord),
}) {}

const decodeCreateDeploymentRequest = Schema.decodeUnknownSync(CreateDeploymentRequest);

export function parseCreateDeploymentRequest(value: unknown): CreateDeploymentRequest {
  try {
    return decodeCreateDeploymentRequest(value);
  } catch (cause) {
    throw new ProtocolValidationError({
      schema: "CreateDeploymentRequest",
      message: "Create deployment request must include optional string deploymentId and slug fields.",
      cause,
    });
  }
}

const decodeDeploymentRecord = Schema.decodeUnknownSync(DeploymentRecord);
const decodeListDeploymentsResponse = Schema.decodeUnknownSync(ListDeploymentsResponse);

export function parseDeploymentRecord(value: unknown): DeploymentRecord {
  try {
    return decodeDeploymentRecord(value);
  } catch (cause) {
    throw new ProtocolValidationError({
      schema: "DeploymentRecord",
      message: "Deployment record response did not match the registry protocol.",
      cause,
    });
  }
}

export function parseListDeploymentsResponse(value: unknown): ListDeploymentsResponse {
  try {
    return decodeListDeploymentsResponse(value);
  } catch (cause) {
    throw new ProtocolValidationError({
      schema: "ListDeploymentsResponse",
      message: "List deployments response did not match the registry protocol.",
      cause,
    });
  }
}
