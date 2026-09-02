import { Data } from "effect";

export type FrameworkMigrationValueOperation =
  | "captureTargetNamespace"
  | "capturePlan"
  | "captureLedgerValue"
  | "decodeStoredValue";

export type FrameworkMigrationValueReason =
  | "invalidInput"
  | "unsupportedArtifact"
  | "planConflict"
  | "storedStateCorrupt"
  | "resourceFailure";

type FrameworkMigrationValueErrorCommon = Readonly<{
  readonly operation: FrameworkMigrationValueOperation;
  readonly reason: FrameworkMigrationValueReason;
  readonly message: string;
  readonly retryable: false;
}>;

class FrameworkMigrationInvalidValueError extends Data.TaggedError(
  "FrameworkMigrationValueError",
)<FrameworkMigrationValueErrorCommon & Readonly<{
  readonly reason:
    | "invalidInput"
    | "unsupportedArtifact"
    | "planConflict"
    | "storedStateCorrupt";
  readonly cause?: never;
}>> {}

class FrameworkMigrationValueResourceError extends Data.TaggedError(
  "FrameworkMigrationValueError",
)<FrameworkMigrationValueErrorCommon & Readonly<{
  readonly reason: "resourceFailure";
  readonly cause: unknown;
}>> {}

export type FrameworkMigrationValueError =
  | FrameworkMigrationInvalidValueError
  | FrameworkMigrationValueResourceError;

export const FrameworkMigrationValueError = Object.freeze({
  invalidInput(
    operation: FrameworkMigrationValueOperation,
  ): FrameworkMigrationValueError {
    return new FrameworkMigrationInvalidValueError({
      operation,
      reason: "invalidInput",
      message: "Framework migration value input is invalid",
      retryable: false,
    });
  },

  unsupportedArtifact(): FrameworkMigrationValueError {
    return new FrameworkMigrationInvalidValueError({
      operation: "capturePlan",
      reason: "unsupportedArtifact",
      message: "Framework migration artifact is not admitted by this profile",
      retryable: false,
    });
  },

  planConflict(): FrameworkMigrationValueError {
    return new FrameworkMigrationInvalidValueError({
      operation: "captureLedgerValue",
      reason: "planConflict",
      message: "Framework migration plan conflicts with existing evidence",
      retryable: false,
    });
  },

  storedStateCorrupt(): FrameworkMigrationValueError {
    return new FrameworkMigrationInvalidValueError({
      operation: "decodeStoredValue",
      reason: "storedStateCorrupt",
      message: "Stored framework migration value is corrupt",
      retryable: false,
    });
  },

  resourceFailure(
    operation: FrameworkMigrationValueOperation,
    cause: unknown,
  ): FrameworkMigrationValueError {
    return new FrameworkMigrationValueResourceError({
      operation,
      reason: "resourceFailure",
      message: "Framework migration value resource failed",
      retryable: false,
      cause,
    });
  },
});
