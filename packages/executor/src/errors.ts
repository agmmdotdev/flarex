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
