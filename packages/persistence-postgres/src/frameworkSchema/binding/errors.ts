import { Data } from "effect";

export class DataBindingError extends Data.TaggedError("DataBindingError")<{
  readonly reason:
    | "invalidInput"
    | "storedCorruption"
    | "missingDependency"
    | "staleScope"
    | "staleApplication"
    | "concurrentHead"
    | "unavailableInstallation"
    | "unsupportedProfile"
    | "placementMismatch"
    | "invalidAuthority"
    | "resourceFailure"
    | "decisionUncertain"
    | "requestConflict";
  readonly cause?: unknown;
}> {}

export function bindingError(
  reason: DataBindingError["reason"],
  cause?: unknown,
): DataBindingError {
  return new DataBindingError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
