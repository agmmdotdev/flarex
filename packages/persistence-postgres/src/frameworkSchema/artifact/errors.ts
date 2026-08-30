import { Data } from "effect";

export type FrameworkSchemaArtifactOperation =
  | "capture"
  | "classifyReplay"
  | "admit";

export type FrameworkSchemaArtifactReason =
  | "invalidInput"
  | "ownerNotAdmitted"
  | "digestCollision"
  | "resourceFailure";

export class FrameworkSchemaArtifactError extends Data.TaggedError(
  "FrameworkSchemaArtifactError",
)<{
  readonly operation: FrameworkSchemaArtifactOperation;
  readonly reason: FrameworkSchemaArtifactReason;
  readonly message: string;
  readonly retryable: false;
  readonly cause?: unknown;
}> {
  private constructor(fields: Readonly<{
    operation: FrameworkSchemaArtifactOperation;
    reason: FrameworkSchemaArtifactReason;
    message: string;
    retryable: false;
    cause?: unknown;
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
    | "unexpectedCaptureFailure";
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
