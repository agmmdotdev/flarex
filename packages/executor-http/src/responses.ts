import {
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  DeploymentSchemaMetadataUnavailableError,
  DeploymentValidatorMetadataError,
  FlarexDocumentIdFormatError,
  FlarexInsertIdTableMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  FunctionVisibilityMismatchError,
  InvokeDeleteDocumentNotFoundError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeSessionDeleteTargetError,
  InvokeSessionDocumentValidationError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionIndexOccConflictError,
  InvokeSessionInsertConflictError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionProjectMismatchError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  LiveQueryDeliveryPolicyError,
  LiveQuerySubscriptionRerunError,
  MaintenancePolicyError,
  PartitionValidationError,
} from "@flarex/executor";
import {
  type ElysiaSet,
  ExecutorHttpBodyValidationError,
  ExecutorHttpJsonBodyError,
  type ExecutorHttpRouteError,
  ExecutorHttpRoutePreconditionError,
  ExecutorHttpUnauthorizedError,
} from "./errors";

export function executorHttpRouteErrorBody(error: ExecutorHttpRouteError, set: ElysiaSet): object {
  if (error instanceof ExecutorHttpUnauthorizedError) {
    set.status = 401;
    return error.body;
  }
  if (error instanceof ExecutorHttpRoutePreconditionError) {
    set.status = error.response.status;
    return error.response.body;
  }
  if (error instanceof ExecutorHttpJsonBodyError) {
    set.status = 400;
    return {
      error: "bad_request",
      message: error.message,
    };
  }
  if (error instanceof ExecutorHttpBodyValidationError) {
    set.status = 400;
    return error.body;
  }
  set.status = error.response.status;
  return error.response.body;
}

export function executorErrorBody(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (
    error instanceof DeploymentNotFoundError ||
    error instanceof DeploymentPackageNotFoundError ||
    error instanceof InvokeSessionNotFoundError ||
    error instanceof InvokeDeleteDocumentNotFoundError ||
    error instanceof InvokePatchDocumentNotFoundError ||
    error instanceof FunctionNotFoundError
  ) {
    return knownErrorBody(error, 404);
  }
  if (
    error instanceof DeploymentProjectMismatchError ||
    error instanceof InvokeSessionProjectMismatchError
  ) {
    return knownErrorBody(error, 403);
  }
  if (
    error instanceof FunctionKindMismatchError ||
    error instanceof FunctionVisibilityMismatchError ||
    error instanceof FunctionNotInvokableError ||
    error instanceof FlarexDocumentIdFormatError ||
    error instanceof FlarexInsertIdTableMismatchError ||
    error instanceof InvokePatchNonObjectDocumentError ||
    error instanceof InvokePatchValueError ||
    error instanceof InvokeQueryRequestError ||
    error instanceof InvokeSessionDocumentValidationError ||
    error instanceof InvokeSessionDocumentWriteAlreadyExistsError ||
    error instanceof InvokeSyscallNotAllowedError ||
    error instanceof LiveQueryDeliveryPolicyError ||
    error instanceof LiveQuerySubscriptionRerunError ||
    error instanceof MaintenancePolicyError ||
    error instanceof PartitionValidationError
  ) {
    return knownErrorBody(error, 400);
  }
  if (
    error instanceof DeploymentPackageNotActivatedError ||
    error instanceof DeploymentFunctionMetadataUnavailableError ||
    error instanceof DeploymentSchemaMetadataUnavailableError ||
    error instanceof DeploymentValidatorMetadataError ||
    error instanceof InvokeSessionDeleteTargetError ||
    error instanceof InvokeSessionInsertConflictError ||
    error instanceof InvokeSessionIndexOccConflictError ||
    error instanceof InvokeSessionOccConflictError ||
    error instanceof InvokeSessionPatchTargetError ||
    error instanceof InvokeSessionTableOccConflictError ||
    error instanceof InvokeSessionNotActiveError
  ) {
    return knownErrorBody(error, 409);
  }
  if (
    error instanceof InvokeFinishNotImplementedError ||
    error instanceof InvokeSessionUnsupportedStagedWriteError ||
    error instanceof InvokeSyscallNotImplementedError
  ) {
    return knownErrorBody(error, 501);
  }

  return {
    status: 500,
    body: {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function knownErrorBody(error: Error, status: number): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status,
    body: {
      error: error.name,
      message: error.message,
    },
  };
}
