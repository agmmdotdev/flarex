import { Result } from "effect";
import { useJsonOutcomeValue, type JsonOutcomeError } from "../../values/jsonOutcome";
import { commerceError } from "./model";

/** Value capture has no admission, SQL or settlement dependency. */
export const projectCommerceJsonFailure = (cause: JsonOutcomeError) =>
  commerceError(cause.reason === "invalidEvidence" ? "storedCorruption" : cause.reason, cause);

/** Exact immutable accounting handoff shared by retained and translated hosts. */
export const captureCommerceJsonData = (input: unknown, maximum: number) =>
  useJsonOutcomeValue(input, maximum).pipe(Result.mapError(projectCommerceJsonFailure));
