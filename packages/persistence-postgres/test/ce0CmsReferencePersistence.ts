import { RelationalSessionError } from "../src/relationalTransaction/model";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../src/committedPointOutcome";
import { Effect } from "effect";
import { PreparedHostRuntimeError } from "../src/preparedHostRuntime";
import { cmsError, CmsTransactionError } from "../src/cmsTransaction/model";
import { rethrowPublicationFailure } from "../src/commitPublication/pointCommitProjection";
import {
  mapTransactionFailure,
  PointCommitSqlErrorV1,
} from "../src/pointCommitErrors";

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
  if (cause instanceof PreparedHostRuntimeError)
    return cmsError(cause.reason === "closed" ? "closed" : "resourceFailure", cause);
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
