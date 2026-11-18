import { RelationalSessionError } from "../../../src/database/relationalTransaction/model";
import { PhysicalSessionDeadlineIssue } from "../../../src/database/physicalSession/errors";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../../../src/commit/committedPointOutcomeErrors";
import { Effect } from "effect";
import { PreparedHostRuntimeError } from "../../../src/execution/preparation/preparedHostRuntime";
import { TrustedScopeAuthorityPortError } from "../../../src/scope/scopeAuthorityResolution";
import { cmsError, CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { rethrowPublicationFailure } from "../../../src/commit/publication/pointCommitProjection";
import {
  mapTransactionFailure,
} from "../../../src/commit/point/sqlFailures";
import {
  PointCommitSqlErrorV1,
} from "../../../src/commit/point/errors";

/** Borrowed transaction's existing kernel failure projection; never settles. */
export const projectCe0KernelFailure = (
  cause: unknown,
): CmsTransactionError => {
  const failure = mapTransactionFailure(cause);
  return cmsError(
    failure instanceof PointCommitSqlErrorV1
      ? "statementFailure"
      : "storedCorruption",
    failure,
  );
};
export const ce0PersistenceStep = <Value>(work: () => Promise<Value>) =>
  Effect.tryPromise({
    try: () => work().catch(rethrowPublicationFailure),
    catch: projectCe0KernelFailure,
  });

export const projectCe0CmsRequestFailure = (
  cause: unknown,
): CmsTransactionError => {
  if (cause instanceof CmsTransactionError) return cause;
  if (cause instanceof PhysicalSessionDeadlineIssue) return cmsError("deadlineExceeded", cause);
  if (cause instanceof PreparedHostRuntimeError)
    return cmsError(cause.reason === "closed" ? "closed" : "resourceFailure", cause);
  if (cause instanceof TrustedScopeAuthorityPortError)
    return cmsError("resourceFailure", cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1)
    return cmsError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1)
    return cmsError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError)
    return cmsError(
      cause.reason === "decisionUncertain"
        ? "decisionUncertain"
        : "resourceFailure",
      cause,
    );
  return cmsError("invalidAuthority", cause);
};
