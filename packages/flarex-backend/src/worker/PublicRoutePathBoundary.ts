import { Data, Effect } from "effect";
import { DeploymentPushAction } from "flarex-protocol/deployment";
import { HttpError } from "../http";

export class MissingPublicDeploymentIdError
  extends Data.TaggedError("MissingPublicDeploymentIdError")<{}> {}

export class MissingPublicPartitionKeyError
  extends Data.TaggedError("MissingPublicPartitionKeyError")<{}> {}

export class MissingDeploymentPushIdError
  extends Data.TaggedError("MissingDeploymentPushIdError")<{}> {}

export type PublicRoutePathError =
  | MissingPublicDeploymentIdError
  | MissingPublicPartitionKeyError
  | MissingDeploymentPushIdError;

export type PublicDeploymentPushPath =
  | {
      readonly kind: "start";
    }
  | {
      readonly kind: "startAnalyzed";
    }
  | {
      readonly kind: "push";
      readonly encodedPushId: string;
      readonly action?: string;
    };

export const publicDeploymentIdFromPartsEffect = Effect.fn(
  "PublicRoutePathBoundary.publicDeploymentIdFromParts",
)(function* (
  parts: readonly string[],
): Effect.fn.Return<string, MissingPublicDeploymentIdError> {
  const deploymentId = parts[1];
  if (deploymentId === undefined || deploymentId.length === 0) {
    return yield* Effect.fail(new MissingPublicDeploymentIdError());
  }
  return deploymentId;
});

export const publicPartitionKeyFromPartsEffect = Effect.fn(
  "PublicRoutePathBoundary.publicPartitionKeyFromParts",
)(function* (
  parts: readonly string[],
): Effect.fn.Return<string, MissingPublicPartitionKeyError> {
  const partitionKey = parts[3];
  if (partitionKey === undefined || partitionKey.length === 0) {
    return yield* Effect.fail(new MissingPublicPartitionKeyError());
  }
  return partitionKey;
});

export const publicDeploymentPushPathFromPartsEffect = Effect.fn(
  "PublicRoutePathBoundary.publicDeploymentPushPathFromParts",
)(function* (
  parts: readonly string[],
  method: string,
): Effect.fn.Return<PublicDeploymentPushPath, MissingDeploymentPushIdError> {
  if (method === "POST" && parts[0] === "start") return { kind: "start" };
  if (method === "POST" && parts[0] === "start-analyzed") return { kind: "startAnalyzed" };

  const encodedPushId = parts[0];
  if (encodedPushId === undefined || encodedPushId.length === 0) {
    return yield* Effect.fail(new MissingDeploymentPushIdError());
  }
  return {
    kind: "push",
    encodedPushId,
    ...(parts[1] === undefined ? {} : { action: parts[1] }),
  };
});

export function publicRoutePathErrorToHttpError(error: PublicRoutePathError): HttpError {
  if (error instanceof MissingPublicDeploymentIdError) {
    return new HttpError(400, "Missing deployment id.");
  }
  if (error instanceof MissingPublicPartitionKeyError) {
    return new HttpError(400, "Missing partition key.");
  }
  return new HttpError(400, "Missing push id.");
}

export function deploymentPushActionFromPath(
  action: string | undefined,
): DeploymentPushAction | undefined {
  if (action === DeploymentPushAction.finish) return DeploymentPushAction.finish;
  if (action === DeploymentPushAction.abandon) return DeploymentPushAction.abandon;
  return undefined;
}
