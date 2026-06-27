import { Schema } from "effect";

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
