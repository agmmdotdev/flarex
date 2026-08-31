import { Data } from "effect";

import type {
  FrameworkSchemaArtifactCoordinate,
  FrameworkSchemaArtifactIdentity,
} from "./model";

export type FrameworkSchemaArtifactOperation =
  | "capture"
  | "classifyReplay"
  | "admit"
  | "read"
  | "list";

export type FrameworkSchemaArtifactReason =
  | "invalidInput"
  | "ownerNotAdmitted"
  | "deploymentMissing"
  | "dependencyMissing"
  | "digestCollision"
  | "storedStateCorrupt"
  | "resourceFailure"
  | "decisionUncertain";

export type FrameworkSchemaArtifactStoredStage =
  | "artifactRow"
  | "canonicalFrame"
  | "dependencyRows";

export type FrameworkSchemaArtifactPersistenceStage =
  | "transaction"
  | "lockDeployment"
  | "readArtifact"
  | "readDependencies"
  | "insertArtifact"
  | "insertDependencies"
  | "reconstructArtifact"
  | "listArtifacts"
  | "settle"
  | "recover";

export type FrameworkSchemaArtifactReadPersistenceStage = Extract<
  FrameworkSchemaArtifactPersistenceStage,
  "readArtifact" | "readDependencies" | "reconstructArtifact"
>;

export type FrameworkSchemaArtifactListPersistenceStage = Extract<
  FrameworkSchemaArtifactPersistenceStage,
  "listArtifacts"
>;

export class FrameworkSchemaArtifactError extends Data.TaggedError(
  "FrameworkSchemaArtifactError",
)<{
  readonly operation: FrameworkSchemaArtifactOperation;
  readonly reason: FrameworkSchemaArtifactReason;
  readonly message: string;
  readonly retryable: false;
  readonly identity?: FrameworkSchemaArtifactIdentity;
  readonly coordinate?: FrameworkSchemaArtifactCoordinate;
  readonly deploymentId?: string;
  readonly dependencyIdentity?: FrameworkSchemaArtifactIdentity;
  readonly dependencyOrdinal?: number;
  readonly storedStage?: FrameworkSchemaArtifactStoredStage;
  readonly stage?: FrameworkSchemaArtifactPersistenceStage;
  readonly cause?: unknown;
  readonly initialSettlementCause?: unknown;
  readonly resolutionCause?: unknown;
}> {
  private constructor(fields: Readonly<{
    operation: FrameworkSchemaArtifactOperation;
    reason: FrameworkSchemaArtifactReason;
    message: string;
    retryable: false;
    identity?: FrameworkSchemaArtifactIdentity;
    coordinate?: FrameworkSchemaArtifactCoordinate;
    deploymentId?: string;
    dependencyIdentity?: FrameworkSchemaArtifactIdentity;
    dependencyOrdinal?: number;
    storedStage?: FrameworkSchemaArtifactStoredStage;
    stage?: FrameworkSchemaArtifactPersistenceStage;
    cause?: unknown;
    initialSettlementCause?: unknown;
    resolutionCause?: unknown;
  }>) {
    super(fields);
  }

  static invalidInput(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "capture",
      reason: "invalidInput",
      message: "Framework schema artifact input is invalid",
      retryable: false,
    });
  }

  static ownerNotAdmitted(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "capture",
      reason: "ownerNotAdmitted",
      message: "Framework schema artifact owner is not admitted",
      retryable: false,
    });
  }

  static admissionInputInvalid(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "invalidInput",
      message: "Framework schema artifact admission input is invalid",
      retryable: false,
    });
  }

  static admissionDeploymentMissing(
    deploymentId: string,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "deploymentMissing",
      message: "Framework schema artifact deployment is missing",
      retryable: false,
      deploymentId,
    });
  }

  static admissionDependencyMissing(
    identity: FrameworkSchemaArtifactIdentity,
    dependencyIdentity: FrameworkSchemaArtifactIdentity,
    dependencyOrdinal: number,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "dependencyMissing",
      message: "Framework schema artifact dependency is missing",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      dependencyIdentity:
        snapshotFrameworkSchemaArtifactIdentity(dependencyIdentity),
      dependencyOrdinal,
    });
  }

  static admissionDigestCollision(
    identity: FrameworkSchemaArtifactIdentity,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "digestCollision",
      message: "Framework schema artifact digest collision",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
    });
  }

  static admissionStoredStateCorrupt(
    identity: FrameworkSchemaArtifactIdentity,
    storedStage: FrameworkSchemaArtifactStoredStage,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "storedStateCorrupt",
      message: "Stored framework schema artifact state is corrupt",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      storedStage,
    });
  }

  static admissionResourceFailure(
    identity: FrameworkSchemaArtifactIdentity,
    stage: FrameworkSchemaArtifactPersistenceStage,
    cause: unknown,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "resourceFailure",
      message: "Framework schema artifact admission persistence failed",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      stage,
      cause,
    });
  }

  static admissionDecisionUncertain(
    identity: FrameworkSchemaArtifactIdentity,
    stage: Extract<
      FrameworkSchemaArtifactPersistenceStage,
      "settle" | "recover"
    >,
    initialSettlementCause: unknown,
    resolutionCause: unknown,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "admit",
      reason: "decisionUncertain",
      message: "Framework schema artifact admission decision is uncertain",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      stage,
      initialSettlementCause,
      resolutionCause,
    });
  }

  static hashFailure(cause: unknown): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "capture",
      reason: "resourceFailure",
      message: "Framework schema artifact SHA-256 failed",
      retryable: false,
      cause,
    });
  }

  static digestCollision(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "classifyReplay",
      reason: "digestCollision",
      message: "Framework schema artifact digest collision",
      retryable: false,
    });
  }

  static readInputInvalid(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "read",
      reason: "invalidInput",
      message: "Framework schema artifact identity is invalid",
      retryable: false,
    });
  }

  static readStoredStateCorrupt(
    identity: FrameworkSchemaArtifactIdentity,
    storedStage: FrameworkSchemaArtifactStoredStage,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "read",
      reason: "storedStateCorrupt",
      message: "Stored framework schema artifact state is corrupt",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      storedStage,
    });
  }

  static readResourceFailure(
    identity: FrameworkSchemaArtifactIdentity,
    stage: FrameworkSchemaArtifactReadPersistenceStage,
    cause: unknown,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "read",
      reason: "resourceFailure",
      message: "Framework schema artifact read failed",
      retryable: false,
      identity: snapshotFrameworkSchemaArtifactIdentity(identity),
      stage,
      cause,
    });
  }

  static listInputInvalid(): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "list",
      reason: "invalidInput",
      message: "Framework schema artifact list input is invalid",
      retryable: false,
    });
  }

  static listStoredStateCorrupt(
    coordinate: FrameworkSchemaArtifactCoordinate,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "list",
      reason: "storedStateCorrupt",
      message: "Stored framework schema artifact state is corrupt",
      retryable: false,
      coordinate: snapshotFrameworkSchemaArtifactCoordinate(coordinate),
      storedStage: "artifactRow",
    });
  }

  static listResourceFailure(
    coordinate: FrameworkSchemaArtifactCoordinate,
    stage: FrameworkSchemaArtifactListPersistenceStage,
    cause: unknown,
  ): FrameworkSchemaArtifactError {
    return new FrameworkSchemaArtifactError({
      operation: "list",
      reason: "resourceFailure",
      message: "Framework schema artifact list failed",
      retryable: false,
      coordinate: snapshotFrameworkSchemaArtifactCoordinate(coordinate),
      stage,
      cause,
    });
  }
}

