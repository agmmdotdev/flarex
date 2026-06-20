export class DeploymentProjectMismatchError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly expectedProjectId: string,
    readonly actualProjectId: string,
  ) {
    super(
      `Deployment ${deploymentId} belongs to project ${actualProjectId}, not ${expectedProjectId}`,
    );
    this.name = "DeploymentProjectMismatchError";
  }
}

export class DeploymentPackageMismatchError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly packageId: string,
  ) {
    super(
      `Deployment package metadata does not match registration input: ${deploymentId}/${packageId}`,
    );
    this.name = "DeploymentPackageMismatchError";
  }
}

export class DeploymentNotFoundError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Deployment metadata not found: ${deploymentId}`);
    this.name = "DeploymentNotFoundError";
  }
}

export class DeploymentPackageNotActivatedError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Deployment has no active package: ${deploymentId}`);
    this.name = "DeploymentPackageNotActivatedError";
  }
}

export class DeploymentPackageNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly packageId: string,
  ) {
    super(`Deployment package metadata not found: ${deploymentId}/${packageId}`);
    this.name = "DeploymentPackageNotFoundError";
  }
}

export class DeploymentFunctionMetadataUnavailableError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly packageId: string,
    message: string,
  ) {
    super(
      `Deployment function metadata unavailable for ${deploymentId}/${packageId}: ${message}`,
    );
    this.name = "DeploymentFunctionMetadataUnavailableError";
  }
}

export class FunctionNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly path: string,
  ) {
    super(`Active Flarex function not found: ${deploymentId}/${path}`);
    this.name = "FunctionNotFoundError";
  }
}

export class DeploymentSchemaMetadataUnavailableError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly packageId: string,
    message: string,
  ) {
    super(
      `Deployment schema metadata unavailable for ${deploymentId}/${packageId}: ${message}`,
    );
    this.name = "DeploymentSchemaMetadataUnavailableError";
  }
}

export class FunctionKindMismatchError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly path: string,
    readonly expectedKind: string,
    readonly actualKind: string,
  ) {
    super(
      `Function kind mismatch for ${deploymentId}/${path}. Expected ${expectedKind}, got ${actualKind}`,
    );
    this.name = "FunctionKindMismatchError";
  }
}

export class FunctionNotInvokableError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly path: string,
    readonly kind: string,
  ) {
    super(
      `Function ${deploymentId}/${path} has kind ${kind}, which is not invokable by /invoke`,
    );
    this.name = "FunctionNotInvokableError";
  }
}

export class PartitionValidationError extends Error {
  constructor(message: string) {
    super(`PartitionValidationError: ${message}`);
    this.name = "PartitionValidationError";
  }
}

export class MaintenancePolicyError extends Error {
  constructor(message: string) {
    super(`Invalid maintenance policy: ${message}`);
    this.name = "MaintenancePolicyError";
  }
}

export class InvokeSessionNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
  ) {
    super(`Invoke session metadata not found: ${deploymentId}/${sessionId}`);
    this.name = "InvokeSessionNotFoundError";
  }
}

export class InvokeSessionProjectMismatchError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
    readonly expectedProjectId: string,
    readonly actualProjectId: string,
  ) {
    super(
      `Invoke session ${deploymentId}/${sessionId} belongs to project ${actualProjectId}, not ${expectedProjectId}`,
    );
    this.name = "InvokeSessionProjectMismatchError";
  }
}

export class InvokeSessionNotActiveError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
    readonly state: string,
  ) {
    super(
      `Invoke session ${deploymentId}/${sessionId} is ${state}, not active`,
    );
    this.name = "InvokeSessionNotActiveError";
  }
}

export class InvokeSyscallNotAllowedError extends Error {
  constructor(
    readonly op: string,
    readonly functionKind: string,
  ) {
    super(`Cannot run ${op} during ${functionKind} execution.`);
    this.name = "InvokeSyscallNotAllowedError";
  }
}

export class InvokeSyscallNotImplementedError extends Error {
  constructor(readonly op: string) {
    super(`Invoke syscall ${op} is not implemented by the Postgres executor yet.`);
    this.name = "InvokeSyscallNotImplementedError";
  }
}

export class InvokeQueryRequestError extends Error {
  constructor(message: string) {
    super(`Invalid query syscall request: ${message}`);
    this.name = "InvokeQueryRequestError";
  }
}

export class InvokePatchValueError extends Error {
  constructor() {
    super("Patch value must be a non-null JSON object.");
    this.name = "InvokePatchValueError";
  }
}

export class InvokePatchDocumentNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly id: string,
  ) {
    super(`Cannot patch missing document: ${deploymentId}/${id}`);
    this.name = "InvokePatchDocumentNotFoundError";
  }
}

export class InvokePatchNonObjectDocumentError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly id: string,
  ) {
    super(`Cannot patch non-object document: ${deploymentId}/${id}`);
    this.name = "InvokePatchNonObjectDocumentError";
  }
}

export class InvokeReplaceDocumentNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly id: string,
  ) {
    super(`Cannot replace missing document: ${deploymentId}/${id}`);
    this.name = "InvokeReplaceDocumentNotFoundError";
  }
}

export class InvokeDeleteDocumentNotFoundError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly id: string,
  ) {
    super(`Cannot delete missing document: ${deploymentId}/${id}`);
    this.name = "InvokeDeleteDocumentNotFoundError";
  }
}

export class InvokeFinishNotImplementedError extends Error {
  constructor(readonly functionKind: string) {
    super(
      `Invoke finish for ${functionKind} sessions is not implemented by the Postgres executor yet.`,
    );
    this.name = "InvokeFinishNotImplementedError";
  }
}

export class InvokeRetryPolicyError extends Error {
  constructor(message: string) {
    super(`Invalid invoke retry policy: ${message}`);
    this.name = "InvokeRetryPolicyError";
  }
}

export class InvokeRetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(`Invoke mutation retry budget exhausted after ${attempts} attempts.`);
    this.name = "InvokeRetryExhaustedError";
  }
}

export class FlarexInsertIdTableMismatchError extends Error {
  constructor(
    readonly id: string,
    readonly expectedTableId: number,
  ) {
    super(`Document id ${id} does not belong to table id ${expectedTableId}.`);
    this.name = "FlarexInsertIdTableMismatchError";
  }
}
