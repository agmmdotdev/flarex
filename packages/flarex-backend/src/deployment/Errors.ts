import { Schema } from "effect";

const DeploymentArtifactOperation = Schema.Literal("executionArtifactRefForSourcePackage");

export class DeploymentArtifactRefError extends Schema.TaggedError<DeploymentArtifactRefError>()(
  "DeploymentArtifactRefError",
  {
    operation: DeploymentArtifactOperation,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class DeploymentPushNotFoundError extends Schema.TaggedError<DeploymentPushNotFoundError>()(
  "DeploymentPushNotFoundError",
  {
    pushId: Schema.String,
  },
) {}

export class DeploymentPushInvalidStateError extends Schema.TaggedError<DeploymentPushInvalidStateError>()(
  "DeploymentPushInvalidStateError",
  {
    action: Schema.Literal("abandon"),
    pushId: Schema.String,
    state: Schema.String,
  },
) {}

export class DeploymentActiveDeploymentNotFoundError extends Schema.TaggedError<DeploymentActiveDeploymentNotFoundError>()(
  "DeploymentActiveDeploymentNotFoundError",
  {},
) {}

export class DeploymentActiveDeploymentInvalidError extends Schema.TaggedError<DeploymentActiveDeploymentInvalidError>()(
  "DeploymentActiveDeploymentInvalidError",
  {
    message: Schema.String,
  },
) {}

const DeploymentStoredPushOperation = Schema.Union([
  Schema.Literal("startPush"),
  Schema.Literal("finishPush"),
  Schema.Literal("abandonPush"),
]);

export class DeploymentStoredPushMissingError extends Schema.TaggedError<DeploymentStoredPushMissingError>()(
  "DeploymentStoredPushMissingError",
  {
    operation: DeploymentStoredPushOperation,
    pushId: Schema.String,
    stage: Schema.String,
  },
) {}

export class DeploymentValidationError extends Schema.TaggedError<DeploymentValidationError>()(
  "DeploymentValidationError",
  {
    message: Schema.String,
  },
) {}
