import { Schema } from "effect";

const DeploymentArtifactOperation = Schema.Literal("executionArtifactRefForSourcePackage");

export class DeploymentArtifactRefError extends Schema.TaggedErrorClass<DeploymentArtifactRefError>()(
  "DeploymentArtifactRefError",
  {
    operation: DeploymentArtifactOperation,
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class DeploymentPushNotFoundError extends Schema.TaggedErrorClass<DeploymentPushNotFoundError>()(
  "DeploymentPushNotFoundError",
  {
    pushId: Schema.String,
  },
) {}

export class DeploymentPushInvalidStateError extends Schema.TaggedErrorClass<DeploymentPushInvalidStateError>()(
  "DeploymentPushInvalidStateError",
  {
    action: Schema.Literal("abandon"),
    pushId: Schema.String,
    state: Schema.String,
  },
) {}

export class DeploymentActiveDeploymentNotFoundError extends Schema.TaggedErrorClass<DeploymentActiveDeploymentNotFoundError>()(
  "DeploymentActiveDeploymentNotFoundError",
  {},
) {}

export class DeploymentActiveDeploymentInvalidError extends Schema.TaggedErrorClass<DeploymentActiveDeploymentInvalidError>()(
  "DeploymentActiveDeploymentInvalidError",
  {
    message: Schema.String,
  },
) {}

export class DeploymentValidationError extends Schema.TaggedErrorClass<DeploymentValidationError>()(
  "DeploymentValidationError",
  {
    message: Schema.String,
  },
) {}
