import type {
  InspectedFunctionReference,
} from "@flarex/application-definition/internal/function-reference";
import type { CompletedApplicationAction } from
  "@flarex/standard-application-invocation/internal/application-action-system";
import type { AuthoritativeCommittedApplicationMutationOutcome } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { Data, Effect } from "effect";
import {
  validateValidatorValueV1,
  type ValidatorValueErrorV1,
} from "flarex-protocol/validator-engine";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

class QueryResultContractError extends Data.TaggedError(
  "ApplicationResultContractError",
)<{
  readonly operation: "query";
  readonly cause: ValidatorValueErrorV1;
}> {}

class MutationResultContractError extends Data.TaggedError(
  "ApplicationResultContractError",
)<{
  readonly operation: "mutation";
  readonly cause: ValidatorValueErrorV1;
  readonly outcome: AuthoritativeCommittedApplicationMutationOutcome;
}> {}

class ActionResultContractError extends Data.TaggedError(
  "ApplicationResultContractError",
)<{
  readonly operation: "action";
  readonly cause: ValidatorValueErrorV1;
  readonly result: CompletedApplicationAction;
}> {}

class TaskResultContractError extends Data.TaggedError(
  "ApplicationResultContractError",
)<{
  readonly operation: "task";
  readonly cause: ValidatorValueErrorV1;
  readonly result: CanonicalFlarexRuntimeValueV1;
}> {}

export type ApplicationResultContractError =
  | QueryResultContractError
  | MutationResultContractError
  | ActionResultContractError
  | TaskResultContractError;
export type ApplicationQueryResultContractError = QueryResultContractError;
export type ApplicationMutationResultContractError =
  MutationResultContractError;
export type ApplicationActionResultContractError = ActionResultContractError;
export type ApplicationTaskResultContractError = TaskResultContractError;

export const queryResultContractError = (
  cause: ValidatorValueErrorV1,
): ApplicationQueryResultContractError =>
  new QueryResultContractError({ operation: "query", cause });

export const mutationResultContractError = (
  cause: ValidatorValueErrorV1,
  outcome: AuthoritativeCommittedApplicationMutationOutcome,
): ApplicationMutationResultContractError =>
  new MutationResultContractError({ operation: "mutation", cause, outcome });

export const actionResultContractError = (
  cause: ValidatorValueErrorV1,
  result: CompletedApplicationAction,
): ApplicationActionResultContractError =>
  new ActionResultContractError({ operation: "action", cause, result });

export const taskResultContractError = (
  cause: ValidatorValueErrorV1,
  result: CanonicalFlarexRuntimeValueV1,
): ApplicationTaskResultContractError =>
  new TaskResultContractError({ operation: "task", cause, result });

export const validateResultContract = Effect.fn(
  "Application.validateResultContract",
)(function* <Error>(
  // Authored Id<Table> metadata is a host-neutral string hint, not table
  // proof. Invocation result inference erases that hint to string, so this
  // shape-only check claims no active schema or document authority.
  reference: Pick<InspectedFunctionReference, "returnsValidator">,
  value: CanonicalFlarexRuntimeValueV1,
  onMismatch: (
    cause: ValidatorValueErrorV1,
  ) => Error,
): Effect.fn.Return<
  CanonicalFlarexRuntimeValueV1,
  Error
> {
  if (reference.returnsValidator === null) return value;
  yield* Effect.fromResult(validateValidatorValueV1(
    reference.returnsValidator,
    value,
    { path: "$result", idPolicy: { mode: "shapeOnly" } },
  )).pipe(Effect.mapError(onMismatch));
  return value;
});
