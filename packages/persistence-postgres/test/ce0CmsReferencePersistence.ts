import { Effect } from "effect";
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
