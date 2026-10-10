import type {
  ApplicationReadinessNotReadyReason,
  ApplicationReadinessResult,
} from "./contracts";

export function notReady(
  revisionId: string,
  reason: ApplicationReadinessNotReadyReason,
  detail?: string,
): Extract<ApplicationReadinessResult, { readonly status: "not_ready" }> {
  return Object.freeze({
    status: "not_ready",
    revisionId,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
}

export function candidateNotReadyReason(
  reason: "missing" | "inProgress" | "failed" | "wrongSchema",
): ApplicationReadinessNotReadyReason {
  switch (reason) {
    case "missing": return "candidateValidationMissing";
    case "inProgress": return "candidateValidationInProgress";
    case "failed": return "candidateValidationFailed";
    case "wrongSchema": return "candidateValidationWrongSchema";
  }
}

export function uniqueNotReadyReason(
  reason: "setNotClosed" | "buildMissing" | "buildNotEnabled" | "buildStale",
): ApplicationReadinessNotReadyReason {
  switch (reason) {
    case "setNotClosed": return "uniqueConstraintSetMissing";
    case "buildMissing": return "uniqueConstraintBuildMissing";
    case "buildNotEnabled": return "uniqueConstraintBuildNotEnabled";
    case "buildStale": return "uniqueConstraintBuildStale";
  }
}
