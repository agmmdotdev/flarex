import { Data } from "effect";

export type RelationalSchemaOperation = "normalize" | "composeArtifact";

export type RelationalSchemaReason =
  | "invalidInput"
  | "unsupportedCapability";

type RelationalSchemaErrorCommon = Readonly<{
  readonly operation: RelationalSchemaOperation;
  readonly message: string;
  readonly path: string;
  readonly retryable: false;
}>;

class RelationalSchemaInvalidInputError extends Data.TaggedError(
  "RelationalSchemaError",
)<RelationalSchemaErrorCommon & Readonly<{
  readonly reason: "invalidInput";
  readonly capability?: never;
}>> {}

class RelationalSchemaUnsupportedCapabilityError extends Data.TaggedError(
  "RelationalSchemaError",
)<RelationalSchemaErrorCommon & Readonly<{
  readonly reason: "unsupportedCapability";
  readonly capability: string;
}>> {}

export type RelationalSchemaError =
  | RelationalSchemaInvalidInputError
  | RelationalSchemaUnsupportedCapabilityError;

export const RelationalSchemaError = Object.freeze({
  invalidInput(
    path: string,
    operation: RelationalSchemaOperation = "normalize",
  ): RelationalSchemaError {
    return new RelationalSchemaInvalidInputError({
      operation,
      reason: "invalidInput",
      message: "Relational schema input is invalid",
      path,
      retryable: false,
    });
  },

  unsupportedCapability(
    path: string,
    capability: string,
    operation: RelationalSchemaOperation = "normalize",
  ): RelationalSchemaError {
    return new RelationalSchemaUnsupportedCapabilityError({
      operation,
      reason: "unsupportedCapability",
      message: "Relational schema capability is not supported",
      path,
      capability,
      retryable: false,
    });
  },
});
