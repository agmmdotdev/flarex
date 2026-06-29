import { HttpError } from "../http";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentActiveDeploymentNotFoundError,
  DeploymentArtifactRefError,
  DeploymentPushInvalidStateError,
  DeploymentPushNotFoundError,
  DeploymentValidationError,
} from "./Errors";
import type { DeploymentSqlError } from "./Store";
import type { FinishPushResponse } from "../types";

export type DeploymentServiceFailure =
  | DeploymentActiveDeploymentInvalidError
  | DeploymentActiveDeploymentNotFoundError
  | DeploymentArtifactRefError
  | DeploymentPushInvalidStateError
  | DeploymentPushNotFoundError
  | DeploymentValidationError
  | DeploymentSqlError
  | HttpError;

export function deploymentFailureToHttpError(error: DeploymentServiceFailure): HttpError {
  if (error instanceof DeploymentActiveDeploymentNotFoundError) {
    return new HttpError(404, "No active deployment.");
  }
  if (error instanceof DeploymentActiveDeploymentInvalidError) {
    return new HttpError(500, error.message);
  }
  if (error instanceof DeploymentPushNotFoundError) {
    return new HttpError(404, `Unknown push: ${error.pushId}`);
  }
  if (error instanceof DeploymentPushInvalidStateError) {
    return new HttpError(409, `Cannot abandon push ${error.pushId} in state ${error.state}.`);
  }
  if (error instanceof DeploymentArtifactRefError) {
    return new HttpError(500, `Deployment artifact error: ${error.message}`);
  }
  if (error instanceof DeploymentValidationError) {
    return new HttpError(400, error.message);
  }
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(500, "Deployment storage error.");
}

export function finishPushHttpStatus(response: FinishPushResponse): 200 | 409 {
  return response.result === "rejected" ? 409 : 200;
}