export class FrameworkSchemaArtifactInvariantDefect extends Data.TaggedError(
  "FrameworkSchemaArtifactInvariantDefect",
)<{
  readonly reason:
    | "canonicalFrameInvalid"
    | "canonicalByteLengthMismatch"
    | "invalidDigestOutput"
    | "invalidPlatformIntrinsic"
    | "ownedSnapshotInvalid"
    | "unexpectedCaptureFailure"
    | "unexpectedReadFailure"
    | "unexpectedListFailure"
    | "unexpectedAdmissionFailure";
  readonly observedByteLength?: number;
}> {}

export class FrameworkSchemaArtifactRepositoryConfigurationError extends
  Data.TaggedError("FrameworkSchemaArtifactRepositoryConfigurationError")<{
    readonly reason:
      | "invalidTimeoutPolicy"
      | "invalidControlSessionComposition";
    readonly message:
      | "Framework schema artifact repository timeout policy is invalid"
      | "Framework schema artifact control session composition is invalid";
  }>
{
  private constructor(fields: Readonly<{
    reason:
      | "invalidTimeoutPolicy"
      | "invalidControlSessionComposition";
    message:
      | "Framework schema artifact repository timeout policy is invalid"
      | "Framework schema artifact control session composition is invalid";
  }>) {
    super(fields);
  }

  static invalidTimeoutPolicy():
    FrameworkSchemaArtifactRepositoryConfigurationError
  {
    return new FrameworkSchemaArtifactRepositoryConfigurationError({
      reason: "invalidTimeoutPolicy",
      message: "Framework schema artifact repository timeout policy is invalid",
    });
  }

  static invalidControlSessionComposition():
    FrameworkSchemaArtifactRepositoryConfigurationError
  {
    return new FrameworkSchemaArtifactRepositoryConfigurationError({
      reason: "invalidControlSessionComposition",
      message:
        "Framework schema artifact control session composition is invalid",
    });
  }
}

function snapshotFrameworkSchemaArtifactIdentity(
  identity: FrameworkSchemaArtifactIdentity,
): FrameworkSchemaArtifactIdentity {
  return Object.freeze({
    deploymentId: identity.deploymentId,
    owner: identity.owner,
    lineageId: identity.lineageId,
    artifactSha256: identity.artifactSha256,
  });
}

function snapshotFrameworkSchemaArtifactCoordinate(
  coordinate: FrameworkSchemaArtifactCoordinate,
): FrameworkSchemaArtifactCoordinate {
  return Object.freeze({
    deploymentId: coordinate.deploymentId,
    owner: coordinate.owner,
    lineageId: coordinate.lineageId,
  });
}
