import { Data } from "effect";

export type FrameworkSchemaInstallationValueOperation =
  | "captureInstallation"
  | "captureReadiness"
  | "captureAvailability"
  | "decodeStoredValue";

export type FrameworkSchemaInstallationValueReason =
  | "invalidInput"
  | "evidenceMismatch"
  | "invalidTransition"
  | "storedStateCorrupt"
  | "resourceFailure";

type FrameworkSchemaInstallationValueErrorCommon = Readonly<{
  readonly operation: FrameworkSchemaInstallationValueOperation;
  readonly message: string;
  readonly retryable: false;
}>;

class FrameworkSchemaInstallationExpectedValueError extends Data.TaggedError(
  "FrameworkSchemaInstallationValueError",
)<FrameworkSchemaInstallationValueErrorCommon & Readonly<{
  readonly reason: Exclude<
    FrameworkSchemaInstallationValueReason,
    "resourceFailure"
  >;
  readonly cause?: never;
}>> {}

class FrameworkSchemaInstallationResourceValueError extends Data.TaggedError(
  "FrameworkSchemaInstallationValueError",
)<FrameworkSchemaInstallationValueErrorCommon & Readonly<{
  readonly reason: "resourceFailure";
  readonly cause: unknown;
}>> {}

export type FrameworkSchemaInstallationValueError =
  | FrameworkSchemaInstallationExpectedValueError
  | FrameworkSchemaInstallationResourceValueError;

export const FrameworkSchemaInstallationValueError = Object.freeze({
  invalidInput(
    operation: FrameworkSchemaInstallationValueOperation,
  ): FrameworkSchemaInstallationValueError {
    return new FrameworkSchemaInstallationExpectedValueError({
      operation,
      reason: "invalidInput",
      message: "Framework schema installation value input is invalid",
      retryable: false,
    });
  },

  evidenceMismatch(
    operation: "captureInstallation" | "captureReadiness",
  ): FrameworkSchemaInstallationValueError {
    return new FrameworkSchemaInstallationExpectedValueError({
      operation,
      reason: "evidenceMismatch",
      message: "Framework schema installation evidence does not match",
      retryable: false,
    });
  },

  invalidTransition(): FrameworkSchemaInstallationValueError {
    return new FrameworkSchemaInstallationExpectedValueError({
      operation: "captureAvailability",
      reason: "invalidTransition",
      message: "Framework schema availability transition is invalid",
      retryable: false,
    });
  },

  storedStateCorrupt(): FrameworkSchemaInstallationValueError {
    return new FrameworkSchemaInstallationExpectedValueError({
      operation: "decodeStoredValue",
      reason: "storedStateCorrupt",
      message: "Stored framework schema installation value is corrupt",
      retryable: false,
    });
  },

  resourceFailure(
    operation: FrameworkSchemaInstallationValueOperation,
    cause: unknown,
  ): FrameworkSchemaInstallationValueError {
    return new FrameworkSchemaInstallationResourceValueError({
      operation,
      reason: "resourceFailure",
      message: "Framework schema installation value resource failed",
      retryable: false,
      cause,
    });
  },
});
