import { Data } from "effect";

export type RelationalPhysicalValueOperation =
  | "lower"
  | "captureName"
  | "captureLayout"
  | "decodeStoredValue";

export type RelationalPhysicalValueReason =
  | "invalidInput"
  | "unsupportedArtifact"
  | "physicalNameCollision"
  | "storedStateCorrupt"
  | "resourceFailure";

type RelationalPhysicalValueErrorCommon = Readonly<{
  readonly operation: RelationalPhysicalValueOperation;
  readonly message: string;
  readonly retryable: false;
}>;

class RelationalPhysicalExpectedValueError extends Data.TaggedError(
  "RelationalPhysicalValueError",
)<RelationalPhysicalValueErrorCommon & Readonly<{
  readonly reason: Exclude<RelationalPhysicalValueReason, "resourceFailure">;
  readonly spelling?: string;
  readonly cause?: never;
}>> {}

class RelationalPhysicalResourceValueError extends Data.TaggedError(
  "RelationalPhysicalValueError",
)<RelationalPhysicalValueErrorCommon & Readonly<{
  readonly reason: "resourceFailure";
  readonly spelling?: never;
  readonly cause: unknown;
}>> {}

export type RelationalPhysicalValueError =
  | RelationalPhysicalExpectedValueError
  | RelationalPhysicalResourceValueError;

export const RelationalPhysicalValueError = Object.freeze({
  invalidInput(
    operation: RelationalPhysicalValueOperation = "lower",
  ): RelationalPhysicalValueError {
    return new RelationalPhysicalExpectedValueError({
      operation,
      reason: "invalidInput",
      message: "Relational physical value input is invalid",
      retryable: false,
    });
  },

  unsupportedArtifact(): RelationalPhysicalValueError {
    return new RelationalPhysicalExpectedValueError({
      operation: "lower",
      reason: "unsupportedArtifact",
      message: "Relational artifact is not admitted for physical lowering",
      retryable: false,
    });
  },

  physicalNameCollision(spelling: string): RelationalPhysicalValueError {
    return new RelationalPhysicalExpectedValueError({
      operation: "captureLayout",
      reason: "physicalNameCollision",
      message: "Relational physical name collides with another preimage",
      retryable: false,
      spelling,
    });
  },

  storedStateCorrupt(): RelationalPhysicalValueError {
    return new RelationalPhysicalExpectedValueError({
      operation: "decodeStoredValue",
      reason: "storedStateCorrupt",
      message: "Stored relational physical value is corrupt",
      retryable: false,
    });
  },

  resourceFailure(
    operation: RelationalPhysicalValueOperation,
    cause: unknown,
  ): RelationalPhysicalValueError {
    return new RelationalPhysicalResourceValueError({
      operation,
      reason: "resourceFailure",
      message: "Relational physical value resource failed",
      retryable: false,
      cause,
    });
  },
});
