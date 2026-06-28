import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";

export const RegistryRoute = {
  health: "/health",
  deployments: "/deployments",
} as const;

export type RegistryRoutePath = typeof RegistryRoute[keyof typeof RegistryRoute];

export class RegistryHealthResponse extends Schema.Class<RegistryHealthResponse>(
  "RegistryHealthResponse",
)({
  service: Schema.Literal("flarex-registry"),
  status: Schema.Literal("ok"),
}) {}

export class RegistryStorageErrorResponse extends Schema.Class<RegistryStorageErrorResponse>(
  "RegistryStorageErrorResponse",
)({
  error: Schema.Literal("Registry storage error."),
}) {}

export const RegistryStorageError = RegistryStorageErrorResponse.pipe(HttpApiSchema.status(500));

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

export class RegistryApiGroup extends HttpApiGroup.make("registry", { topLevel: true }).add(
  HttpApiEndpoint.get("health", RegistryRoute.health, {
    success: RegistryHealthResponse,
  }),
  HttpApiEndpoint.get("listDeployments", RegistryRoute.deployments, {
    success: ListDeploymentsResponse,
    error: RegistryStorageError,
  }),
  HttpApiEndpoint.post("createDeployment", RegistryRoute.deployments, {
    payload: CreateDeploymentRequest,
    success: DeploymentRecord,
    error: RegistryStorageError,
  }),
) {}

export class RegistryApi extends HttpApi.make("flarex-registry").add(RegistryApiGroup) {}

const decodeCreateDeploymentRequest = Schema.decodeUnknownSync(CreateDeploymentRequest);
const decodeRegistryHealthResponse = Schema.decodeUnknownSync(RegistryHealthResponse);
const decodeRegistryStorageErrorResponse = Schema.decodeUnknownSync(RegistryStorageErrorResponse);

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

export function parseRegistryHealthResponse(value: unknown): RegistryHealthResponse {
  try {
    return decodeRegistryHealthResponse(value);
  } catch (cause) {
    throw new ProtocolValidationError({
      schema: "RegistryHealthResponse",
      message: "Registry health response did not match the registry protocol.",
      cause,
    });
  }
}

export function parseRegistryStorageErrorResponse(value: unknown): RegistryStorageErrorResponse {
  try {
    return decodeRegistryStorageErrorResponse(value);
  } catch (cause) {
    throw new ProtocolValidationError({
      schema: "RegistryStorageErrorResponse",
      message: "Registry storage error response did not match the registry protocol.",
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
