import { Effect, Schema } from "effect";
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

const decodeUnknownCreateDeploymentRequest = Schema.decodeUnknownEffect(CreateDeploymentRequest);
const decodeUnknownRegistryHealthResponse = Schema.decodeUnknownEffect(RegistryHealthResponse);
const decodeUnknownRegistryStorageErrorResponse = Schema.decodeUnknownEffect(RegistryStorageErrorResponse);

export const decodeCreateDeploymentRequestEffect = Effect.fn(
  "RegistryProtocol.decodeCreateDeploymentRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<CreateDeploymentRequest, ProtocolValidationError> {
  return yield* decodeUnknownCreateDeploymentRequest(value).pipe(
    Effect.mapError(cause =>
      new ProtocolValidationError({
        schema: "CreateDeploymentRequest",
        message: "Create deployment request must include optional string deploymentId and slug fields.",
        cause,
      })
    ),
  );
});

export const decodeRegistryHealthResponseEffect = Effect.fn(
  "RegistryProtocol.decodeHealthResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<RegistryHealthResponse, ProtocolValidationError> {
  return yield* decodeUnknownRegistryHealthResponse(value).pipe(
    Effect.mapError(cause =>
      new ProtocolValidationError({
        schema: "RegistryHealthResponse",
        message: "Registry health response did not match the registry protocol.",
        cause,
      })
    ),
  );
});

export const decodeRegistryStorageErrorResponseEffect = Effect.fn(
  "RegistryProtocol.decodeStorageErrorResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<RegistryStorageErrorResponse, ProtocolValidationError> {
  return yield* decodeUnknownRegistryStorageErrorResponse(value).pipe(
    Effect.mapError(cause =>
      new ProtocolValidationError({
        schema: "RegistryStorageErrorResponse",
        message: "Registry storage error response did not match the registry protocol.",
        cause,
      })
    ),
  );
});

const decodeUnknownDeploymentRecord = Schema.decodeUnknownEffect(DeploymentRecord);
const decodeUnknownListDeploymentsResponse = Schema.decodeUnknownEffect(ListDeploymentsResponse);

export const decodeDeploymentRecordEffect = Effect.fn(
  "RegistryProtocol.decodeDeploymentRecord",
)(function* (
  value: unknown,
): Effect.fn.Return<DeploymentRecord, ProtocolValidationError> {
  return yield* decodeUnknownDeploymentRecord(value).pipe(
    Effect.mapError(cause =>
      new ProtocolValidationError({
        schema: "DeploymentRecord",
        message: "Deployment record response did not match the registry protocol.",
        cause,
      })
    ),
  );
});

export const decodeListDeploymentsResponseEffect = Effect.fn(
  "RegistryProtocol.decodeListDeploymentsResponse",
)(function* (
  value: unknown,
): Effect.fn.Return<ListDeploymentsResponse, ProtocolValidationError> {
  return yield* decodeUnknownListDeploymentsResponse(value).pipe(
    Effect.mapError(cause =>
      new ProtocolValidationError({
        schema: "ListDeploymentsResponse",
        message: "List deployments response did not match the registry protocol.",
        cause,
      })
    ),
  );
});
