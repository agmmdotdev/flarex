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
